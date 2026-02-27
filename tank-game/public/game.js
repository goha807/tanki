const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let currentUser = null;
let players = {};
let bullets = [];
let healthPacks = [];
let coinPacks = [];
let obstacles = [];
let keys = {};
let mouse = { x: 0, y: 0 };

const MAP_SIZE = 2000;
let lastShot = 0;
let ping = 0;

const TANK_TYPES = {
    basic: { name: 'Базовий', speed: 4, damage: 20, hp: 100, fireRate: 600, color: '#4CAF50', price: 0 },
    fast: { name: 'Швидкий', speed: 6, damage: 15, hp: 80, fireRate: 500, color: '#2196F3', price: 500 },
    heavy: { name: 'Важкий', speed: 3, damage: 35, hp: 150, fireRate: 800, color: '#FF5722', price: 1000 }
};

// Resize canvas
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Ping system
setInterval(() => {
    const start = Date.now();
    socket.emit('ping_server');
    socket.once('pong_server', () => {
        ping = Date.now() - start;
        document.getElementById('pingDisplay').innerText = `Ping: ${ping}ms`;
    });
}, 2000);

// Auth function
async function auth(type) {
    const u = document.getElementById('username').value.trim();
    const p = document.getElementById('password').value.trim();
    
    if (!u || !p) {
        alert("Введіть нікнейм та пароль!");
        return;
    }
    
    try {
        const res = await fetch('/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p, type })
        });
        
        const data = await res.json();
        
        if (data.success) {
            currentUser = data.user;
            document.getElementById('authContainer').style.display = 'none';
            document.getElementById('gameUI').style.display = 'block';
            
            socket.emit('joinGame', currentUser);
            requestAnimationFrame(gameLoop);
        } else {
            alert(data.message);
        }
    } catch (err) {
        console.error('Auth error:', err);
        alert('Помилка підключення до сервера');
    }
}

// Shooting - FIXED: spawn bullet outside player
function handleShoot(clientX, clientY) {
    const me = players[socket.id];
    if (!me || me.isDead) return;
    
    const now = Date.now();
    const tankType = TANK_TYPES[me.tankType] || TANK_TYPES.basic;
    const cooldown = Math.max(200, tankType.fireRate - (me.fire_rate_lvl * 50));
    
    if (now - lastShot < cooldown) return;
    lastShot = now;
    
    const angle = Math.atan2(clientY - canvas.height/2, clientX - canvas.width/2);
    
    // Spawn bullet at tank turret (outside the tank body)
    socket.emit('shoot', {
        x: me.x + 20 + Math.cos(angle) * 30,  // 30px outside tank
        y: me.y + 20 + Math.sin(angle) * 30,
        dx: Math.cos(angle) * 12,
        dy: Math.sin(angle) * 12
    });
}

canvas.addEventListener('mousedown', (e) => {
    handleShoot(e.clientX, e.clientY);
});

// Keyboard controls
window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
});

// Mouse tracking
canvas.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

// Game loop
function gameLoop() {
    // Clear screen
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const me = players[socket.id];
    
    if (me) {
        // Movement
        if (!me.isDead) {
            const tankType = TANK_TYPES[me.tankType] || TANK_TYPES.basic;
            let speed = tankType.speed + (me.speed_lvl * 0.5);
            let nextX = me.x;
            let nextY = me.y;
            let moved = false;
            
            if (keys['w'] || keys['arrowup']) { nextY -= speed; moved = true; }
            if (keys['s'] || keys['arrowdown']) { nextY += speed; moved = true; }
            if (keys['a'] || keys['arrowleft']) { nextX -= speed; moved = true; }
            if (keys['d'] || keys['arrowright']) { nextX += speed; moved = true; }
            
            if (moved) {
                me.x = nextX;
                me.y = nextY;
                socket.emit('move', { x: nextX, y: nextY });
            }
        }
        
        // Camera transform
        ctx.save();
        ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);
        
        // Draw grid
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= MAP_SIZE; i += 100) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, MAP_SIZE);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(MAP_SIZE, i);
            ctx.stroke();
        }
        
        // Draw map borders
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 5;
        ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
        
        // Draw coin packs
        coinPacks.forEach(cp => {
            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(cp.x + 15, cp.y + 15, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#FFA500';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('🪙', cp.x + 15, cp.y + 20);
        });
        
        // Draw health packs
        healthPacks.forEach(hp => {
            ctx.fillStyle = '#ff4444';
            ctx.fillRect(hp.x, hp.y, 30, 30);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('+', hp.x + 15, hp.y + 24);
        });
        
        // Draw obstacles
        obstacles.forEach(ob => {
            if (!ob.destroyed) {
                const gradient = ctx.createLinearGradient(ob.x, ob.y, ob.x + 40, ob.y + 40);
                gradient.addColorStop(0, '#666');
                gradient.addColorStop(1, '#333');
                ctx.fillStyle = gradient;
                ctx.fillRect(ob.x, ob.y, 40, 40);
                
                ctx.strokeStyle = '#888';
                ctx.lineWidth = 2;
                ctx.strokeRect(ob.x, ob.y, 40, 40);
                
                // HP indicator
                ctx.fillStyle = '#ff0000';
                ctx.fillRect(ob.x + 5, ob.y - 10, (ob.hp / ob.maxHp) * 30, 5);
            }
        });
        
        // Draw players
        for (let id in players) {
            const p = players[id];
            if (p.isDead) continue;
            
            const tankType = TANK_TYPES[p.tankType] || TANK_TYPES.basic;
            const isMe = id === socket.id;
            
            // Tank shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(p.x + 3, p.y + 3, 40, 40);
            
            // Tank body
            const gradient = ctx.createLinearGradient(p.x, p.y, p.x + 40, p.y + 40);
            gradient.addColorStop(0, tankType.color);
            gradient.addColorStop(1, darkenColor(tankType.color, 40));
            ctx.fillStyle = gradient;
            ctx.fillRect(p.x, p.y, 40, 40);
            
            // Tank border
            ctx.strokeStyle = isMe ? '#00ff00' : '#fff';
            ctx.lineWidth = isMe ? 3 : 2;
            ctx.strokeRect(p.x, p.y, 40, 40);
            
            // Tank turret
            ctx.fillStyle = darkenColor(tankType.color, 20);
            ctx.fillRect(p.x + 15, p.y + 15, 10, 10);
            
            // Username
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(p.username, p.x + 20, p.y - 10);
            
            // HP bar
            ctx.fillStyle = '#000';
            ctx.fillRect(p.x, p.y - 5, 40, 5);
            ctx.fillStyle = p.hp > 50 ? '#00ff00' : p.hp > 25 ? '#ffff00' : '#ff0000';
            ctx.fillRect(p.x, p.y - 5, (p.hp / p.maxHp) * 40, 5);
        }
        
        // Draw bullets
        bullets.forEach(b => {
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffaa00';
            ctx.beginPath();
            ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
        
        ctx.restore();
        
        // Update UI
        updateUI(me);
    }
    
    requestAnimationFrame(gameLoop);
}

// Helper function to darken color
function darkenColor(color, percent) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max((num >> 16) - amt, 0);
    const G = Math.max((num >> 8 & 0x00FF) - amt, 0);
    const B = Math.max((num & 0x0000FF) - amt, 0);
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

// Update UI
function updateUI(me) {
    document.getElementById('stats').innerText = 
        `🪙 ${me.coins || 0} | 🎯 ${me.score || 0} | ❤️ ${Math.floor(me.hp)}`;
    document.getElementById('pingDisplay').innerText = `Ping: ${ping}ms`;
    document.getElementById('respawnMenu').style.display = me.isDead ? 'block' : 'none';
    
    // Update leaderboard
    updateLeaderboard();
}

// Update leaderboard
function updateLeaderboard() {
    const sorted = Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    const html = sorted.map((p, i) => `
        <div style="padding: 5px; margin: 3px 0; background: rgba(255,255,255,0.1); border-radius: 5px;">
            <span style="color: ${i === 0 ? '#FFD700' : 'white'}">
                ${i + 1}. ${p.username}: ${p.score || 0}
            </span>
        </div>
    `).join('');
    document.getElementById('leaderboard').innerHTML = '<h3>🏆 ТОП 5</h3>' + html;
}

// Socket events
socket.on('updatePlayers', data => {
    for (let id in data) {
        if (id !== socket.id) {
            players[id] = data[id];
        } else {
            if (!players[id]) players[id] = data[id];
            Object.assign(players[id], data[id]);
            if (currentUser) {
                currentUser.coins = data[id].coins;
                currentUser.score = data[id].score;
            }
        }
    }
});

socket.on('updateBullets', data => {
    bullets = data;
});

socket.on('updateHealthPacks', data => {
    healthPacks = data;
});

socket.on('updateCoinPacks', data => {
    coinPacks = data;
});

socket.on('updateObstacles', data => {
    obstacles = data;
});

socket.on('gameState', data => {
    if (currentUser) {
        currentUser.coins = data.coins;
    }
});

// Upgrade function
async function upgrade(stat) {
    if (!currentUser) return;
    
    if (currentUser.coins < 100) {
        alert('Недостатньо монет! Потрібно 100🪙');
        return;
    }
    
    try {
        const res = await fetch('/upgrade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username, stat })
        });
        
        const data = await res.json();
        if (data.success) {
            currentUser[stat] = (currentUser[stat] || 1) + 1;
            currentUser.coins -= 100;
            alert('Покращено! -100🪙');
        } else {
            alert(data.message || 'Помилка прокачування');
        }
    } catch (err) {
        console.error('Upgrade error:', err);
        alert('Помилка з\'єднання');
    }
}

function respawn() {
    socket.emit('respawn');
}

function setAvatar() {
    const url = document.getElementById('avatarUrl').value;
    if (!url) return alert('Введіть URL');
    
    fetch('/set-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, url })
    }).then(() => { 
        currentUser.photo = url;
        alert('Аватарку збережено!');
    });
}

// Show shop
function showShop() {
    let html = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 20px;">';
    
    for (let [key, tank] of Object.entries(TANK_TYPES)) {
        const owned = currentUser && currentUser.tankType === key;
        html += `
            <div style="background: rgba(0,0,0,0.7); border: 2px solid ${owned ? '#00ff00' : tank.color}; 
                        border-radius: 10px; padding: 15px; text-align: center;">
                <div style="width: 80px; height: 80px; background: ${tank.color}; margin: 0 auto 10px; 
                            border-radius: 10px; border: 3px solid #fff;"></div>
                <h3 style="color: ${tank.color}">${tank.name}</h3>
                <p>⚡ Швидкість: ${tank.speed}</p>
                <p>💥 Урон: ${tank.damage}</p>
                <p>❤️ HP: ${tank.hp}</p>
                ${owned ? 
                    '<button style="background: #00ff00; color: #000; padding: 10px; border: none; border-radius: 5px; cursor: default;">Обрано</button>' : 
                    `<button onclick="buyTank('${key}', ${tank.price})" 
                              style="background: ${tank.price === 0 ? '#00ff00' : '#FFD700'}; color: #000; 
                                     padding: 10px; border: none; border-radius: 5px; cursor: pointer;">
                        ${tank.price === 0 ? 'Безкоштовно' : tank.price + '🪙'}
                    </button>`
                }
            </div>
        `;
    }
    html += '</div>';
    
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'shopModal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9); z-index: 1000;
        display: flex; justify-content: center; align-items: center;
    `;
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); 
                    border: 3px solid #00ff00; border-radius: 20px; 
                    max-width: 900px; width: 90%; max-height: 80vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; 
                        padding: 20px; border-bottom: 2px solid #00ff00;">
                <h2 style="color: #00ff00; margin: 0;">🛒 МАГАЗИН ТАНКІВ</h2>
                <button onclick="this.closest('#shopModal').remove()" 
                        style="background: none; border: none; color: #fff; 
                               font-size: 24px; cursor: pointer;">&times;</button>
            </div>
            ${html}
        </div>
    `;
    
    document.body.appendChild(modal);
}

// Buy tank
async function buyTank(tankType, price) {
    if (!currentUser) return;
    
    if (price > 0 && currentUser.coins < price) {
        alert('Недостатньо монет!');
        return;
    }
    
    try {
        const res = await fetch('/buy-tank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username, tankType })
        });
        
        const data = await res.json();
        if (data.success) {
            currentUser.tankType = tankType;
            if (price > 0) {
                currentUser.coins -= price;
            }
            alert('Танк успішно придбано!');
            document.getElementById('shopModal')?.remove();
            showShop();
        } else {
            alert(data.message);
        }
    } catch (err) {
        console.error('Buy error:', err);
        alert('Помилка покупки');
    }
}

// Add shop button to topBar
window.addEventListener('load', () => {
    const topBar = document.getElementById('topBar');
    const shopBtn = document.createElement('button');
    shopBtn.innerText = '🛒 Магазин';
    shopBtn.onclick = showShop;
    topBar.appendChild(shopBtn);
});

// Mobile controls
document.getElementById('moveUp')?.addEventListener('touchstart', (e) => { e.preventDefault(); keys['w'] = true; });
document.getElementById('moveUp')?.addEventListener('touchend', (e) => { e.preventDefault(); keys['w'] = false; });
document.getElementById('moveDown')?.addEventListener('touchstart', (e) => { e.preventDefault(); keys['s'] = true; });
document.getElementById('moveDown')?.addEventListener('touchend', (e) => { e.preventDefault(); keys['s'] = false; });
document.getElementById('moveLeft')?.addEventListener('touchstart', (e) => { e.preventDefault(); keys['a'] = true; });
document.getElementById('moveLeft')?.addEventListener('touchend', (e) => { e.preventDefault(); keys['a'] = false; });
document.getElementById('moveRight')?.addEventListener('touchstart', (e) => { e.preventDefault(); keys['d'] = true; });
document.getElementById('moveRight')?.addEventListener('touchend', (e) => { e.preventDefault(); keys['d'] = false; });
document.getElementById('btnFire')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleShoot(canvas.width/2 + 50, canvas.height/2);
});

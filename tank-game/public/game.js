const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let currentUser = null;
let players = {};
let bullets = [];
let healthPacks = [];
let coinPacks = [];
let obstacles = [];
let bosses = [];
let keys = {};
let mouse = { x: 0, y: 0 };

const MAP_SIZE = 3000;
let lastShot = 0;
let ping = 0;

const TANK_TYPES = {
    basic: { name: 'Базовий', speed: 4, damage: 20, hp: 100, fireRate: 600, color: '#4CAF50', price: 0 },
    fast: { name: 'Швидкий', speed: 6, damage: 15, hp: 80, fireRate: 500, color: '#2196F3', price: 500 },
    heavy: { name: 'Важкий', speed: 3, damage: 35, hp: 150, fireRate: 800, color: '#FF5722', price: 1000 },
    sniper: { name: 'Снайпер', speed: 4, damage: 50, hp: 70, fireRate: 1200, color: '#9C27B0', price: 1500 },
    premium: { name: 'Преміум', speed: 5, damage: 30, hp: 120, fireRate: 550, color: '#FFD700', price: 3000 }
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

// Shooting
function handleShoot(clientX, clientY) {
    const me = players[socket.id];
    if (!me || me.isDead) return;
    
    const now = Date.now();
    const tankType = TANK_TYPES[me.tankType] || TANK_TYPES.basic;
    const cooldown = Math.max(200, tankType.fireRate - (me.fire_rate_lvl * 50));
    
    if (now - lastShot < cooldown) return;
    lastShot = now;
    
    const angle = Math.atan2(clientY - canvas.height/2, clientX - canvas.width/2);
    
    socket.emit('shoot', {
        x: me.x + 20,
        y: me.y + 20,
        dx: Math.cos(angle) * 10,
        dy: Math.sin(angle) * 10
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
                const gradient = ctx.createLinearGradient(ob.x, ob.y, ob.x + 60, ob.y + 60);
                gradient.addColorStop(0, '#666');
                gradient.addColorStop(1, '#333');
                ctx.fillStyle = gradient;
                ctx.fillRect(ob.x, ob.y, 60, 60);
                
                // Border
                ctx.strokeStyle = '#888';
                ctx.lineWidth = 2;
                ctx.strokeRect(ob.x, ob.y, 60, 60);
                
                // HP indicator
                ctx.fillStyle = '#ff0000';
                ctx.fillRect(ob.x + 5, ob.y - 10, (ob.hp / ob.maxHp) * 50, 5);
            }
        });
        
        // Draw bosses
        bosses.forEach(boss => {
            // Boss shadow
            ctx.fillStyle = 'rgba(255,0,0,0.3)';
            ctx.beginPath();
            ctx.arc(boss.x + boss.size/2 + 5, boss.y + boss.size/2 + 5, boss.size/2, 0, Math.PI * 2);
            ctx.fill();
            
            // Boss body
            const gradient = ctx.createRadialGradient(
                boss.x + boss.size/2, boss.y + boss.size/2, 0,
                boss.x + boss.size/2, boss.y + boss.size/2, boss.size/2
            );
            gradient.addColorStop(0, '#ff4444');
            gradient.addColorStop(1, '#8b0000');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(boss.x + boss.size/2, boss.y + boss.size/2, boss.size/2, 0, Math.PI * 2);
            ctx.fill();
            
            // Boss border
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 4;
            ctx.stroke();
            
            // Boss HP bar
            ctx.fillStyle = '#000';
            ctx.fillRect(boss.x, boss.y - 20, boss.size, 10);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(boss.x, boss.y - 20, (boss.currentHp / boss.hp) * boss.size, 10);
            
            // Boss label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('👾 БОС', boss.x + boss.size/2, boss.y - 25);
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
            ctx.fillRect(p.x, p.y - 5, (p.hp / (tankType.hp + (p.speed_lvl * 10))) * 40, 5);
            
            // Premium indicator
            if (p.premium > 0) {
                ctx.fillStyle = '#FFD700';
                ctx.font = '12px Arial';
                ctx.fillText('💎', p.x + 20, p.y + 55);
            }
        }
        
        // Draw bullets
        bullets.forEach(b => {
            if (b.isBossBullet) {
                // Boss bullet
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ff8800';
                ctx.beginPath();
                ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // Regular bullet
                ctx.fillStyle = '#ffff00';
                ctx.beginPath();
                ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffaa00';
                ctx.beginPath();
                ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
                ctx.fill();
            }
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
    document.getElementById('coinCount').innerText = me.coins || 0;
    document.getElementById('premiumCount').innerText = me.premium || 0;
    document.getElementById('speedLvl').innerText = me.speed_lvl || 1;
    document.getElementById('fireRateLvl').innerText = me.fire_rate_lvl || 1;
    document.getElementById('damageLvl').innerText = me.damage_lvl || 1;
    document.getElementById('rangeLvl').innerText = me.range_lvl || 1;
    
    document.getElementById('playerStats').innerText = 
        `🎯 Рахунок: ${me.score || 0} | ❤️ HP: ${Math.floor(me.hp)}`;
    
    document.getElementById('respawnMenu').style.display = me.isDead ? 'block' : 'none';
    
    // Update leaderboard
    updateLeaderboard();
}

// Update leaderboard
function updateLeaderboard() {
    const sorted = Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    const html = sorted.map((p, i) => `
        <div class="leaderboard-item ${i === 0 ? 'first' : ''}">
            <span class="rank">${i + 1}</span>
            <span class="name">${p.username}</span>
            <span class="score">${p.score || 0}</span>
        </div>
    `).join('');
    document.getElementById('leaderboardList').innerHTML = html;
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
                currentUser.premium = data[id].premium;
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

socket.on('updateBosses', data => {
    bosses = data;
    if (bosses.length > 0) {
        showBossAlert();
    }
});

socket.on('bossDefeated', data => {
    showNotification('🎉 БОСА ЗНИЩЕНО! +500🪙 +100💎');
});

socket.on('gameState', data => {
    if (currentUser) {
        currentUser.coins = data.coins;
        currentUser.premium = data.premium;
        currentUser.tankType = data.tankType;
    }
});

// Shop functions
function showShop() {
    const shopDiv = document.getElementById('tankShop');
    let html = '<div class="tank-grid">';
    
    for (let [key, tank] of Object.entries(TANK_TYPES)) {
        const owned = currentUser && currentUser.tankType === key;
        html += `
            <div class="tank-card ${owned ? 'owned' : ''}">
                <div class="tank-preview" style="background:${tank.color}"></div>
                <h3>${tank.name}</h3>
                <div class="tank-stats">
                    <p>⚡ Швидкість: ${tank.speed}</p>
                    <p>💥 Урон: ${tank.damage}</p>
                    <p>❤️ HP: ${tank.hp}</p>
                    <p>🔥 КД: ${tank.fireRate}ms</p>
                </div>
                ${owned ? 
                    '<button class="btn-equipped" disabled>Обрано</button>' : 
                    `<button class="btn-buy" onclick="buyTank('${key}', ${tank.price})">
                        ${tank.price === 0 ? 'Безкоштовно' : tank.price + '🪙'}
                    </button>`
                }
            </div>
        `;
    }
    html += '</div>';
    
    shopDiv.innerHTML = html;
    document.getElementById('shopModal').style.display = 'block';
}

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
            showNotification('Танк успішно придбано!');
            showShop();
        } else {
            alert(data.message);
        }
    } catch (err) {
        console.error('Buy error:', err);
        alert('Помилка покупки');
    }
}

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
            showNotification('Покращено! -100🪙');
            updateUI(players[socket.id] || currentUser);
        } else {
            alert(data.message || 'Помилка прокачування');
        }
    } catch (err) {
        console.error('Upgrade error:', err);
        alert('Помилка з\'єднання');
    }
}

function showUpgrades() {
    document.getElementById('upgradeModal').style.display = 'block';
}

function showTanks() {
    showShop();
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function respawn() {
    socket.emit('respawn');
}

function showBossAlert() {
    const alert = document.getElementById('bossAlert');
    alert.style.display = 'block';
    setTimeout(() => {
        alert.style.display = 'none';
    }, 5000);
}

function showNotification(text) {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.innerText = text;
    notif.style.cssText = `
        position: fixed;
        top: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,255,0,0.9);
        color: white;
        padding: 15px 30px;
        border-radius: 10px;
        z-index: 1000;
        font-weight: bold;
        animation: slideDown 0.3s ease;
    `;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

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

// Close modals on outside click
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

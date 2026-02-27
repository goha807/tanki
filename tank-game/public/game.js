const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let currentUser = null;
let players = {};
let bullets = [];
let healthPacks = [];
let obstacles = [];
let keys = {};

const MAP_SIZE = 2000;
const TANK_SIZE = 40;
let lastShot = 0;
let ping = 0;

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

// Shooting - ВИПРАВЛЕНО: куля спавниться ЗОВНІ танку!
function handleShoot(clientX, clientY) {
    const me = players[socket.id];
    if (!me || me.isDead) return;
    
    const now = Date.now();
    const cooldown = Math.max(200, 600 - (me.fire_rate_lvl * 60));
    
    if (now - lastShot < cooldown) return;
    lastShot = now;
    
    const angle = Math.atan2(clientY - canvas.height/2, clientX - canvas.width/2);
    
    // Спавн кулі на 30px далі від центру танку
    socket.emit('shoot', {
        x: me.x + 20 + Math.cos(angle) * 30,
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

// Game loop
function gameLoop() {
    // Clear screen
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const me = players[socket.id];
    
    if (me) {
        // Movement
        if (!me.isDead) {
            let speed = 4 + (me.speed_lvl * 0.7);
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
        
        // Draw ALL players
        for (let id in players) {
            const p = players[id];
            if (p.isDead) continue;
            
            const isMe = id === socket.id;
            
            // Tank shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(p.x + 3, p.y + 3, TANK_SIZE, TANK_SIZE);
            
            // Tank body
            ctx.fillStyle = isMe ? '#00ff00' : '#ff4444';
            ctx.fillRect(p.x, p.y, TANK_SIZE, TANK_SIZE);
            
            // Tank border
            ctx.strokeStyle = isMe ? '#00ff00' : '#ff0000';
            ctx.lineWidth = 3;
            ctx.strokeRect(p.x, p.y, TANK_SIZE, TANK_SIZE);
            
            // Tank turret
            ctx.fillStyle = '#333';
            ctx.fillRect(p.x + 15, p.y + 15, 10, 10);
            
            // Username
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(p.username, p.x + 20, p.y - 10);
            
            // HP bar
            ctx.fillStyle = '#000';
            ctx.fillRect(p.x, p.y - 5, TANK_SIZE, 5);
            ctx.fillStyle = p.hp > 50 ? '#00ff00' : p.hp > 25 ? '#ffff00' : '#ff0000';
            ctx.fillRect(p.x, p.y - 5, (p.hp / 100) * TANK_SIZE, 5);
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
        document.getElementById('stats').innerText = 
            `🪙 ${currentUser.coins || 0} | 🎯 ${me.score || 0} | ❤️ ${Math.floor(me.hp)}`;
        document.getElementById('pingDisplay').innerText = `Ping: ${ping}ms`;
        document.getElementById('respawnMenu').style.display = me.isDead ? 'block' : 'none';
        
        // Update leaderboard
        updateLeaderboard();
    }
    
    requestAnimationFrame(gameLoop);
}

// Update leaderboard
function updateLeaderboard() {
    const sorted = Object.values(players)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5);
    
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
            if (!players[id]) {
                players[id] = data[id];
            } else {
                players[id].hp = data[id].hp;
                players[id].isDead = data[id].isDead;
                players[id].x = data[id].x;
                players[id].y = data[id].y;
                players[id].score = data[id].score;
            }
            
            if (currentUser) {
                currentUser.coins = data[id].coins || 0;
                currentUser.score = data[id].score || 0;
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

socket.on('updateObstacles', data => {
    obstacles = data;
});

socket.on('gameState', data => {
    if (currentUser) {
        currentUser.coins = data.coins || 0;
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
            if (players[socket.id]) {
                players[socket.id][stat] = currentUser[stat];
            }
            alert('Покращено! -100🪙');
        } else {
            alert('Недостатньо монет!');
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

// Mobile controls
document.getElementById('moveUp')?.addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    keys['w'] = true; 
});
document.getElementById('moveUp')?.addEventListener('touchend', (e) => { 
    e.preventDefault(); 
    keys['w'] = false; 
});
document.getElementById('moveDown')?.addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    keys['s'] = true; 
});
document.getElementById('moveDown')?.addEventListener('touchend', (e) => { 
    e.preventDefault(); 
    keys['s'] = false; 
});
document.getElementById('moveLeft')?.addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    keys['a'] = true; 
});
document.getElementById('moveLeft')?.addEventListener('touchend', (e) => { 
    e.preventDefault(); 
    keys['a'] = false; 
});
document.getElementById('moveRight')?.addEventListener('touchstart', (e) => { 
    e.preventDefault(); 
    keys['d'] = true; 
});
document.getElementById('moveRight')?.addEventListener('touchend', (e) => { 
    e.preventDefault(); 
    keys['d'] = false; 
});
document.getElementById('btnFire')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleShoot(canvas.width/2 + 50, canvas.height/2);
});

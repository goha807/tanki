const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let currentUser = null, players = {}, bullets = [], healthPacks = [], keys = {};
const MAP_SIZE = 2000;
let lastShot = 0;
const images = {}; // Кеш для аватарок

async function auth(type) {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    const res = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p, type })
    });
    const data = await res.json();
    if (data.success) {
        currentUser = data.user;
        document.getElementById('loginPanel').style.display = 'none';
        document.getElementById('gameUI').style.display = 'block';
        socket.emit('joinGame', currentUser);
        requestAnimationFrame(gameLoop);
    } else alert(data.message);
}

async function upgrade(stat) {
    const res = await fetch('/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, stat })
    });
    const data = await res.json();
    if (data.success) {
        currentUser.coins -= 100;
        currentUser[stat]++;
        players[socket.id][stat]++;
        updateUI();
    } else alert("Недостатньо монет!");
}

async function setAvatar() {
    const url = document.getElementById('avatarUrl').value;
    await fetch('/set-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, url })
    });
    currentUser.avatar_url = url;
    players[socket.id].avatar_url = url;
}

function respawn() {
    socket.emit('respawn');
    document.getElementById('respawnMenu').style.display = 'none';
}

canvas.addEventListener('mousedown', (e) => {
    const p = players[socket.id];
    if (!p || p.isDead) return;
    
    // Перевірка КД
    const now = Date.now();
    const cooldown = 600 - (p.fire_rate_lvl * 50); // Чим вище рівень, тим менше КД
    if (now - lastShot < cooldown) return;
    
    lastShot = now;
    const rect = canvas.getBoundingClientRect();
    const angle = Math.atan2(e.clientY - rect.top - canvas.height / 2, e.clientX - rect.left - canvas.width / 2);
    socket.emit('shoot', { x: p.x + 15, y: p.y + 15, dx: Math.cos(angle) * 12, dy: Math.sin(angle) * 12 });
});

window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function updateUI() {
    document.getElementById('stats').innerText = `Монети: ${currentUser.coins} | Швидкість: Lvl ${currentUser.speed_lvl} | Дальність: Lvl ${currentUser.range_lvl}`;
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const me = players[socket.id];

    if (me && !me.isDead) {
        let moved = false;
        let speed = 3 + (me.speed_lvl * 0.5); // Прокачка швидкості

        if (keys['w']) { me.y -= speed; moved = true; }
        if (keys['s']) { me.y += speed; moved = true; }
        if (keys['a']) { me.x -= speed; moved = true; }
        if (keys['d']) { me.x += speed; moved = true; }
        
        if (moved) socket.emit('move', { x: me.x, y: me.y });

        ctx.save();
        ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);

        // Сітка
        ctx.strokeStyle = '#333';
        for(let i=0; i<=MAP_SIZE; i+=100) {
            ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,MAP_SIZE); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(MAP_SIZE,i); ctx.stroke();
        }

        healthPacks.forEach(h => {
            ctx.fillStyle = 'white'; ctx.fillRect(h.x, h.y, 20, 20);
        });

        for (let id in players) {
            const p = players[id];
            if (p.isDead) continue;

            // Малюємо аватарку або колір
            if (p.avatar_url) {
                if (!images[p.avatar_url]) {
                    images[p.avatar_url] = new Image();
                    images[p.avatar_url].src = p.avatar_url;
                }
                ctx.drawImage(images[p.avatar_url], p.x, p.y, 30, 30);
            } else {
                ctx.fillStyle = id === socket.id ? '#00ff00' : '#ff4444';
                ctx.fillRect(p.x, p.y, 30, 30);
            }

            ctx.fillStyle = 'white'; ctx.fillText(p.username, p.x, p.y - 15);
            ctx.fillStyle = 'lime'; ctx.fillRect(p.x, p.y-5, (p.hp/100)*30, 5);
        }

        bullets.forEach(b => {
            ctx.fillStyle = 'yellow'; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        });

        ctx.restore();
        updateUI();
    } else if (me && me.isDead) {
        document.getElementById('respawnMenu').style.display = 'block';
    }

    const sorted = Object.values(players).sort((a,b) => b.score - a.score).slice(0, 5);
    document.getElementById('leaderboard').innerHTML = '<h3>TOP 5</h3>' + sorted.map(s => `<div>${s.username}: ${s.score}</div>`).join('');
    
    requestAnimationFrame(gameLoop);
}

socket.on('updatePlayers', d => {
    // Оновлюємо інших гравців, але зберігаємо свою позицію для плавності
    for (let id in d) {
        if (id !== socket.id) players[id] = d[id];
        else if (!players[id]) players[id] = d[id]; // Перший вхід
        else {
            players[id].hp = d[id].hp;
            players[id].isDead = d[id].isDead;
            players[id].score = d[id].score;
            players[id].coins = d[id].coins;
        }
    }
});
socket.on('updateBullets', d => bullets = d);
socket.on('updateHealthPacks', d => healthPacks = d);

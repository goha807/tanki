const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let currentUser = null, players = {}, bullets = [], healthPacks = [], obstacles = [], keys = {};
const MAP_SIZE = 2000;
let lastShot = 0;
const images = {};
let ping = 0;
let mouseX = 0, mouseY = 0;

setInterval(() => {
    const start = Date.now();
    socket.emit('ping_server');
    socket.once('pong_server', () => { ping = Date.now() - start; });
}, 2000);

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
        if(players[socket.id]) players[socket.id][stat]++;
        updateUI();
    } else alert("Недостатньо монет!");
}

function handleShoot() {
    const p = players[socket.id];
    if (!p || p.isDead) return;
    const now = Date.now();
    const cooldown = 600 - (p.fire_rate_lvl * 50);
    if (now - lastShot < cooldown) return;
    lastShot = now;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const angle = Math.atan2(mouseY - centerY, mouseX - centerX);
    
    socket.emit('shoot', { 
        x: p.x + 15, 
        y: p.y + 15, 
        dx: Math.cos(angle) * 12, 
        dy: Math.sin(angle) * 12 
    });
}

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

canvas.addEventListener('mousedown', handleShoot);
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function updateUI() {
    document.getElementById('stats').innerText = `Монети: ${currentUser.coins} | Швидкість: Lvl ${currentUser.speed_lvl}`;
    document.getElementById('pingDisplay').innerText = `Ping: ${ping}ms`;
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const me = players[socket.id];

    if (me && !me.isDead) {
        let moved = false;
        let speed = 3 + (me.speed_lvl * 0.5);
        let nextX = me.x, nextY = me.y;

        if (keys['w']) { nextY -= speed; moved = true; }
        if (keys['s']) { nextY += speed; moved = true; }
        if (keys['a']) { nextX -= speed; moved = true; }
        if (keys['d']) { nextX += speed; moved = true; }

        if (moved) socket.emit('move', { x: nextX, y: nextY });

        ctx.save();
        ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);
        
        // Сітка
        ctx.strokeStyle = '#333';
        for(let i=0; i<=MAP_SIZE; i+=100) {
            ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,MAP_SIZE); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(MAP_SIZE,i); ctx.stroke();
        }

        // Перешкоди
        obstacles.forEach(o => {
            if (!o.isDestroyed) {
                ctx.fillStyle = `rgb(${100 + o.hp*50}, 50, 50)`;
                ctx.fillRect(o.x, o.y, 50, 50);
                ctx.strokeStyle = 'white';
                ctx.strokeRect(o.x, o.y, 50, 50);
            }
        });

        healthPacks.forEach(h => { ctx.fillStyle = 'white'; ctx.fillRect(h.x, h.y, 20, 20); });

        for (let id in players) {
            const p = players[id];
            if (p.isDead) continue;
            if (p.photo) {
                if (!images[p.photo]) { images[p.photo] = new Image(); images[p.photo].src = p.photo; }
                ctx.drawImage(images[p.photo], p.x, p.y, 30, 30);
            } else {
                ctx.fillStyle = id === socket.id ? '#00ff00' : '#ff4444';
                ctx.fillRect(p.x, p.y, 30, 30);
            }
            ctx.fillStyle = 'white';
            ctx.fillText(p.username, p.x, p.y - 15);
            ctx.fillStyle = 'lime'; ctx.fillRect(p.x, p.y-5, (p.hp/100)*30, 5);
        }

        bullets.forEach(b => {
            ctx.fillStyle = 'yellow'; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        });

        ctx.restore();

        // Приціл (Crosshair)
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 10, 0, Math.PI*2);
        ctx.moveTo(mouseX - 15, mouseY); ctx.lineTo(mouseX + 15, mouseY);
        ctx.moveTo(mouseX, mouseY - 15); ctx.lineTo(mouseX, mouseY + 15);
        ctx.stroke();

        updateUI();
    } else if (me && me.isDead) {
        document.getElementById('respawnMenu').style.display = 'block';
    }

    const sorted = Object.values(players).sort((a,b) => b.score - a.score).slice(0, 5);
    document.getElementById('leaderboard').innerHTML = '<h3>TOP 5</h3>' + sorted.map(s => `<div>${s.username}: ${s.score}</div>`).join('');
    requestAnimationFrame(gameLoop);
}

socket.on('updatePlayers', d => {
    for (let id in d) {
        if (id !== socket.id) players[id] = d[id];
        else if (!players[id]) players[id] = d[id];
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
socket.on('updateObstacles', d => obstacles = d);

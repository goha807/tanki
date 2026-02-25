const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let currentUser = null, players = {}, bullets = [], healthPacks = [], keys = {};
const MAP_SIZE = 2000;

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

// Стрільба по кліку
canvas.addEventListener('mousedown', (e) => {
    const p = players[socket.id];
    if (!p) return;
    const rect = canvas.getBoundingClientRect();
    const targetX = e.clientX - rect.left - canvas.width / 2;
    const targetY = e.clientY - rect.top - canvas.height / 2;
    const angle = Math.atan2(targetY, targetX);
    socket.emit('shoot', { x: p.x + 15, y: p.y + 15, dx: Math.cos(angle) * 12, dy: Math.sin(angle) * 12 });
});

window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const me = players[socket.id];

    if (me) {
        // Рух
        let moved = false;
        if (keys['w']) { me.y -= 4; moved = true; }
        if (keys['s']) { me.y += 4; moved = true; }
        if (keys['a']) { me.x -= 4; moved = true; }
        if (keys['d']) { me.x += 4; moved = true; }
        if (moved) socket.emit('move', { x: me.x, y: me.y });

        // Камера
        ctx.save();
        ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);

        // Сітка фону
        ctx.strokeStyle = '#444';
        for(let i=0; i<=MAP_SIZE; i+=100) {
            ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,MAP_SIZE); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(MAP_SIZE,i); ctx.stroke();
        }

        // Аптечки
        healthPacks.forEach(h => {
            ctx.fillStyle = 'white'; ctx.fillRect(h.x, h.y, 20, 20);
            ctx.fillStyle = 'red'; ctx.fillRect(h.x+8, h.y+2, 4, 16); ctx.fillRect(h.x+2, h.y+8, 16, 4);
        });

        // Гравці
        for (let id in players) {
            const p = players[id];
            ctx.fillStyle = id === socket.id ? '#00ff00' : '#ff4444';
            ctx.fillRect(p.x, p.y, 30, 30);
            ctx.fillStyle = 'white'; ctx.fillText(p.username + " [" + p.score + "]", p.x, p.y - 20);
            ctx.fillStyle = 'red'; ctx.fillRect(p.x, p.y-10, 30, 5);
            ctx.fillStyle = 'lime'; ctx.fillRect(p.x, p.y-10, (p.hp/100)*30, 5);
        }

        // Кулі
        bullets.forEach(b => {
            ctx.fillStyle = 'yellow'; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI*2); ctx.fill();
        });

        ctx.restore();
        
        // Лідерборд (Топ-5)
        const sorted = Object.values(players).sort((a,b) => b.score - a.score).slice(0, 5);
        document.getElementById('leaderboard').innerHTML = sorted.map(s => `<div>${s.username}: ${s.score}</div>`).join('');
    }
    requestAnimationFrame(gameLoop);
}

socket.on('updatePlayers', d => players = d);
socket.on('updateBullets', d => bullets = d);
socket.on('updateHealthPacks', d => healthPacks = d);
const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let currentUser = null, players = {}, bullets = [], healthPacks = [], keys = {};
let lastShot = 0;
const MAP_SIZE = 2000;
const userImg = new Image();

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

function setPhoto() {
    const url = prompt("Вставте посилання на фото (URL):");
    if (url) {
        userImg.src = url;
        socket.emit('updatePhoto', url);
    }
}

function upgrade(type) { socket.emit('upgrade', type); }

canvas.addEventListener('mousedown', (e) => {
    const p = players[socket.id];
    if (!p || !p.alive || Date.now() - lastShot < p.fireRate) return;
    
    const rect = canvas.getBoundingClientRect();
    const targetX = e.clientX - rect.left - canvas.width / 2;
    const targetY = e.clientY - rect.top - canvas.height / 2;
    const angle = Math.atan2(targetY, targetX);
    
    socket.emit('shoot', { x: p.x + 15, y: p.y + 15, dx: Math.cos(angle) * 12, dy: Math.sin(angle) * 12 });
    lastShot = Date.now();
});

window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const me = players[socket.id];

    if (me && me.alive) {
        let moved = false;
        if (keys['w']) { me.y -= me.speed; moved = true; }
        if (keys['s']) { me.y += me.speed; moved = true; }
        if (keys['a']) { me.x -= me.speed; moved = true; }
        if (keys['d']) { me.x += me.speed; moved = true; }
        if (moved) socket.emit('move', { x: me.x, y: me.y });

        ctx.save();
        ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);

        // Сітка
        ctx.strokeStyle = '#333';
        for(let i=0; i<=MAP_SIZE; i+=100) {
            ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,MAP_SIZE); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(MAP_SIZE,i); ctx.stroke();
        }

        // Відображення гравців
        for (let id in players) {
            const p = players[id];
            if (!p.alive) continue;
            
            if (p.photo) {
                const img = new Image(); img.src = p.photo;
                ctx.drawImage(img, p.x, p.y, 30, 30);
            } else {
                ctx.fillStyle = id === socket.id ? '#00ff00' : '#ff4444';
                ctx.fillRect(p.x, p.y, 30, 30);
            }
            
            ctx.fillStyle = 'white'; ctx.fillText(`${p.username} (${p.coins}💰)`, p.x, p.y - 20);
        }

        bullets.forEach(b => {
            ctx.fillStyle = 'yellow'; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();
    }
    requestAnimationFrame(gameLoop);
}

socket.on('died', () => {
    document.getElementById('respawnMenu').style.display = 'block';
});

function respawn() {
    document.getElementById('respawnMenu').style.display = 'none';
    socket.emit('respawn');
}

socket.on('updatePlayers', d => players = d);
socket.on('updateBullets', d => bullets = d);

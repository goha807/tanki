const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth; canvas.height = window.innerHeight;

let players = {}, bullets = [], keys = {}, lastShot = 0;

// Розрахунок пінгу
setInterval(() => {
    const start = Date.now();
    socket.emit('ping');
    socket.once('pong', () => {
        document.getElementById('pingValue').innerText = Date.now() - start;
    });
}, 2000);

// Мобільне керування (спрощено)
const joystick = document.getElementById('joystick');
const shootBtn = document.getElementById('shootBtn');
let moveDir = { x: 0, y: 0 };

joystick.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    const rect = joystick.getBoundingClientRect();
    moveDir.x = (touch.clientX - rect.left - 50) / 50;
    moveDir.y = (touch.clientY - rect.top - 50) / 50;
});

shootBtn.addEventListener('touchstart', () => {
    const p = players[socket.id];
    if (p && p.alive) socket.emit('shoot', { x: p.x + 15, y: p.y + 15, dx: 10, dy: 0 }); // Стрільба вперед
});

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const me = players[socket.id];
    if (me && me.alive) {
        // Додаємо рух від джойстика до клавіш
        if (Math.abs(moveDir.x) > 0.1) me.x += moveDir.x * me.speed;
        if (Math.abs(moveDir.y) > 0.1) me.y += moveDir.y * me.speed;
        
        // Стандартні клавіші
        if (keys['w']) me.y -= me.speed;
        if (keys['s']) me.y += me.speed;
        if (keys['a']) me.x -= me.speed;
        if (keys['d']) me.x += me.speed;

        socket.emit('move', { x: me.x, y: me.y });

        ctx.save();
        ctx.translate(canvas.width/2 - me.x, canvas.height/2 - me.y);
        
        // Малюємо гравців та лідерборд
        for (let id in players) {
            const p = players[id];
            if (!p.alive) continue;
            ctx.fillStyle = id === socket.id ? '#00ff00' : '#ff4444';
            ctx.fillRect(p.x, p.y, 30, 30);
            ctx.fillStyle = 'white'; ctx.fillText(p.username, p.x, p.y - 10);
        }
        
        bullets.forEach(b => {
            ctx.fillStyle = 'yellow'; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();

        // Оновлюємо топ
        const sorted = Object.values(players).sort((a,b) => b.score - a.score).slice(0, 5);
        document.getElementById('leaderList').innerHTML = sorted.map(s => `<div>${s.username}: ${s.score}</div>`).join('');
        document.getElementById('coinCount').innerText = me.coins;
    }
    requestAnimationFrame(gameLoop);
}
// ... (додати функції auth, upgrade та решту з минулих повідомлень)

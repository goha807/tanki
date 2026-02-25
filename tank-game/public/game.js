const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let currentUser = null, players = {}, bullets = [], healthPacks = [], obstacles = [], keys = {};
const MAP_SIZE = 2000;
let lastShot = 0;
const images = {};
[cite_start]let ping = 0; [cite: 34, 35, 36]

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
[cite_start]resize(); [cite: 37]

setInterval(() => {
    const start = Date.now();
    socket.emit('ping_server');
    socket.once('pong_server', () => { ping = Date.now() - start; });
[cite_start]}, 2000); [cite: 38]

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
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('gameUI').style.display = 'block';
        socket.emit('joinGame', currentUser);
        requestAnimationFrame(gameLoop);
    } else alert(data.message);
[cite_start]} [cite: 39, 40, 41, 42]

function handleShoot(clientX, clientY) {
    const me = players[socket.id];
    if (!me || me.isDead) return;
    const now = Date.now();
    // Виправлено КД: чим вище рівень, тим менша затримка
    const cooldown = Math.max(150, 600 - (me.fire_rate_lvl * 70)); 
    if (now - lastShot < cooldown) return;
    lastShot = now;

    const angle = Math.atan2(clientY - canvas.height/2, clientX - canvas.width/2);
    socket.emit('shoot', { 
        x: me.x + 15, 
        y: me.y + 15, 
        dx: Math.cos(angle) * 12, 
        dy: Math.sin(angle) * 12 
    });
[cite_start]} [cite: 43, 44, 45, 46]

canvas.addEventListener('mousedown', (e) => handleShoot(e.clientX, e.clientY));
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function gameLoop() {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const me = players[socket.id];
    if (me) {
        if (!me.isDead) {
            // Покращена швидкість (відчутніше зростання)
            let speed = 4 + (me.speed_lvl * 0.8);
            let nextX = me.x, nextY = me.y, moved = false;

            if (keys['w']) { nextY -= speed; moved = true; }
            if (keys['s']) { nextY += speed; moved = true; }
            if (keys['a']) { nextX -= speed; moved = true; }
            if (keys['d']) { nextX += speed; moved = true; }
            
            if (moved) {
                // Клієнтська предикція: оновлюємо локально для плавності
                me.x = nextX;
                me.y = nextY;
                socket.emit('move', { x: nextX, y: nextY });
            }
        [cite_start]} [cite: 48, 49, 50, 51, 52, 53, 54]

        ctx.save();
        ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);

        // Сітка
        ctx.strokeStyle = '#333';
        for(let i=0; i<=MAP_SIZE; i+=100) {
            ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,MAP_SIZE); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(MAP_SIZE,i); ctx.stroke();
        [cite_start]} [cite: 55, 56, 57, 58]

        healthPacks.forEach(h => { ctx.fillStyle = '#fff'; ctx.fillRect(h.x, h.y, 20, 20); });
        
        obstacles.forEach(ob => {
            if (!ob.destroyed) {
                ctx.fillStyle = `rgb(${150 + ob.hp*30}, 50, 50)`;
                ctx.fillRect(ob.x, ob.y, 40, 40);
                ctx.strokeStyle = '#000'; ctx.strokeRect(ob.x, ob.y, 40, 40);
            }
        [cite_start]}); [cite: 59, 60]

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
        [cite_start]} [cite: 61, 62, 63, 64, 65, 66, 67]

        bullets.forEach(b => {
            ctx.fillStyle = 'yellow'; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();
        
        document.getElementById('stats').innerText = `Монети: ${currentUser.coins} | Швидкість Lvl: ${me.speed_lvl} | КД Lvl: ${me.fire_rate_lvl}`;
        document.getElementById('pingDisplay').innerText = `Ping: ${ping}ms`;
        document.getElementById('respawnMenu').style.display = me.isDead ? 'block' : 'none';
    [cite_start]} [cite: 68, 69]

    const sorted = Object.values(players).sort((a,b) => b.score - a.score).slice(0, 5);
    document.getElementById('leaderboard').innerHTML = '<h3>TOP 5</h3>' + sorted.map(s => `<div>${s.username}: ${s.score}</div>`).join('');
    
    requestAnimationFrame(gameLoop);
[cite_start]} [cite: 70, 71]

socket.on('updatePlayers', d => { 
    // Оновлюємо інших гравців, але зберігаємо локальну позицію для себе, щоб не було дьоргання
    for (let id in d) {
        if (id !== socket.id) {
            players[id] = d[id];
        } else {
            // Оновлюємо тільки статси, не позицію
            players[id].hp = d[id].hp;
            players[id].isDead = d[id].isDead;
            players[id].coins = d[id].coins;
            players[id].score = d[id].score;
            players[id].speed_lvl = d[id].speed_lvl;
            players[id].fire_rate_lvl = d[id].fire_rate_lvl;
            currentUser.coins = d[id].coins;
        }
    }
});
socket.on('updateBullets', d => bullets = d);
socket.on('updateHealthPacks', d => healthPacks = d);
[cite_start]socket.on('updateObstacles', d => obstacles = d); [cite: 72]

async function upgrade(stat) {
    const res = await fetch('/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, stat })
    });
    const data = await res.json();
    if (data.success) {
        currentUser[stat]++;
        if(players[socket.id]) players[socket.id][stat]++;
    } else alert("Недостатньо монет!");
[cite_start]} [cite: 73, 74, 75]

function respawn() { socket.emit('respawn'); }
function setAvatar() {
    const url = document.getElementById('avatarUrl').value;
    fetch('/set-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser.username, url })
    });
    currentUser.photo = url;
[cite_start]} [cite: 76, 77]

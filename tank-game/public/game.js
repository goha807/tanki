const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let currentUser = null, players = {}, bullets = [], healthPacks = [], obstacles = [], keys = {};
let boss = null;
const MAP_SIZE = 2000;
let lastShot = 0;
const images = {};
let ping = 0;

function resize() {
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

setInterval(() => {
const start = Date.now();
socket.emit('ping_server');
socket.once('pong_server', () => { ping = Date.now() - start; });
}, 2000);

async function auth(type) {
const u = document.getElementById('username').value;
const p = document.getElementById('password').value;
if(!u || !p) return alert("Введіть нік та пароль!");
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
}

function handleShoot(clientX, clientY) {
const me = players[socket.id];
if (!me || me.isDead) return;
const now = Date.now();
const cooldown = Math.max(150, 600 - (me.fire_rate_lvl * 60));
if (now - lastShot < cooldown) return;
lastShot = now;
const angle = Math.atan2(clientY - canvas.height/2, clientX - canvas.width/2);
socket.emit('shoot', {
x: me.x + 15,
y: me.y + 15,
dx: Math.cos(angle) * 12,
dy: Math.sin(angle) * 12
});
}

canvas.addEventListener('mousedown', (e) => handleShoot(e.clientX, e.clientY));
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

function drawTank3D(x, y, angle, color, isLocal) {
ctx.save();
ctx.translate(x + 15, y + 15);
ctx.rotate(angle);
const shadowOffset = isLocal ? 8 : 5;
ctx.fillStyle = 'rgba(0,0,0,0.4)';
ctx.fillRect(-18 + shadowOffset, -18 + shadowOffset, 36, 36);
const gradient = ctx.createRadialGradient(-5, -5, 0, 0, 0, 25);
gradient.addColorStop(0, lightenColor(color, 40));
gradient.addColorStop(0.5, color);
gradient.addColorStop(1, darkenColor(color, 30));
ctx.fillStyle = gradient;
ctx.fillRect(-18, -18, 36, 36);
ctx.strokeStyle = darkenColor(color, 50);
ctx.lineWidth = 2;
ctx.strokeRect(-18, -18, 36, 36);
ctx.fillStyle = '#333';
ctx.fillRect(-8, -20, 16, 25);
const barrelGrad = ctx.createLinearGradient(-6, -25, 6, -25);
barrelGrad.addColorStop(0, '#555');
barrelGrad.addColorStop(0.5, '#888');
barrelGrad.addColorStop(1, '#555');
ctx.fillStyle = barrelGrad;
ctx.fillRect(-6, -25, 12, 25);
ctx.strokeStyle = '#222';
ctx.lineWidth = 1;
ctx.strokeRect(-6, -25, 12, 25);
ctx.fillStyle = '#111';
ctx.beginPath();
ctx.arc(0, 0, 10, 0, Math.PI * 2);
ctx.fill();
ctx.strokeStyle = '#444';
ctx.lineWidth = 2;
ctx.stroke();
if (isLocal) {
ctx.strokeStyle = '#00ff00';
ctx.lineWidth = 2;
ctx.strokeRect(-22, -22, 44, 44);
}
ctx.restore();
}

function drawBoss3D(x, y, angle, hp, maxHp) {
ctx.save();
ctx.translate(x, y);
ctx.rotate(angle);
ctx.fillStyle = 'rgba(139, 0, 0, 0.5)';
ctx.fillRect(-45, -45, 90, 90);
const gradient = ctx.createRadialGradient(-10, -10, 0, 0, 0, 40);
gradient.addColorStop(0, '#ff4444');
gradient.addColorStop(0.5, '#aa0000');
gradient.addColorStop(1, '#660000');
ctx.fillStyle = gradient;
ctx.fillRect(-40, -40, 80, 80);
ctx.strokeStyle = '#ff0000';
ctx.lineWidth = 4;
ctx.strokeRect(-40, -40, 80, 80);
ctx.fillStyle = '#440000';
ctx.fillRect(-12, -35, 24, 40);
const barrelGrad = ctx.createLinearGradient(-8, -45, 8, -45);
barrelGrad.addColorStop(0, '#660000');
barrelGrad.addColorStop(0.5, '#aa0000');
barrelGrad.addColorStop(1, '#660000');
ctx.fillStyle = barrelGrad;
ctx.fillRect(-8, -45, 16, 40);
ctx.strokeStyle = '#ff0000';
ctx.lineWidth = 2;
ctx.strokeRect(-8, -45, 16, 40);
ctx.fillStyle = '#330000';
ctx.beginPath();
ctx.arc(0, 0, 18, 0, Math.PI * 2);
ctx.fill();
ctx.strokeStyle = '#ff4444';
ctx.lineWidth = 3;
ctx.stroke();
ctx.restore();
const barWidth = 100;
const barHeight = 12;
ctx.fillStyle = 'rgba(0,0,0,0.7)';
ctx.fillRect(x - barWidth/2, y - 70, barWidth, barHeight);
const hpPercent = hp / maxHp;
const hpGradient = ctx.createLinearGradient(x - barWidth/2, 0, x + barWidth/2, 0);
hpGradient.addColorStop(0, '#ff0000');
hpGradient.addColorStop(0.5, '#ff6600');
hpGradient.addColorStop(1, '#ffff00');
ctx.fillStyle = hpGradient;
ctx.fillRect(x - barWidth/2 + 2, y - 68, (barWidth - 4) * hpPercent, barHeight - 4);
ctx.strokeStyle = '#fff';
ctx.lineWidth = 1;
ctx.strokeRect(x - barWidth/2, y - 70, barWidth, barHeight);
ctx.fillStyle = '#fff';
ctx.font = 'bold 14px Arial';
ctx.textAlign = 'center';
ctx.fillText(`BOSS ${Math.ceil(hp)}/${maxHp}`, x, y - 75);
}

function lightenColor(color, percent) {
const num = parseInt(color.replace('#',''), 16);
const amt = Math.round(2.55 * percent);
const R = Math.min(255, (num >> 16) + amt);
const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
const B = Math.min(255, (num & 0x0000FF) + amt);
return '#' + (0x1000000 + R*0x10000 + G*0x100 + B).toString(16).slice(1);
}

function darkenColor(color, percent) {
const num = parseInt(color.replace('#',''), 16);
const amt = Math.round(2.55 * percent);
const R = Math.max(0, (num >> 16) - amt);
const G = Math.max(0, (num >> 8 & 0x00FF) - amt);
const B = Math.max(0, (num & 0x0000FF) - amt);
return '#' + (0x1000000 + R*0x10000 + G*0x100 + B).toString(16).slice(1);
}

function gameLoop() {
ctx.fillStyle = '#1a1a2e';
ctx.fillRect(0, 0, canvas.width, canvas.height);
const me = players[socket.id];
if (me) {
if (!me.isDead) {
let speed = 4 + (me.speed_lvl * 0.7);
let nextX = me.x, nextY = me.y, moved = false;
if (keys['w']) { nextY -= speed; moved = true; }
if (keys['s']) { nextY += speed; moved = true; }
if (keys['a']) { nextX -= speed; moved = true; }
if (keys['d']) { nextX += speed; moved = true; }
if (moved) {
me.x = nextX; me.y = nextY;
socket.emit('move', { x: nextX, y: nextY });
}
}
ctx.save();
ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);
ctx.strokeStyle = '#2a2a4e';
ctx.lineWidth = 1;
for(let i=0; i<=MAP_SIZE; i+=100) {
ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,MAP_SIZE); ctx.stroke();
ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(MAP_SIZE,i); ctx.stroke();
}
ctx.fillStyle = 'rgba(0, 255, 100, 0.05)';
for(let i=0; i<MAP_SIZE; i+=200) {
for(let j=0; j<MAP_SIZE; j+=200) {
if ((i/200 + j/200) % 2 === 0) {
ctx.fillRect(i, j, 200, 200);
}
}
}
healthPacks.forEach(h => {
ctx.shadowColor = '#00ff00';
ctx.shadowBlur = 15;
ctx.fillStyle = '#00ff00';
ctx.beginPath();
ctx.arc(h.x + 10, h.y + 10, 12, 0, Math.PI * 2);
ctx.fill();
ctx.fillStyle = '#fff';
ctx.font = '16px Arial';
ctx.textAlign = 'center';
ctx.fillText('+', h.x + 10, h.y + 15);
ctx.shadowBlur = 0;
});
obstacles.forEach(ob => {
if (!ob.destroyed) {
const height = 30 + ob.hp * 5;
ctx.fillStyle = `rgba(100, 50, 50, 0.8)`;
ctx.fillRect(ob.x, ob.y, 40, 40);
ctx.fillStyle = `rgb(${150 + ob.hp*30}, 80, 80)`;
ctx.fillRect(ob.x + 3, ob.y + 3, 34, 34);
ctx.fillStyle = `rgb(${200 + ob.hp*20}, 100, 100)`;
ctx.fillRect(ob.x + 8, ob.y + 8, 24, 24);
ctx.fillStyle = '#fff';
ctx.font = 'bold 12px Arial';
ctx.textAlign = 'center';
ctx.fillText(ob.hp, ob.x + 20, ob.y + 24);
}
});
for (let id in players) {
const p = players[id];
if (p.isDead) continue;
const angle = id === socket.id ? 
Math.atan2(mouseY - canvas.height/2, mouseX - canvas.width/2) : 
Math.atan2(p.y - me.y, p.x - me.x);
drawTank3D(p.x, p.y, angle, id === socket.id ? '#00aa00' : '#aa0000', id === socket.id);
ctx.fillStyle = 'white';
ctx.font = 'bold 13px Arial';
ctx.textAlign = 'center';
ctx.fillText(p.username, p.x + 15, p.y - 30);
ctx.fillStyle = '#333';
ctx.fillRect(p.x - 15, p.y - 22, 30, 6);
ctx.fillStyle = p.hp > 60 ? '#00ff00' : p.hp > 30 ? '#ffaa00' : '#ff0000';
ctx.fillRect(p.x - 15, p.y - 22, (p.hp/100)*30, 6);
}
if (boss && bossActive) {
drawBoss3D(boss.x, boss.y, boss.moveDir, boss.hp, boss.maxHp);
}
bullets.forEach(b => {
if (b.isBossBullet) {
ctx.shadowColor = '#ff0000';
ctx.shadowBlur = 10;
ctx.fillStyle = '#ff4400';
ctx.beginPath();
ctx.arc(b.x, b.y, 7, 0, Math.PI*2);
ctx.fill();
ctx.fillStyle = '#ffff00';
ctx.beginPath();
ctx.arc(b.x, b.y, 4, 0, Math.PI*2);
ctx.fill();
} else {
ctx.shadowColor = '#ffff00';
ctx.shadowBlur = 8;
ctx.fillStyle = '#ffdd00';
ctx.beginPath();
ctx.arc(b.x, b.y, 5, 0, Math.PI*2);
ctx.fill();
ctx.fillStyle = '#fff';
ctx.beginPath();
ctx.arc(b.x, b.y, 2.5, 0, Math.PI*2);
ctx.fill();
}
ctx.shadowBlur = 0;
});
ctx.restore();
document.getElementById('stats').innerText = `💰 ${currentUser.coins} | ⚡ L${me.speed_lvl} | 🎯 L${me.fire_rate_lvl} | 💥 L${me.damage_lvl}`;
document.getElementById('pingDisplay').innerText = `Ping: ${ping}ms`;
document.getElementById('respawnMenu').style.display = me.isDead ? 'block' : 'none';
if (bossActive) {
document.getElementById('bossWarning').style.display = 'block';
} else {
document.getElementById('bossWarning').style.display = 'none';
}
}
const sorted = Object.values(players).sort((a,b) => b.score - a.score).slice(0, 5);
document.getElementById('leaderboard').innerHTML = '<h3>🏆 TOP 5</h3>' + sorted.map(s => `<div>${s.username}: ${s.score}</div>`).join('');
requestAnimationFrame(gameLoop);
}

let mouseX = 0, mouseY = 0;
canvas.addEventListener('mousemove', (e) => {
mouseX = e.clientX;
mouseY = e.clientY;
});

socket.on('updatePlayers', d => {
for (let id in d) {
if (id !== socket.id) players[id] = d[id];
else {
if(!players[id]) players[id] = d[id];
players[id].hp = d[id].hp;
players[id].isDead = d[id].isDead;
players[id].coins = d[id].coins;
players[id].speed_lvl = d[id].speed_lvl;
players[id].fire_rate_lvl = d[id].fire_rate_lvl;
players[id].damage_lvl = d[id].damage_lvl;
players[id].range_lvl = d[id].range_lvl;
currentUser.coins = d[id].coins;
}
}
});

socket.on('updateBullets', d => bullets = d);
socket.on('updateHealthPacks', d => healthPacks = d);
socket.on('updateObstacles', d => obstacles = d);
socket.on('bossSpawn', d => { boss = d; bossActive = true; });
socket.on('bossUpdate', d => { boss = d; });
socket.on('bossDefeated', () => { 
boss = null; 
bossActive = false;
showNotification('🎉 БОССА ЗНИЩЕНО! +500 монет');
});

function showNotification(text) {
const notif = document.createElement('div');
notif.style.cssText = `
position: fixed;
top: 100px;
left: 50%;
transform: translateX(-50%);
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
color: white;
padding: 20px 40px;
border-radius: 10px;
font-size: 20px;
font-weight: bold;
z-index: 1000;
box-shadow: 0 10px 30px rgba(0,0,0,0.5);
animation: slideDown 0.5s ease;
`;
notif.textContent = text;
document.body.appendChild(notif);
setTimeout(() => {
notif.remove();
}, 3000);
}

async function upgrade(stat) {
const costs = { speed_lvl: 100, fire_rate_lvl: 150, damage_lvl: 200, range_lvl: 100 };
const cost = costs[stat] || 100;
if (currentUser.coins < cost) {
alert(`Недостатньо монет! Потрібно: ${cost}`);
return;
}
const res = await fetch('/upgrade', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ username: currentUser.username, stat })
});
const data = await res.json();
if (data.success) {
currentUser[stat]++;
if(players[socket.id]) players[socket.id][stat]++;
showNotification(`⬆️ ${stat} прокачано!`);
} else {
alert("Недостатньо монет!");
}
}

function respawn() { socket.emit('respawn'); }
function setAvatar() {
const url = document.getElementById('avatarUrl').value;
fetch('/set-avatar', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ username: currentUser.username, url })
}).then(() => { currentUser.photo = url; });
}

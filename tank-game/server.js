const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const MAP_SIZE = 2000;
const OBSTACLE_COUNT = 40;
app.use(express.static('public'));
app.use(express.json());
const db = mysql.createConnection({
host: process.env.MYSQLHOST,
user: process.env.MYSQLUSER,
password: process.env.MYSQLPASSWORD,
database: process.env.MYSQLDATABASE,
port: process.env.MYSQLPORT || 3306
});
db.connect();
let players = {};
let bullets = [];
let healthPacks = [];
let obstacles = [];
let boss = null;
let bossActive = false;
let bossSpawnTime = Date.now() + 300000;

function initObstacles() {
for (let i = 0; i < OBSTACLE_COUNT; i++) {
obstacles.push({
id: i,
x: Math.floor(Math.random() * (MAP_SIZE - 60) + 30),
y: Math.floor(Math.random() * (MAP_SIZE - 60) + 30),
hp: 3,
destroyed: false,
respawnTimer: 0
});
}
}
initObstacles();

function spawnBoss() {
bossActive = true;
boss = {
x: Math.random() * (MAP_SIZE - 400) + 200,
y: Math.random() * (MAP_SIZE - 400) + 200,
hp: 5000,
maxHp: 5000,
angle: 0,
lastShot: 0,
moveDir: Math.random() * Math.PI * 2
};
io.emit('bossSpawn', boss);
}

setInterval(() => {
if (!bossActive && Date.now() > bossSpawnTime) {
spawnBoss();
}
if (bossActive && boss) {
let moveSpeed = 1.5;
boss.x += Math.cos(boss.moveDir) * moveSpeed;
boss.y += Math.sin(boss.moveDir) * moveSpeed;
if (boss.x < 50 || boss.x > MAP_SIZE - 50) boss.moveDir = Math.PI - boss.moveDir;
if (boss.y < 50 || boss.y > MAP_SIZE - 50) boss.moveDir = -boss.moveDir;
boss.x = Math.max(50, Math.min(MAP_SIZE - 50, boss.x));
boss.y = Math.max(50, Math.min(MAP_SIZE - 50, boss.y));
const now = Date.now();
if (now - boss.lastShot > 2000) {
boss.lastShot = now;
const targets = Object.values(players).filter(p => !p.isDead);
if (targets.length > 0) {
const target = targets[Math.floor(Math.random() * targets.length)];
const angle = Math.atan2(target.y - boss.y, target.x - boss.x);
bullets.push({
x: boss.x,
y: boss.y,
dx: Math.cos(angle) * 8,
dy: Math.sin(angle) * 8,
owner: 'boss',
rangeLvl: 0,
isBossBullet: true
});
}
}
io.emit('bossUpdate', boss);
}
if (healthPacks.length < 25) {
healthPacks.push({ id: Math.random(), x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE });
io.emit('updateHealthPacks', healthPacks);
}
obstacles.forEach(ob => {
if (ob.destroyed && Date.now() > ob.respawnTimer) {
ob.destroyed = false;
ob.hp = 3;
io.emit('updateObstacles', obstacles);
}
});
}, 5000);

setInterval(() => {
bullets.forEach((b, index) => {
b.x += b.dx; b.y += b.dy;
b.dist = (b.dist || 0) + Math.sqrt(b.dx**2 + b.dy**2);
const maxDist = 400 + (b.rangeLvl * 100);
for (let ob of obstacles) {
if (!ob.destroyed && b.x > ob.x && b.x < ob.x + 40 && b.y > ob.y && b.y < ob.y + 40) {
ob.hp--;
if (ob.hp <= 0) {
ob.destroyed = true;
ob.respawnTimer = Date.now() + 15000;
}
bullets.splice(index, 1);
io.emit('updateObstacles', obstacles);
return;
}
}
if (bossActive && boss && b.x > boss.x - 35 && b.x < boss.x + 35 && b.y > boss.y - 35 && b.y < boss.y + 35 && b.owner !== 'boss') {
boss.hp -= 10 + (players[b.owner] ? players[b.owner].damage_lvl * 2 : 0);
bullets.splice(index, 1);
if (boss.hp <= 0) {
bossActive = false;
boss = null;
bossSpawnTime = Date.now() + 300000;
Object.values(players).forEach(p => {
if (!p.isDead && p.x > boss.x - 300 && p.x < boss.x + 300 && p.y > boss.y - 300 && p.y < boss.y + 300) {
p.coins += 500;
p.score += 100;
db.query('UPDATE users SET coins = coins + 500, score = score + 100 WHERE username = ?', [p.username]);
}
});
io.emit('bossDefeated');
}
io.emit('bossUpdate', boss);
return;
}
if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE || b.dist > maxDist) {
bullets.splice(index, 1);
return;
}
for (let id in players) {
let p = players[id];
if (!p.isDead && id !== b.owner && b.x > p.x && b.x < p.x + 30 && b.y > p.y && b.y < p.y + 30) {
const damage = b.isBossBullet ? 35 : 20;
p.hp -= damage;
bullets.splice(index, 1);
if (p.hp <= 0) {
p.hp = 0;
p.isDead = true;
if (players[b.owner] && b.owner !== 'boss') {
players[b.owner].score += 10;
players[b.owner].coins += 50;
db.query('UPDATE users SET score = score + 10, coins = coins + 50 WHERE username = ?', [players[b.owner].username]);
}
}
io.emit('updatePlayers', players);
break;
}
}
});
for (let id in players) {
let p = players[id];
if (p.isDead) continue;
healthPacks.forEach((hp, idx) => {
if (p.x < hp.x + 20 && p.x + 30 > hp.x && p.y < hp.y + 20 && p.y + 30 > hp.y) {
if (p.hp < 100) {
p.hp = Math.min(100, p.hp + 40);
healthPacks.splice(idx, 1);
io.emit('updateHealthPacks', healthPacks);
io.emit('updatePlayers', players);
}
}
});
}
io.emit('updateBullets', bullets);
}, 1000 / 60);

io.on('connection', (socket) => {
socket.emit('updateObstacles', obstacles);
if (bossActive) socket.emit('bossSpawn', boss);
socket.on('joinGame', (user) => {
const startX = Math.random() * (MAP_SIZE - 100) + 50;
const startY = Math.random() * (MAP_SIZE - 100) + 50;
players[socket.id] = { id: socket.id, ...user, x: startX, y: startY, hp: 100, isDead: false };
io.emit('updatePlayers', players);
});
socket.on('move', (data) => {
if (players[socket.id] && !players[socket.id].isDead) {
let canMove = true;
for(let ob of obstacles) {
if(!ob.destroyed && data.x < ob.x + 40 && data.x + 30 > ob.x && data.y < ob.y + 40 && data.y + 30 > ob.y) {
canMove = false; break;
}
}
if (bossActive && boss) {
if (data.x > boss.x - 35 && data.x < boss.x + 35 && data.y > boss.y - 35 && data.y < boss.y + 35) {
canMove = false;
}
}
if(canMove) {
players[socket.id].x = data.x;
players[socket.id].y = data.y;
}
io.emit('updatePlayers', players);
}
});
socket.on('shoot', (data) => {
if (players[socket.id] && !players[socket.id].isDead) {
bullets.push({ ...data, owner: socket.id, rangeLvl: players[socket.id].range_lvl });
}
});
socket.on('respawn', () => {
if (players[socket.id]) {
players[socket.id].hp = 100;
players[socket.id].isDead = false;
players[socket.id].x = Math.random() * (MAP_SIZE - 100) + 50;
players[socket.id].y = Math.random() * (MAP_SIZE - 100) + 50;
io.emit('updatePlayers', players);
}
});
socket.on('disconnect', () => { delete players[socket.id]; io.emit('updatePlayers', players); });
socket.on('ping_server', () => socket.emit('pong_server'));
});

app.post('/auth', (req, res) => {
const { username, password, type } = req.body;
if (type === 'login') {
db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
if (results && results.length > 0) res.json({ success: true, user: results[0] });
else res.json({ success: false, message: 'Помилка входу' });
});
} else {
db.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password], (err) => {
if (err) res.json({ success: false, message: 'Нік зайнятий' });
else res.json({ success: true, user: { username, score: 0, coins: 0, speed_lvl: 1, range_lvl: 1, fire_rate_lvl: 1, damage_lvl: 1, photo: null } });
});
}
});

app.post('/upgrade', (req, res) => {
const { username, stat } = req.body;
const costs = { speed_lvl: 100, fire_rate_lvl: 150, damage_lvl: 200, range_lvl: 100 };
const cost = costs[stat] || 100;
db.query(`UPDATE users SET ${stat} = ${stat} + 1, coins = coins - ${cost} WHERE username = ? AND coins >= ${cost}`, [username], (err, result) => {
if (result && result.affectedRows > 0) res.json({ success: true });
else res.json({ success: false });
});
});

app.post('/set-avatar', (req, res) => {
const { username, url } = req.body;
db.query('UPDATE users SET photo = ? WHERE username = ?', [url, username], () => res.json({ success: true }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));

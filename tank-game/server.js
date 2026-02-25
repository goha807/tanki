const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MAP_SIZE = 2000;

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

setInterval(() => {
    if (healthPacks.length < 25) {
        healthPacks.push({ id: Math.random(), x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE });
        io.emit('updateHealthPacks', healthPacks);
    }
}, 5000);

setInterval(() => {
    bullets.forEach((b, index) => {
        b.x += b.dx; b.y += b.dy;
        b.dist = (b.dist || 0) + Math.sqrt(b.dx**2 + b.dy**2);

        // Дальність польоту залежить від прокачки
        const maxDist = 400 + (b.rangeLvl * 100);
        if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE || b.dist > maxDist) {
            bullets.splice(index, 1);
            return;
        }

        for (let id in players) {
            let p = players[id];
            if (!p.isDead && id !== b.owner && b.x > p.x && b.x < p.x + 30 && b.y > p.y && b.y < p.y + 30) {
                p.hp -= 20;
                bullets.splice(index, 1);
                if (p.hp <= 0) {
                    p.hp = 0;
                    p.isDead = true;
                    if (players[b.owner]) {
                        players[b.owner].score += 10;
                        players[b.owner].coins += 50; // +50 монет за кіл
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
            else res.json({ success: true, user: { username, score: 0, coins: 0, speed_lvl: 1, range_lvl: 1, fire_rate_lvl: 1 } });
        });
    }
});

app.post('/upgrade', (req, res) => {
    const { username, stat } = req.body;
    const costs = { speed_lvl: 100, range_lvl: 100, fire_rate_lvl: 100 };
    db.query(`UPDATE users SET ${stat} = ${stat} + 1, coins = coins - 100 WHERE username = ? AND coins >= 100`, [username], (err, result) => {
        if (result.affectedRows > 0) res.json({ success: true });
        else res.json({ success: false });
    });
});

app.post('/set-avatar', (req, res) => {
    const { username, url } = req.body;
    db.query('UPDATE users SET avatar_url = ? WHERE username = ?', [url, username], () => res.json({ success: true }));
});

io.on('connection', (socket) => {
    socket.on('joinGame', (user) => {
        players[socket.id] = { 
            id: socket.id, 
            ...user, 
            x: Math.random()*500, y: Math.random()*500, 
            hp: 100, isDead: false 
        };
        io.emit('updatePlayers', players);
    });
    socket.on('move', (data) => { if (players[socket.id]) { Object.assign(players[socket.id], data); io.emit('updatePlayers', players); } });
    socket.on('shoot', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            bullets.push({ ...data, owner: socket.id, rangeLvl: players[socket.id].range_lvl });
        }
    });
    socket.on('respawn', () => {
        if (players[socket.id]) {
            players[socket.id].hp = 100;
            players[socket.id].isDead = false;
            players[socket.id].x = Math.random() * (MAP_SIZE - 50);
            players[socket.id].y = Math.random() * (MAP_SIZE - 50);
            io.emit('updatePlayers', players);
        }
    });
    socket.on('disconnect', () => { delete players[socket.id]; io.emit('updatePlayers', players); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));

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

setInterval(() => {
    bullets.forEach((b, index) => {
        b.x += b.dx; b.y += b.dy;
        b.dist -= Math.sqrt(b.dx**2 + b.dy**2);
        if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE || b.dist <= 0) {
            bullets.splice(index, 1); return;
        }
        for (let id in players) {
            let p = players[id];
            if (!p.alive || id === b.owner) continue;
            if (b.x > p.x && b.x < p.x + 30 && b.y > p.y && b.y < p.y + 30) {
                p.hp -= 20; bullets.splice(index, 1);
                if (p.hp <= 0) {
                    p.alive = false;
                    if (players[b.owner]) {
                        players[b.owner].score += 10;
                        players[b.owner].coins += 50;
                        db.query('UPDATE users SET score = score + 10, coins = coins + 50 WHERE username = ?', [players[b.owner].username]);
                    }
                    io.to(id).emit('died');
                }
                io.emit('updatePlayers', players); break;
            }
        }
    });
    io.emit('updateBullets', bullets);
}, 1000 / 60);

app.post('/auth', (req, res) => {
    const { username, password, type } = req.body;
    if (type === 'login') {
        db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
            if (results && results.length > 0) res.json({ success: true, user: results[0] });
            else res.json({ success: false, message: 'Помилка' });
        });
    } else {
        db.query('INSERT INTO users (username, password, score, coins) VALUES (?, ?, 0, 0)', [username, password], (err) => {
            if (err) res.json({ success: false, message: 'Зайнято' });
            else res.json({ success: true, user: { username, score: 0, coins: 0 } });
        });
    }
});

io.on('connection', (socket) => {
    socket.on('joinGame', (user) => {
        players[socket.id] = { 
            id: socket.id, username: user.username, x: Math.random()*500, y: Math.random()*500, 
            hp: 100, score: user.score || 0, coins: user.coins || 0,
            speed: 4, fireRate: 500, range: 600, alive: true, photo: null 
        };
        io.emit('updatePlayers', players);
    });

    socket.on('ping', () => socket.emit('pong')); // Для вимірювання пінгу

    socket.on('move', (data) => {
        if (players[socket.id] && players[socket.id].alive) {
            Object.assign(players[socket.id], data);
            socket.broadcast.emit('updatePlayers', players);
        }
    });

    socket.on('shoot', (data) => {
        const p = players[socket.id];
        if (p && p.alive) bullets.push({ ...data, owner: socket.id, dist: p.range });
    });

    socket.on('respawn', () => {
        if (players[socket.id]) {
            players[socket.id].hp = 100; players[socket.id].alive = true;
            io.emit('updatePlayers', players);
        }
    });
});

server.listen(process.env.PORT || 3000);

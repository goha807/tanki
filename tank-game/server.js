const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MAP_SIZE = 2000; // Велика карта

app.use(express.static('public'));
app.use(express.json());

// Підключення до бази даних Railway через змінні оточення
const db = mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306
});

db.connect(err => {
    if (err) {
        console.error('Помилка БД (перевірте змінні Variables в Railway):', err);
    } else {
        console.log('Успішно підключено до бази даних Railway!');
    }
});

let players = {};
let bullets = [];
let healthPacks = [];

// Створення аптечок кожні 5 секунд
setInterval(() => {
    if (healthPacks.length < 20) {
        healthPacks.push({ id: Math.random(), x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE });
        io.emit('updateHealthPacks', healthPacks);
    }
}, 5000);

setInterval(() => {
    // Логіка куль
    bullets.forEach((b, index) => {
        b.x += b.dx; b.y += b.dy;
        if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE) {
            bullets.splice(index, 1);
            return;
        }
        for (let id in players) {
            let p = players[id];
            if (id !== b.owner && b.x > p.x && b.x < p.x + 30 && b.y > p.y && b.y < p.y + 30) {
                p.hp -= 20;
                bullets.splice(index, 1);
                if (p.hp <= 0) {
                    p.hp = 100; p.x = Math.random() * (MAP_SIZE - 50); p.y = Math.random() * (MAP_SIZE - 50);
                    if (players[b.owner]) {
                        players[b.owner].score += 10;
                        db.query('UPDATE users SET score = score + 10 WHERE username = ?', [players[b.owner].username]);
                    }
                }
                io.emit('updatePlayers', players);
                break;
            }
        }
    });

    // Перевірка аптечок
    for (let id in players) {
        let p = players[id];
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
            else res.json({ success: false, message: 'Помилка входу або невірні дані' });
        });
    } else {
        db.query('INSERT INTO users (username, password, score) VALUES (?, ?, 0)', [username, password], (err) => {
            if (err) res.json({ success: false, message: 'Цей нікнейм вже зайнятий' });
            else res.json({ success: true, user: { username, score: 0 } });
        });
    }
});

io.on('connection', (socket) => {
    socket.on('joinGame', (user) => {
        players[socket.id] = { id: socket.id, username: user.username, x: Math.random()*500, y: Math.random()*500, hp: 100, score: user.score || 0 };
        io.emit('updatePlayers', players);
    });
    socket.on('move', (data) => { if (players[socket.id]) { Object.assign(players[socket.id], data); io.emit('updatePlayers', players); } });
    socket.on('shoot', (data) => bullets.push({ ...data, owner: socket.id }));
    socket.on('disconnect', () => { delete players[socket.id]; io.emit('updatePlayers', players); });
});

// Використання порту, який надає Railway
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер танків запущено на порту ${PORT}`);
});

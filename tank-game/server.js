const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MAP_SIZE = 2000;
const OBSTACLE_SIZE = 60; // Розмір перешкоди

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

// Створюємо перешкоди
function initObstacles() {
    obstacles = [];
    for (let i = 0; i < 30; i++) {
        obstacles.push({
            id: i,
            x: Math.random() * (MAP_SIZE - OBSTACLE_SIZE),
            y: Math.random() * (MAP_SIZE - OBSTACLE_SIZE),
            hp: 3,
            isDestroyed: false,
            respawnTime: 0
        });
    }
}
initObstacles();

setInterval(() => {
    if (healthPacks.length < 25) {
        healthPacks.push({ id: Math.random(), x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE });
        io.emit('updateHealthPacks', healthPacks);
    }

    // Регенерація перешкод
    let changed = false;
    const now = Date.now();
    obstacles.forEach(ob => {
        if (ob.isDestroyed && now > ob.respawnTime) {
            ob.isDestroyed = false;
            ob.hp = 3;
            changed = true;
        }
    });
    if (changed) io.emit('updateObstacles', obstacles);
}, 5000);

setInterval(() => {
    bullets.forEach((b, index) => {
        b.x += b.dx; b.y += b.dy;
        b.dist = (b.dist || 0) + Math.sqrt(b.dx**2 + b.dy**2);
        const maxDist = 400 + (b.rangeLvl * 100);

        // Колізія з межами карти або дистанцією
        if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE || b.dist > maxDist) {
            bullets.splice(index, 1);
            return;
        }

        // Колізія куль з перешкодами
        for (let ob of obstacles) {
            if (!ob.isDestroyed && b.x > ob.x && b.x < ob.x + OBSTACLE_SIZE && b.y > ob.y && b.y < ob.y + OBSTACLE_SIZE) {
                ob.hp -= 1;
                bullets.splice(index, 1);
                if (ob.hp <= 0) {
                    ob.isDestroyed = true;
                    ob.respawnTime = Date.now() + 15000; // Респ через 15 сек
                }
                io.emit('updateObstacles', obstacles);
                return;
            }
        }

        // Колізія з гравцями
        for (let id in players) {
            let p = players[id];
            if (!p.isDead && id !== b.owner && b.x > p.x && b.x < p.x + 30 && b.y > p.y && b.y < p.y + 30) {
                p.hp -= 20;
                bullets.splice(index, 1);
                if (p.hp <= 0) {
                    p.hp = 0; p.isDead = true;
                    if (players[b.owner]) {
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

    io.emit('updateBullets', bullets);
}, 1000 / 60);

io.on('connection', (socket) => {
    socket.on('ping_server', () => socket.emit('pong_server'));

    socket.on('joinGame', (user) => {
        players[socket.id] = { id: socket.id, ...user, x: 100, y: 100, hp: 100, isDead: false };
        socket.emit('updateObstacles', obstacles);
        io.emit('updatePlayers', players);
    });

    socket.on('move', (data) => { 
        if (players[socket.id]) { 
            // Перевірка, щоб гравець не заїжджав у стіни
            let canMove = true;
            for (let ob of obstacles) {
                if (!ob.isDestroyed && data.x + 30 > ob.x && data.x < ob.x + OBSTACLE_SIZE && data.y + 30 > ob.y && data.y < ob.y + OBSTACLE_SIZE) {
                    canMove = false;
                    break;
                }
            }
            if (canMove) {
                Object.assign(players[socket.id], data); 
                io.emit('updatePlayers', players);
            }
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
            players[socket.id].x = Math.random() * 500;
            players[socket.id].y = Math.random() * 500;
            io.emit('updatePlayers', players);
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; io.emit('updatePlayers', players); });
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
            else res.json({ success: true, user: { username, score: 0, coins: 0, speed_lvl: 1, range_lvl: 1, fire_rate_lvl: 1, photo: null } });
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));

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

// Підключення до БД
const db = mysql.createConnection({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306
});
db.connect(err => {
    if (err) console.error('Помилка БД:', err);
    else console.log('БД підключено');
});

let players = {};
let bullets = [];
let healthPacks = [];
let obstacles = [];

// Створення перешкод
function initObstacles() {
    obstacles = [];
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

// Спавн аптечок та відновлення стін
setInterval(() => {
    if (healthPacks.length < 25) {
        healthPacks.push({ id: Math.random(), x: Math.random() * (MAP_SIZE - 20), y: Math.random() * (MAP_SIZE - 20) });
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

// Головний ігровий цикл сервера (60 FPS)
setInterval(() => {
    // Рух куль та зіткнення
    bullets.forEach((b, index) => {
        b.x += b.dx; 
        b.y += b.dy;
        b.dist = (b.dist || 0) + Math.sqrt(b.dx**2 + b.dy**2);
        const maxDist = 400 + (b.rangeLvl * 100);

        // Попадання в стіни
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

        // Вихід за межі або дистанцію
        if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE || b.dist > maxDist) {
            bullets.splice(index, 1);
            return;
        }

        // Попадання в гравців
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
                        players[b.owner].coins += 50;
                        db.query('UPDATE users SET score = score + 10, coins = coins + 50 WHERE username = ?', [players[b.owner].username]);
                    }
                }
                io.emit('updatePlayers', players);
                break;
            }
        }
    });

    // Підбір аптечок
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

    socket.on('joinGame', (user) => {
        const startX = Math.random() * (MAP_SIZE - 100) + 50;
        const startY = Math.random() * (MAP_SIZE - 100) + 50;
        players[socket.id] = { id: socket.id, ...user, x: startX, y: startY, hp: 100, isDead: false };
        io.emit('updatePlayers', players);
    });

    socket.on('move', (data) => { 
        if (players[socket.id] && !players[socket.id].isDead) {
            // Перевірка зіткнення зі стінами при русі
            let canMove = true;
            for(let ob of obstacles) {
                if(!ob.destroyed && data.x < ob.x + 40 && data.x + 30 > ob.x && data.y < ob.y + 40 && data.y + 30 > ob.y) {
                    canMove = false; break;
                }
            }
            if(canMove) {
                players[socket.id].x = data.x;
                players[socket.id].y = data.y;
            }
            // Емітимо всім, щоб бачили рух
            socket.broadcast.emit('updatePlayers', players); 
        } 
    });

    socket.on('shoot', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            bullets.push({ ...data, owner: socket.id, rangeLvl: players[socket.id].range_lvl || 1 });
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

    socket.on('disconnect', () => { 
        delete players[socket.id]; 
        io.emit('updatePlayers', players); 
    });

    socket.on('ping_server', () => socket.emit('pong_server'));
});

// Роути
app.post('/auth', (req, res) => {
    const { username, password, type } = req.body;
    if (type === 'login') {
        db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
            if (results && results.length > 0) res.json({ success: true, user: results[0] });
            else res.json({ success: false, message: 'Помилка входу' });
        });
    } else {
        db.query('INSERT INTO users (username, password, score, coins, speed_lvl, fire_rate_lvl, range_lvl) VALUES (?, ?, 0, 0, 1, 1, 1)', [username, password], (err) => {
            if (err) res.json({ success: false, message: 'Нік зайнятий' });
            else res.json({ success: true, user: { username, score: 0, coins: 0, speed_lvl: 1, range_lvl: 1, fire_rate_lvl: 1, photo: null } });
        });
    }
});

app.post('/upgrade', (req, res) => {
    const { username, stat } = req.body;
    db.query(`UPDATE users SET ${stat} = ${stat} + 1, coins = coins - 100 WHERE username = ? AND coins >= 100`, [username], (err, result) => {
        if (result && result.affectedRows > 0) res.json({ success: true });
        else res.json({ success: false });
    });
});

app.post('/set-avatar', (req, res) => {
    const { username, url } = req.body;
    db.query('UPDATE users SET photo = ? WHERE username = ?', [url, username], (err) => {
        if (!err) {
            for(let id in players) {
                if(players[id].username === username) players[id].photo = url;
            }
            io.emit('updatePlayers', players);
            res.json({ success: true });
        } else res.json({ success: false });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

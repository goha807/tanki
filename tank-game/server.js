const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const MAP_SIZE = 2000;
const OBSTACLE_COUNT = 40;
const TANK_SIZE = 40;

app.use(express.static('public'));
app.use(express.json());

const db = mysql.createConnection({
    host: process.env.MYSQLHOST || 'localhost',
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || '',
    database: process.env.MYSQLDATABASE || 'tanks_game',
    port: process.env.MYSQLPORT || 3306
});

db.connect((err) => {
    if(err) console.log('DB Error:', err);
    else console.log('✅ MySQL Connected');
});

let players = {};
let bullets = [];
let healthPacks = [];
let obstacles = [];

function initObstacles() {
    for (let i = 0; i < OBSTACLE_COUNT; i++) {
        obstacles.push({
            id: i,
            x: Math.floor(Math.random() * (MAP_SIZE - 60) + 30),
            y: Math.floor(Math.random() * (MAP_SIZE - 60) + 30),
            hp: 3,
            maxHp: 3,
            destroyed: false,
            respawnTimer: 0
        });
    }
}

initObstacles();

// Spawn health packs
setInterval(() => {
    if (healthPacks.length < 20) {
        healthPacks.push({ 
            id: Math.random(), 
            x: Math.random() * (MAP_SIZE - 100) + 50, 
            y: Math.random() * (MAP_SIZE - 100) + 50 
        });
        io.emit('updateHealthPacks', healthPacks);
    }
    
    // Respawn obstacles
    obstacles.forEach(ob => {
        if (ob.destroyed && Date.now() > ob.respawnTimer) {
            ob.destroyed = false;
            ob.hp = ob.maxHp;
            io.emit('updateObstacles', obstacles);
        }
    });
}, 5000);

// Game loop - 60 FPS
setInterval(() => {
    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.dx; 
        b.y += b.dy;
        b.dist = (b.dist || 0) + Math.sqrt(b.dx**2 + b.dy**2);
        const maxDist = 400 + (b.rangeLvl * 100);
        
        // Check obstacle collision
        let hitObstacle = false;
        for (let ob of obstacles) {
            if (!ob.destroyed && 
                b.x > ob.x && b.x < ob.x + 40 && 
                b.y > ob.y && b.y < ob.y + 40) {
                ob.hp--;
                if (ob.hp <= 0) {
                    ob.destroyed = true;
                    ob.respawnTimer = Date.now() + 15000;
                }
                bullets.splice(i, 1);
                io.emit('updateObstacles', obstacles);
                hitObstacle = true;
                break;
            }
        }
        
        if (hitObstacle) continue;
        
        // Check boundaries
        if (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE || b.dist > maxDist) {
            bullets.splice(i, 1);
            continue;
        }
        
        // Check player collision - НЕ ВЛУЧАЙ В СЕБЕ!
        for (let id in players) {
            let p = players[id];
            if (!p.isDead && id !== b.owner && 
                b.x > p.x && b.x < p.x + TANK_SIZE && 
                b.y > p.y && b.y < p.y + TANK_SIZE) {
                
                const damage = b.damage || 20;
                p.hp -= damage;
                bullets.splice(i, 1);
                
                if (p.hp <= 0) {
                    p.hp = 0;
                    p.isDead = true;
                    if (players[b.owner]) {
                        players[b.owner].score += 100;
                        players[b.owner].coins += 50;
                        db.query('UPDATE users SET score = score + 100, coins = coins + 50 WHERE username = ?', 
                            [players[b.owner].username]);
                    }
                }
                io.emit('updatePlayers', players);
                break;
            }
        }
    }
    
    // Check health pack pickup
    for (let id in players) {
        let p = players[id];
        if (p.isDead) continue;
        
        for (let i = healthPacks.length - 1; i >= 0; i--) {
            const hp = healthPacks[i];
            if (p.x < hp.x + 30 && p.x + TANK_SIZE > hp.x && 
                p.y < hp.y + 30 && p.y + TANK_SIZE > hp.y) {
                if (p.hp < 100) {
                    p.hp = Math.min(100, p.hp + 40);
                    healthPacks.splice(i, 1);
                    io.emit('updateHealthPacks', healthPacks);
                    io.emit('updatePlayers', players);
                }
            }
        }
    }
    
    io.emit('updateBullets', bullets);
}, 1000 / 60);

io.on('connection', (socket) => {
    console.log('✅ Player connected:', socket.id);
    socket.emit('updateObstacles', obstacles);
    socket.emit('updateHealthPacks', healthPacks);
    
    socket.on('joinGame', (user) => {
        const startX = Math.random() * (MAP_SIZE - 100) + 50;
        const startY = Math.random() * (MAP_SIZE - 100) + 50;
        
        players[socket.id] = { 
            id: socket.id, 
            username: user.username,
            x: startX, 
            y: startY, 
            hp: 100,
            maxHp: 100,
            isDead: false,
            coins: user.coins || 0,
            score: user.score || 0,
            speed_lvl: user.speed_lvl || 1,
            range_lvl: user.range_lvl || 1,
            fire_rate_lvl: user.fire_rate_lvl || 1,
            damage_lvl: user.damage_lvl || 1,
            photo: user.photo || null
        };
        
        io.emit('updatePlayers', players);
        io.emit('gameState', { 
            coins: players[socket.id].coins 
        });
    });
    
    socket.on('move', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            let canMove = true;
            
            // Check obstacle collision
            for(let ob of obstacles) {
                if(!ob.destroyed && 
                   data.x < ob.x + 40 && data.x + TANK_SIZE > ob.x && 
                   data.y < ob.y + 40 && data.y + TANK_SIZE > ob.y) {
                    canMove = false; 
                    break;
                }
            }
            
            // Check boundaries
            if (data.x < 0 || data.x > MAP_SIZE - TANK_SIZE || 
                data.y < 0 || data.y > MAP_SIZE - TANK_SIZE) {
                canMove = false;
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
            const p = players[socket.id];
            const now = Date.now();
            const cooldown = Math.max(200, 600 - (p.fire_rate_lvl * 60));
            
            if (now - (p.lastShot || 0) < cooldown) return;
            p.lastShot = now;
            
            bullets.push({ 
                ...data, 
                owner: socket.id, 
                rangeLvl: p.range_lvl,
                damage: 20 + (p.damage_lvl * 5)
            });
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
        console.log('❌ Player disconnected:', socket.id);
        delete players[socket.id]; 
        io.emit('updatePlayers', players); 
    });
    
    socket.on('ping_server', () => socket.emit('pong_server'));
});

// Auth endpoint - ВИПРАВЛЕНО РЕЄСТРАЦІЮ!
app.post('/auth', (req, res) => {
    const { username, password, type } = req.body;
    
    if (type === 'login') {
        db.query('SELECT * FROM users WHERE username = ? AND password = ?', 
            [username, password], (err, results) => {
            if (results && results.length > 0) {
                res.json({ success: true, user: results[0] });
            } else {
                res.json({ success: false, message: 'Невірний логін або пароль' });
            }
        });
    } else {
        // ПЕРЕВІРКА чи існує нікнейм
        db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
            if (results && results.length > 0) {
                return res.json({ success: false, message: 'Нікнейм вже зайнятий!' });
            }
            
            // Створення нового користувача з ВСІМА полями
            db.query(`INSERT INTO users (username, password, coins, score, speed_lvl, range_lvl, fire_rate_lvl, damage_lvl) 
                      VALUES (?, ?, 0, 0, 1, 1, 1, 1)`, 
                [username, password], (err) => {
                if (err) {
                    res.json({ success: false, message: 'Помилка реєстрації' });
                } else {
                    res.json({ 
                        success: true, 
                        user: { 
                            username, 
                            score: 0, 
                            coins: 0, 
                            speed_lvl: 1, 
                            range_lvl: 1, 
                            fire_rate_lvl: 1,
                            damage_lvl: 1,
                            photo: null 
                        } 
                    });
                }
            });
        });
    }
});

// Upgrade endpoint
app.post('/upgrade', (req, res) => {
    const { username, stat } = req.body;
    const cost = 100;
    
    db.query(`UPDATE users SET ${stat} = ${stat} + 1, coins = coins - ? WHERE username = ? AND coins >= ?`, 
        [cost, username, cost], (err, result) => {
        if (result && result.affectedRows > 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Недостатньо монет' });
        }
    });
});

// Set avatar endpoint
app.post('/set-avatar', (req, res) => {
    const { username, url } = req.body;
    db.query('UPDATE users SET photo = ? WHERE username = ?', [url, username], () => {
        res.json({ success: true });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 Server running on port ${PORT}`);
    console.log(`🗺️ Map size: ${MAP_SIZE}x${MAP_SIZE}`);
});

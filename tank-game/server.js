const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const MAP_SIZE = 3000;
const OBSTACLE_COUNT = 60;

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
    else console.log('MySQL Connected');
});

let players = {};
let bullets = [];
let healthPacks = [];
let coinPacks = [];
let obstacles = [];
let bosses = [];
let premiumRewards = [];

const TANK_TYPES = {
    basic: { name: 'Базовий', speed: 4, damage: 20, hp: 100, fireRate: 600, color: '#4CAF50', price: 0 },
    fast: { name: 'Швидкий', speed: 6, damage: 15, hp: 80, fireRate: 500, color: '#2196F3', price: 500 },
    heavy: { name: 'Важкий', speed: 3, damage: 35, hp: 150, fireRate: 800, color: '#FF5722', price: 1000 },
    sniper: { name: 'Снайпер', speed: 4, damage: 50, hp: 70, fireRate: 1200, color: '#9C27B0', price: 1500 },
    premium: { name: 'Преміум', speed: 5, damage: 30, hp: 120, fireRate: 550, color: '#FFD700', price: 3000 }
};

const BOSS_CONFIG = {
    hp: 1000,
    damage: 40,
    speed: 2,
    fireRate: 1000,
    rewardCoins: 500,
    rewardPremium: 100,
    size: 60,
    color: '#FF0000'
};

function initObstacles() {
    obstacles = [];
    for (let i = 0; i < OBSTACLE_COUNT; i++) {
        obstacles.push({
            id: i,
            x: Math.floor(Math.random() * (MAP_SIZE - 80) + 40),
            y: Math.floor(Math.random() * (MAP_SIZE - 80) + 40),
            hp: 3,
            maxHp: 3,
            destroyed: false,
            respawnTimer: 0
        });
    }
}

function spawnBoss() {
    const boss = {
        id: 'boss_' + Date.now(),
        x: Math.random() * (MAP_SIZE - 200) + 100,
        y: Math.random() * (MAP_SIZE - 200) + 100,
        ...BOSS_CONFIG,
        currentHp: BOSS_CONFIG.hp,
        lastShot: 0,
        targetId: null,
        dx: 0,
        dy: 0
    };
    bosses.push(boss);
    io.emit('updateBosses', bosses);
}

function updateBossAI() {
    bosses.forEach(boss => {
        const now = Date.now();
        
        // Find nearest player
        let nearestPlayer = null;
        let nearestDist = Infinity;
        
        for (let id in players) {
            const p = players[id];
            if (!p.isDead) {
                const dist = Math.sqrt(Math.pow(p.x - boss.x, 2) + Math.pow(p.y - boss.y, 2));
                if (dist < nearestDist && dist < 800) {
                    nearestDist = dist;
                    nearestPlayer = p;
                }
            }
        }
        
        if (nearestPlayer) {
            boss.targetId = nearestPlayer.id;
            const angle = Math.atan2(nearestPlayer.y - boss.y, nearestPlayer.x - boss.x);
            boss.dx = Math.cos(angle) * boss.speed;
            boss.dy = Math.sin(angle) * boss.speed;
            
            // Move boss
            const newX = boss.x + boss.dx;
            const newY = boss.y + boss.dy;
            
            // Check boundaries
            if (newX > 0 && newX < MAP_SIZE) boss.x = newX;
            if (newY > 0 && newY < MAP_SIZE) boss.y = newY;
            
            // Shoot at player
            if (now - boss.lastShot > boss.fireRate && nearestDist < 600) {
                boss.lastShot = now;
                const bulletAngle = Math.atan2(nearestPlayer.y - boss.y, nearestPlayer.x - boss.x);
                bullets.push({
                    x: boss.x + boss.size/2,
                    y: boss.y + boss.size/2,
                    dx: Math.cos(bulletAngle) * 8,
                    dy: Math.sin(bulletAngle) * 8,
                    owner: 'boss',
                    damage: boss.damage,
                    isBossBullet: true,
                    rangeLvl: 0
                });
            }
        }
    });
    
    if (bosses.length > 0) {
        io.emit('updateBosses', bosses);
    }
}

initObstacles();
setInterval(() => {
    // Spawn health packs
    if (healthPacks.length < 20) {
        healthPacks.push({ 
            id: Math.random(), 
            x: Math.random() * (MAP_SIZE - 40) + 20, 
            y: Math.random() * (MAP_SIZE - 40) + 20,
            type: 'health'
        });
    }
    
    // Spawn coin packs
    if (coinPacks.length < 15) {
        coinPacks.push({ 
            id: Math.random(), 
            x: Math.random() * (MAP_SIZE - 30) + 15, 
            y: Math.random() * (MAP_SIZE - 30) + 15,
            amount: Math.floor(Math.random() * 30) + 10
        });
    }
    
    // Respawn obstacles
    obstacles.forEach(ob => {
        if (ob.destroyed && Date.now() > ob.respawnTimer) {
            ob.destroyed = false;
            ob.hp = ob.maxHp;
        }
    });
    
    // Spawn boss every 5 minutes if not exists
    if (bosses.length === 0 && Math.random() < 0.01) {
        spawnBoss();
    }
    
    io.emit('updateHealthPacks', healthPacks);
    io.emit('updateCoinPacks', coinPacks);
    io.emit('updateObstacles', obstacles);
}, 3000);

// Game loop - 60 FPS
setInterval(() => {
    updateBossAI();
    
    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.dx;
        b.y += b.dy;
        b.dist = (b.dist || 0) + Math.sqrt(b.dx**2 + b.dy**2);
        const maxDist = 400 + (b.rangeLvl * 100);
        
        // Check obstacle collision
        for (let ob of obstacles) {
            if (!ob.destroyed && 
                b.x > ob.x && b.x < ob.x + 60 && 
                b.y > ob.y && b.y < ob.y + 60) {
                ob.hp--;
                if (ob.hp <= 0) {
                    ob.destroyed = true;
                    ob.respawnTimer = Date.now() + 20000;
                }
                bullets.splice(i, 1);
                io.emit('updateObstacles', obstacles);
                break;
            }
        }
        
        if (bullets[i] && (b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE || b.dist > maxDist)) {
            bullets.splice(i, 1);
            continue;
        }
        
        if (!bullets[i]) continue;
        
        // Check boss collision
        if (b.owner !== 'boss') {
            for (let bi = bosses.length - 1; bi >= 0; bi--) {
                const boss = bosses[bi];
                if (b.x > boss.x && b.x < boss.x + boss.size &&
                    b.y > boss.y && b.y < boss.y + boss.size) {
                    boss.currentHp -= b.damage || 20;
                    bullets.splice(i, 1);
                    
                    if (boss.currentHp <= 0) {
                        // Boss defeated - give rewards
                        for (let pid in players) {
                            const p = players[pid];
                            const dist = Math.sqrt(Math.pow(p.x - boss.x, 2) + Math.pow(p.y - boss.y, 2));
                            if (dist < 400 && !p.isDead) {
                                p.coins += BOSS_CONFIG.rewardCoins;
                                p.premium += BOSS_CONFIG.rewardPremium;
                                p.score += 500;
                                db.query('UPDATE users SET coins = coins + ?, premium = premium + ?, score = score + 500 WHERE username = ?', 
                                    [BOSS_CONFIG.rewardCoins, BOSS_CONFIG.rewardPremium, p.username]);
                            }
                        }
                        bosses.splice(bi, 1);
                        io.emit('bossDefeated', { x: boss.x, y: boss.y });
                    }
                    break;
                }
            }
        }
        
        if (!bullets[i]) continue;
        
        // Check player collision
        for (let id in players) {
            let p = players[id];
            if (!p.isDead && id !== b.owner && 
                b.x > p.x && b.x < p.x + 40 && 
                b.y > p.y && b.y < p.y + 40) {
                const damage = b.damage || (players[b.owner] ? (players[b.owner].damage || 20) : 20);
                p.hp -= damage;
                bullets.splice(i, 1);
                
                if (p.hp <= 0) {
                    p.hp = 0;
                    p.isDead = true;
                    if (players[b.owner] && b.owner !== 'boss') {
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
    
    // Check player pickups
    for (let id in players) {
        let p = players[id];
        if (p.isDead) continue;
        
        // Health packs
        for (let i = healthPacks.length - 1; i >= 0; i--) {
            const hp = healthPacks[i];
            if (p.x < hp.x + 30 && p.x + 40 > hp.x && 
                p.y < hp.y + 30 && p.y + 40 > hp.y) {
                if (p.hp < 100) {
                    p.hp = Math.min(100, p.hp + 30);
                    healthPacks.splice(i, 1);
                    io.emit('updateHealthPacks', healthPacks);
                    io.emit('updatePlayers', players);
                }
            }
        }
        
        // Coin packs
        for (let i = coinPacks.length - 1; i >= 0; i--) {
            const cp = coinPacks[i];
            if (p.x < cp.x + 25 && p.x + 40 > cp.x && 
                p.y < cp.y + 25 && p.y + 40 > cp.y) {
                p.coins += cp.amount;
                coinPacks.splice(i, 1);
                db.query('UPDATE users SET coins = coins + ? WHERE username = ?', [cp.amount, p.username]);
                io.emit('updateCoinPacks', coinPacks);
                io.emit('updatePlayers', players);
            }
        }
    }
    
    io.emit('updateBullets', bullets);
}, 1000 / 60);

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    socket.emit('updateObstacles', obstacles);
    socket.emit('updateBosses', bosses);
    
    socket.on('joinGame', (userData) => {
        const startX = Math.random() * (MAP_SIZE - 200) + 100;
        const startY = Math.random() * (MAP_SIZE - 200) + 100;
        
        const tankType = TANK_TYPES[userData.tankType] || TANK_TYPES.basic;
        
        players[socket.id] = { 
            id: socket.id, 
            username: userData.username,
            tankType: userData.tankType || 'basic',
            x: startX, 
            y: startY, 
            hp: 100, 
            maxHp: tankType.hp,
            isDead: false,
            speed: tankType.speed,
            damage: tankType.damage,
            fireRate: tankType.fireRate,
            color: tankType.color,
            coins: userData.coins || 0,
            premium: userData.premium || 0,
            score: userData.score || 0,
            speed_lvl: userData.speed_lvl || 1,
            range_lvl: userData.range_lvl || 1,
            fire_rate_lvl: userData.fire_rate_lvl || 1,
            damage_lvl: userData.damage_lvl || 1
        };
        
        io.emit('updatePlayers', players);
        io.emit('gameState', { 
            coins: players[socket.id].coins,
            premium: players[socket.id].premium,
            tankType: players[socket.id].tankType
        });
    });
    
    socket.on('move', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            const p = players[socket.id];
            let canMove = true;
            const size = 40;
            
            // Check obstacle collision
            for (let ob of obstacles) {
                if (!ob.destroyed && 
                    data.x < ob.x + 60 && data.x + size > ob.x && 
                    data.y < ob.y + 60 && data.y + size > ob.y) {
                    canMove = false; 
                    break;
                }
            }
            
            // Check boundaries
            if (data.x < 0 || data.x > MAP_SIZE - size || 
                data.y < 0 || data.y > MAP_SIZE - size) {
                canMove = false;
            }
            
            if (canMove) {
                p.x = data.x;
                p.y = data.y;
            }
        }
    });
    
    socket.on('shoot', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            const p = players[socket.id];
            const now = Date.now();
            const cooldown = Math.max(200, p.fireRate - (p.fire_rate_lvl * 50));
            
            if (now - (p.lastShot || 0) < cooldown) return;
            p.lastShot = now;
            
            bullets.push({ 
                ...data, 
                owner: socket.id, 
                rangeLvl: p.range_lvl,
                damage: p.damage + (p.damage_lvl * 5)
            });
        }
    });
    
    socket.on('respawn', () => {
        if (players[socket.id]) {
            const tankType = TANK_TYPES[players[socket.id].tankType] || TANK_TYPES.basic;
            players[socket.id].hp = tankType.hp;
            players[socket.id].isDead = false;
            players[socket.id].x = Math.random() * (MAP_SIZE - 200) + 100;
            players[socket.id].y = Math.random() * (MAP_SIZE - 200) + 100;
            io.emit('updatePlayers', players);
        }
    });
    
    socket.on('disconnect', () => { 
        console.log('Player disconnected:', socket.id);
        delete players[socket.id]; 
        io.emit('updatePlayers', players); 
    });
    
    socket.on('ping_server', () => socket.emit('pong_server'));
});

// Auth endpoint
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
        db.query('INSERT INTO users (username, password, coins, premium, score) VALUES (?, ?, 0, 0, 0)', 
            [username, password], (err) => {
            if (err) {
                res.json({ success: false, message: 'Нікнейм вже зайнятий' });
            } else {
                res.json({ 
                    success: true, 
                    user: { 
                        username, 
                        score: 0, 
                        coins: 0, 
                        premium: 0,
                        speed_lvl: 1, 
                        range_lvl: 1, 
                        fire_rate_lvl: 1,
                        damage_lvl: 1,
                        tankType: 'basic',
                        photo: null 
                    } 
                });
            }
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

// Buy tank endpoint
app.post('/buy-tank', (req, res) => {
    const { username, tankType } = req.body;
    const tank = TANK_TYPES[tankType];
    
    if (!tank) {
        return res.json({ success: false, message: 'Невірний тип танку' });
    }
    
    db.query('UPDATE users SET tankType = ?, coins = coins - ? WHERE username = ? AND coins >= ? AND (tankType = ? OR coins >= ?)', 
        [tankType, tank.price, username, tank.price, tankType, tank.price], (err, result) => {
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

// Get user data endpoint
app.get('/user/:username', (req, res) => {
    db.query('SELECT * FROM users WHERE username = ?', [req.params.username], (err, results) => {
        if (results && results.length > 0) {
            res.json({ success: true, user: results[0] });
        } else {
            res.json({ success: false });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎮 Server running on port ${PORT}`);
    console.log(`🗺️ Map size: ${MAP_SIZE}x${MAP_SIZE}`);
    console.log(`👾 Boss system enabled`);
});

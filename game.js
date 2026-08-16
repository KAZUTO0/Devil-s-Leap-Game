(() => {
    'use strict';

    // ============================================================
    // CONFIG — All tunable parameters
    // ============================================================
    const CONFIG = {
        TILE_SIZE: 28, CANVAS_W: 900, CANVAS_H: 540,
        GRAVITY: 0.55, JUMP_FORCE: -12.5, JUMP_CUT: 0.45,
        MOVE_SPEED: 4.8, MOVE_ACCEL: 0.7, AIR_ACCEL: 0.4,
        FRICTION: 0.78, MAX_FALL_SPEED: 13,
        PLAYER_W: 22, PLAYER_H: 22,
        COYOTE_TIME: 110, JUMP_BUFFER: 130, RESPAWN_DELAY: 650,
        CAMERA_LERP: 0.09, CAMERA_LOOKAHEAD: 50,
        CAMERA_LOOKAHEAD_LERP: 0.06, SHAKE_DECAY: 0.88,
        MAX_HEALTH: 3, MAX_DIGS: 3,
        SPEED_BOOST_DURATION: 6000, SPEED_BOOST_MULT: 1.6,
        INVULN_TIME: 1000, SHIELD_INVULN_TIME: 1500,
        LAVA_KNOCKBACK: -6,
    };

    // ============================================================
    // UTILITIES
    // ============================================================
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const rand = (min, max) => Math.random() * (max - min) + min;
    const randInt = (min, max) => Math.floor(rand(min, max + 1));
    const aabb = (a, b) =>
        a.x < b.x + b.w && a.x + a.w > b.x &&
        a.y < b.y + b.h && a.y + a.h > b.y;
    function roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
    }

    // ============================================================
    // SOUND MANAGER — Procedural audio via Web Audio API
    // ============================================================
    const bgMusic = new Audio("https://cdn.pixabay.com/audio/2026/02/27/audio_0250461c0c.mp3");
    bgMusic.loop = true;
    bgMusic.volume = 0.01;    // 0 (silent) – 1 (full volume), tune to taste
    bgMusic.preload = "auto";

    function startBgMusic() {
        if (!bgMusic.paused) return;    // already playing, don't restart it
        bgMusic.play().catch(() => {}); // blocked until a user gesture; safe to ignore here
        document.documentElement.requestFullscreen();
    }

    class SoundManager {
        constructor() { this.ctx = null; this.muted = false; this.master = null; }
        init() {
            if (!this.ctx) {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                this.master = this.ctx.createGain();
                this.master.gain.value = 0.35;
                this.master.connect(this.ctx.destination);
            }
            if (this.ctx.state === 'suspended') this.ctx.resume();
            startBgMusic();
        }
        toggleMute() {
            this.muted = !this.muted;
            if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
            return this.muted;
        }
        // Single tone with envelope
        tone(freq, dur, type = 'square', vol = 0.3, attack = 0.005) {
            if (!this.ctx || this.muted) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(0, this.ctx.currentTime);
            gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + attack);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            osc.connect(gain); gain.connect(this.master);
            osc.start(); osc.stop(this.ctx.currentTime + dur);
        }
        // Frequency sweep
        sweep(f1, f2, dur, type = 'square', vol = 0.3) {
            if (!this.ctx || this.muted) return;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(f1, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), this.ctx.currentTime + dur);
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            osc.connect(gain); gain.connect(this.master);
            osc.start(); osc.stop(this.ctx.currentTime + dur);
        }
        // Filtered noise burst
        noise(dur, vol = 0.2, filterFreq = 1000, type = 'lowpass') {
            if (!this.ctx || this.muted) return;
            const bufSize = Math.floor(this.ctx.sampleRate * dur);
            const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
            const src = this.ctx.createBufferSource(); src.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = type; filter.frequency.value = filterFreq;
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(vol, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            src.connect(filter); filter.connect(gain); gain.connect(this.master);
            src.start();
        }
        // --- Game sounds ---
        jump() { this.sweep(320, 580, 0.1, 'square', 0.2); }
        land() { this.tone(110, 0.06, 'square', 0.15); this.noise(0.04, 0.08, 500); }
        coin() { this.tone(988, 0.05, 'square', 0.2); setTimeout(() => this.tone(1319, 0.12, 'square', 0.2), 50); }
        death() { this.sweep(440, 60, 0.5, 'sawtooth', 0.25); this.noise(0.4, 0.15, 600); }
        dig() { this.noise(0.18, 0.25, 1800); this.tone(80, 0.1, 'square', 0.1); }
        powerup() {
            [523, 659, 784, 1047].forEach((f, i) =>
                setTimeout(() => this.tone(f, 0.1, 'square', 0.2), i * 55));
        }
        shieldHit() { this.tone(2000, 0.08, 'triangle', 0.25); this.noise(0.12, 0.12, 4000, 'highpass'); }
        lava() { this.noise(0.25, 0.15, 500); this.tone(140, 0.2, 'sawtooth', 0.12); }
        crush() { this.tone(60, 0.2, 'square', 0.3); this.noise(0.2, 0.2, 300); }
        complete() {
            [523, 659, 784, 1047, 1319].forEach((f, i) =>
                setTimeout(() => this.tone(f, 0.15, 'square', 0.2), i * 90));
        }
        win() {
            [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) =>
                setTimeout(() => this.tone(f, 0.18, 'square', 0.2), i * 80));
        }
    }

    // ============================================================
    // INPUT
    // ============================================================
    class Input {
        constructor() {
            this.keys = {}; this.pressed = {}; this.released = {};
            this.map = {
                left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
                jump: ['Space', 'ArrowUp', 'KeyW'], reset: ['KeyR'],
                down: ['ArrowDown', 'KeyS'], mute: ['KeyM'],
            };
            window.addEventListener('keydown', (e) => {
                if (!this.keys[e.code]) this.pressed[e.code] = true;
                this.keys[e.code] = true;
                if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
            });
            window.addEventListener('keyup', (e) => { this.keys[e.code] = false; this.released[e.code] = true; });
        }
        isDown(a) { return this.map[a].some(k => this.keys[k]); }
        wasPressed(a) { return this.map[a].some(k => this.pressed[k]); }
        wasReleased(a) { return this.map[a].some(k => this.released[k]); }
        endFrame() { this.pressed = {}; this.released = {}; }
    }

    // ============================================================
    // CAMERA
    // ============================================================
    class Camera {
        constructor() {
            this.x = 0; this.y = 0; this.targetX = 0; this.targetY = 0;
            this.shakeAmount = 0; this.shakeX = 0; this.shakeY = 0; this.lookahead = 0;
        }
        follow(target) {
            const la = clamp(target.vx * 12, -CONFIG.CAMERA_LOOKAHEAD, CONFIG.CAMERA_LOOKAHEAD);
            this.lookahead = lerp(this.lookahead, la, CONFIG.CAMERA_LOOKAHEAD_LERP);
            this.targetX = target.x + target.w / 2 - CONFIG.CANVAS_W / 2 + this.lookahead;
            this.targetY = target.y + target.h / 2 - CONFIG.CANVAS_H / 2;
            this.x = lerp(this.x, this.targetX, CONFIG.CAMERA_LERP);
            this.y = lerp(this.y, this.targetY, CONFIG.CAMERA_LERP);
        }
        snapTo(x, y) {
            this.x = x - CONFIG.CANVAS_W / 2; this.y = y - CONFIG.CANVAS_H / 2;
            this.targetX = this.x; this.targetY = this.y; this.lookahead = 0;
        }
        shake(a) { this.shakeAmount = Math.max(this.shakeAmount, a); }
        update() {
            this.shakeAmount *= CONFIG.SHAKE_DECAY;
            if (this.shakeAmount < 0.1) this.shakeAmount = 0;
            this.shakeX = (Math.random() - 0.5) * 2 * this.shakeAmount;
            this.shakeY = (Math.random() - 0.5) * 2 * this.shakeAmount;
        }
        apply(ctx) { ctx.translate(-Math.round(this.x + this.shakeX), -Math.round(this.y + this.shakeY)); }
        get viewX() { return this.x + this.shakeX; }
        get viewY() { return this.y + this.shakeY; }
    }

    // ============================================================
    // PARTICLES
    // ============================================================
    class Particle {
        constructor(x, y, vx, vy, life, color, size, gravity = 0) {
            this.x = x; this.y = y; this.vx = vx; this.vy = vy;
            this.life = life; this.maxLife = life; this.color = color;
            this.size = size; this.gravity = gravity;
        }
        update(dt) {
            this.x += this.vx; this.y += this.vy; this.vy += this.gravity;
            this.vx *= 0.96; this.life -= dt;
        }
        draw(ctx) {
            const a = clamp(this.life / this.maxLife, 0, 1);
            ctx.globalAlpha = a; ctx.fillStyle = this.color;
            const s = Math.max(0.5, this.size * a);
            ctx.fillRect(this.x - s / 2, this.y - s / 2, s, s);
            ctx.globalAlpha = 1;
        }
    }
    class ParticleSystem {
        constructor() { this.particles = []; }
        emit(x, y, count, opts = {}) {
            const { speed = [1,4], life = [300,600], color = '#ff2e63',
                size = [2,4], angle = [0, Math.PI*2], gravity = 0 } = opts;
            for (let i = 0; i < count; i++) {
                const a = rand(angle[0], angle[1]); const s = rand(speed[0], speed[1]);
                const col = Array.isArray(color) ? color[randInt(0, color.length-1)] : color;
                this.particles.push(new Particle(x, y, Math.cos(a)*s, Math.sin(a)*s,
                    rand(life[0], life[1]), col, rand(size[0], size[1]), gravity));
            }
        }
        update(dt) {
            for (let i = this.particles.length - 1; i >= 0; i--) {
                this.particles[i].update(dt);
                if (this.particles[i].life <= 0) this.particles.splice(i, 1);
            }
        }
        draw(ctx) { for (const p of this.particles) p.draw(ctx); }
        clear() { this.particles = []; }
    }

    // ============================================================
    // PLAYER — Movement, health, power-ups, digging
    // ============================================================
    class Player {
        constructor(x, y) {
            this.spawnX = x; this.spawnY = y;
            this.x = x; this.y = y;
            this.w = CONFIG.PLAYER_W; this.h = CONFIG.PLAYER_H;
            this.vx = 0; this.vy = 0;
            this.onGround = false; this.wasOnGround = false;
            this.coyoteTimer = 0; this.jumpBufferTimer = 0;
            this.facing = 1;
            this.dead = false; this.deathTimer = 0; this.respawnTimer = 0;
            this.animTime = 0; this.animState = 'idle';
            this.squash = 1; this.stretch = 1; this.trail = [];

            // Health & power-ups
            this.maxHealth = CONFIG.MAX_HEALTH;
            this.health = this.maxHealth;
            this.invulnerable = false; this.invulnerableTimer = 0;
            this.shield = false;
            this.speedBoostTimer = 0;
            this.extraLives = 0;
            this.digsRemaining = CONFIG.MAX_DIGS;
            this.digCooldown = 0;
        }

        setSpawn(x, y) { this.spawnX = x; this.spawnY = y; }

        // Full reset on level load
        resetForLevel() {
            this.reset();
            this.digsRemaining = CONFIG.MAX_DIGS;
            this.extraLives = 0;
            this.maxHealth = CONFIG.MAX_HEALTH;
            this.health = this.maxHealth;
        }

        // Reset on death respawn (keeps digs & extra lives)
        reset() {
            this.x = this.spawnX; this.y = this.spawnY;
            this.vx = 0; this.vy = 0;
            this.dead = false; this.deathTimer = 0; this.respawnTimer = 0;
            this.coyoteTimer = 0; this.jumpBufferTimer = 0;
            this.onGround = false; this.facing = 1;
            this.squash = 1; this.stretch = 1; this.trail = [];
            this.animState = 'idle';
            this.health = this.maxHealth;
            this.invulnerable = false; this.invulnerableTimer = 0;
            this.shield = false; this.speedBoostTimer = 0;
            this.digCooldown = 0;
        }

        // Instant kill (spikes, crushing, fall). Shield can prevent.
        kill(particles, camera, sound) {
            if (this.dead || this.invulnerable) return false;
            if (this.shield) { this._breakShield(particles, camera, sound); return false; }
            this._die(particles, camera, sound);
            return true;
        }

        // Damage from lava. Shield absorbs. I-frames after.
        takeDamage(amount, particles, camera, sound) {
            if (this.dead || this.invulnerable) return false;
            if (this.shield) { this._breakShield(particles, camera, sound); return false; }
            this.health -= amount;
            this.invulnerable = true;
            this.invulnerableTimer = CONFIG.INVULN_TIME;
            sound.lava();
            particles.emit(this.x + this.w/2, this.y + this.h/2, 10, {
                speed: [1, 3], life: [200, 400], color: '#ff4400', size: [2, 4],
            });
            this.vy = CONFIG.LAVA_KNOCKBACK;
            if (this.health <= 0) { this.health = 0; this._die(particles, camera, sound); return true; }
            return false;
        }

        _breakShield(particles, camera, sound) {
            this.shield = false;
            this.invulnerable = true;
            this.invulnerableTimer = CONFIG.SHIELD_INVULN_TIME;
            sound.shieldHit();
            particles.emit(this.x + this.w/2, this.y + this.h/2, 22, {
                speed: [2, 5], life: [300, 600],
                color: ['#08ffc8', '#a0fff0', '#ffffff'], size: [2, 4],
            });
            camera.shake(5);
        }

        _die(particles, camera, sound) {
            if (this.dead) return;
            this.dead = true; this.deathTimer = 0;
            this.respawnTimer = CONFIG.RESPAWN_DELAY;
            this.vx = rand(-2, 2); this.vy = -7;
            particles.emit(this.x + this.w/2, this.y + this.h/2, 28, {
                speed: [2, 6], life: [400, 900],
                color: ['#ff2e63', '#ffd60a', '#ffffff'], size: [2, 5], gravity: 0.15,
            });
            camera.shake(16);
            sound.death();
        }

        // Dig the block directly beneath the player
        dig(level, particles, camera, sound) {
            if (this.digsRemaining <= 0 || this.dead || this.digCooldown > 0) return false;
            const TS = CONFIG.TILE_SIZE;
            const cx = Math.floor((this.x + this.w / 2) / TS);
            const cy = Math.floor((this.y + this.h + 4) / TS);
            if (cy < 0 || cy >= level.tileH || cx < 0 || cx >= level.tileW) return false;
            if (!level.solid[cy] || !level.solid[cy][cx]) return false;
            // Prevent digging boundary walls
            if (cx <= 0 || cx >= level.tileW - 1 || cy >= level.tileH - 1) return false;

            level.digTile(cx, cy);
            this.digsRemaining--;
            this.digCooldown = 250;
            particles.emit(cx * TS + TS/2, cy * TS + TS/2, 18, {
                speed: [1, 4], life: [300, 700],
                color: ['#5a4d70', '#3d3552', '#2a2438', '#1a1626'],
                size: [2, 5], gravity: 0.25,
            });
            sound.dig();
            camera.shake(6);
            return true;
        }

        update(dt, input, level, particles, camera, sound) {
            this.animTime += dt;

            // --- Timers ---
            if (this.invulnerableTimer > 0) {
                this.invulnerableTimer -= dt;
                if (this.invulnerableTimer <= 0) this.invulnerable = false;
            }
            if (this.speedBoostTimer > 0) {
                this.speedBoostTimer -= dt;
                if (this.speedBoostTimer <= 0) this.speedBoostTimer = 0;
            }
            if (this.digCooldown > 0) this.digCooldown -= dt;

            // --- Death animation ---
            if (this.dead) {
                this.deathTimer += dt; this.respawnTimer -= dt;
                this.vy += CONFIG.GRAVITY * 0.5;
                this.y += this.vy; this.x += this.vx; this.vx *= 0.96;
                return;
            }

            // --- Dig input ---
            if (input.wasPressed('down')) this.dig(level, particles, camera, sound);

            // --- Horizontal movement (with speed boost) ---
            const speedMult = this.speedBoostTimer > 0 ? CONFIG.SPEED_BOOST_MULT : 1;
            const maxSpeed = CONFIG.MOVE_SPEED * speedMult;
            const moveDir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
            const accel = this.onGround ? CONFIG.MOVE_ACCEL : CONFIG.AIR_ACCEL;
            if (moveDir !== 0) {
                this.vx += moveDir * accel * speedMult;
                this.vx = clamp(this.vx, -maxSpeed, maxSpeed);
                this.facing = moveDir;
            } else {
                this.vx *= this.onGround ? CONFIG.FRICTION : 0.98;
                if (Math.abs(this.vx) < 0.05) this.vx = 0;
            }

            // --- Jump buffering & coyote time ---
            if (input.wasPressed('jump')) this.jumpBufferTimer = CONFIG.JUMP_BUFFER;
            this.jumpBufferTimer -= dt;
            if (this.onGround) this.coyoteTimer = CONFIG.COYOTE_TIME;
            else this.coyoteTimer -= dt;

            if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
                this.vy = CONFIG.JUMP_FORCE;
                this.jumpBufferTimer = 0; this.coyoteTimer = 0; this.onGround = false;
                particles.emit(this.x + this.w/2, this.y + this.h, 8, {
                    speed: [1, 3], life: [200, 400], color: '#ffd60a', size: [2, 4],
                    angle: [Math.PI * 0.2, Math.PI * 0.8],
                });
                sound.jump();
                this.squash = 0.7; this.stretch = 1.3;
            }
            if (input.wasReleased('jump') && this.vy < 0) this.vy *= CONFIG.JUMP_CUT;

            // --- Gravity ---
            this.vy += CONFIG.GRAVITY;
            this.vy = Math.min(this.vy, CONFIG.MAX_FALL_SPEED);

            // --- Move & collide ---
            this.wasOnGround = this.onGround;
            this.moveX(this.vx, level);
            this.moveY(this.vy, level);

            // --- Landing feedback ---
            if (this.onGround && !this.wasOnGround) {
                const impact = Math.min(Math.abs(this.vy) + 5, 12);
                if (impact > 6) {
                    particles.emit(this.x + this.w/2, this.y + this.h, 7, {
                        speed: [1, 3], life: [200, 400], color: '#ffffff', size: [2, 3],
                        angle: [Math.PI * 0.1, Math.PI * 0.9],
                    });
                    this.squash = 0.6; this.stretch = 1.4;
                    if (impact > 9) { camera.shake(3); sound.land(); }
                } else { this.squash = 0.85; this.stretch = 1.15; }
            }

            // --- Animation state ---
            if (!this.onGround) this.animState = this.vy < 0 ? 'jump' : 'fall';
            else if (Math.abs(this.vx) > 0.5) this.animState = 'run';
            else this.animState = 'idle';

            this.squash = lerp(this.squash, 1, 0.2);
            this.stretch = lerp(this.stretch, 1, 0.2);

            // --- Motion trail ---
            if (!this.onGround && Math.abs(this.vx) + Math.abs(this.vy) > 5) {
                this.trail.push({ x: this.x + this.w/2, y: this.y + this.h/2, life: 200 });
            }
            for (let i = this.trail.length - 1; i >= 0; i--) {
                this.trail[i].life -= dt;
                if (this.trail[i].life <= 0) this.trail.splice(i, 1);
            }
            if (this.trail.length > 10) this.trail.shift();

            // --- Fall death ---
            if (this.y > level.pixelH + 200) this._die(particles, camera, sound);
        }

        moveX(dx, level) {
            this.x += dx;
            const tiles = level.getSolidTilesNear(this);
            for (const t of tiles) {
                if (aabb(this, t)) {
                    if (dx > 0) this.x = t.x - this.w;
                    else if (dx < 0) this.x = t.x + t.w;
                    this.vx = 0;
                }
            }
        }
        moveY(dy, level) {
            this.y += dy; this.onGround = false;
            const tiles = level.getSolidTilesNear(this);
            for (const t of tiles) {
                if (aabb(this, t)) {
                    if (dy > 0) { this.y = t.y - this.h; this.onGround = true; }
                    else if (dy < 0) { this.y = t.y + t.h; }
                    this.vy = 0;
                }
            }
        }

        draw(ctx) {
            // Trail
            for (const t of this.trail) {
                const a = t.life / 200;
                ctx.globalAlpha = a * 0.35;
                ctx.fillStyle = this.speedBoostTimer > 0 ? '#ffd60a' : '#ff2e63';
                const s = 8 * a;
                ctx.fillRect(t.x - s/2, t.y - s/2, s, s);
            }
            ctx.globalAlpha = 1;

            // Flicker when invulnerable
            if (this.invulnerable && !this.dead && Math.floor(Date.now() / 80) % 2 === 0) return;

            // Shield aura
            if (this.shield && !this.dead) {
                const pulse = 0.6 + Math.sin(this.animTime / 150) * 0.3;
                ctx.strokeStyle = `rgba(8, 255, 200, ${pulse})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(this.x + this.w/2, this.y + this.h/2, this.w * 0.95, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = `rgba(8, 255, 200, ${pulse * 0.1})`;
                ctx.fill();
            }

            if (this.dead) {
                const t = this.deathTimer / 600;
                ctx.globalAlpha = clamp(1 - t, 0, 1);
                ctx.save();
                ctx.translate(this.x + this.w/2, this.y + this.h/2);
                ctx.rotate(t * Math.PI * 4);
                const s = Math.max(0.1, 1 - t * 0.5);
                ctx.scale(s, s);
                this.drawSprite(ctx, -this.w/2, -this.h/2);
                ctx.restore();
                ctx.globalAlpha = 1;
                return;
            }

            ctx.save();
            ctx.translate(this.x + this.w/2, this.y + this.h);
            ctx.scale(this.stretch, this.squash);
            this.drawSprite(ctx, -this.w/2, -this.h);
            ctx.restore();
        }

        drawSprite(ctx, x, y) {
            const w = this.w, h = this.h;
            ctx.shadowColor = this.speedBoostTimer > 0 ? '#ffd60a' : '#ff2e63'; ctx.shadowBlur = 14;
            ctx.fillStyle = '#ff2e63';
            roundRect(ctx, x, y, w, h, 5); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ff5e83';
            roundRect(ctx, x + 2, y + 2, w - 4, h / 2 - 2, 4); ctx.fill();
            // Eyes
            const eyeY = y + h * 0.32;
            const eyeOff = this.facing * 2;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x + w * 0.22 + eyeOff, eyeY, 5, 7);
            ctx.fillRect(x + w * 0.58 + eyeOff, eyeY, 5, 7);
            ctx.fillStyle = '#0a0a14';
            const pOff = this.facing * 1.5;
            ctx.fillRect(x + w * 0.22 + eyeOff + 1 + pOff, eyeY + 2, 2, 3);
            ctx.fillRect(x + w * 0.58 + eyeOff + 1 + pOff, eyeY + 2, 2, 3);
            // Legs
            ctx.fillStyle = '#cc1a4a';
            if (this.animState === 'run') {
                const phase = Math.floor(this.animTime / 80) % 4;
                const legs = [[3,-2,-3,2],[2,-3,-2,3],[3,-2,-3,2],[-2,-3,2,3]];
                const [l1,l2,r1,r2] = legs[phase];
                ctx.fillRect(x + 3 + l1, y + h - 4 + l2, 5, 5);
                ctx.fillRect(x + w - 8 + r1, y + h - 4 + r2, 5, 5);
            } else if (this.animState === 'jump') {
                ctx.fillRect(x + 4, y + h - 6, 5, 5);
                ctx.fillRect(x + w - 9, y + h - 6, 5, 5);
            } else if (this.animState === 'fall') {
                ctx.fillRect(x + 2, y + h - 4, 5, 5);
                ctx.fillRect(x + w - 7, y + h - 4, 5, 5);
            } else {
                const bob = Math.sin(this.animTime / 300);
                ctx.fillRect(x + 3, y + h - 4 + bob, 5, 5);
                ctx.fillRect(x + w - 8, y + h - 4 + bob, 5, 5);
            }
        }
    }

    // ============================================================
    // COIN — Collectible for score
    // ============================================================
    class Coin {
        constructor(x, y) {
            this.x = x; this.y = y; this.w = 16; this.h = 16;
            this.collected = false; this.animTime = Math.random() * 1000;
        }
        reset() { this.collected = false; }
        update(dt) { this.animTime += dt; }
        checkCollect(player) {
            if (this.collected) return false;
            if (aabb(this, player)) { this.collected = true; return true; }
            return false;
        }
        draw(ctx) {
            if (this.collected) return;
            const cx = this.x + this.w/2, cy = this.y + this.h/2;
            const pulse = Math.sin(this.animTime / 200) * 0.3 + 0.7;
            const spin = Math.abs(Math.sin(this.animTime / 300));
            const w = this.w * (0.3 + spin * 0.7);
            ctx.shadowColor = '#ffd60a'; ctx.shadowBlur = 12 * pulse;
            ctx.fillStyle = '#ffd60a';
            ctx.beginPath(); ctx.ellipse(cx, cy, w/2, this.h/2, 0, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff5a0';
            ctx.beginPath(); ctx.ellipse(cx, cy, w/3, this.h/3, 0, 0, Math.PI*2); ctx.fill();
            // Shine
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(cx - 1, cy - 4, 2, 2);
        }
    }

    // ============================================================
    // POWER-UP — Shield, Speed Boost, Extra Life
    // ============================================================
    class PowerUp {
        constructor(x, y, type) {
            this.x = x; this.y = y; this.w = 22; this.h = 22;
            this.type = type; // 'shield' | 'speed' | 'life'
            this.collected = false; this.animTime = Math.random() * 1000;
        }
        reset() { this.collected = false; }
        update(dt) { this.animTime += dt; }
        checkCollect(player) {
            if (this.collected) return false;
            if (aabb(this, player)) { this.collected = true; return true; }
            return false;
        }
        draw(ctx) {
            if (this.collected) return;
            const cx = this.x + this.w/2;
            const bob = Math.sin(this.animTime / 300) * 3;
            // const cy = this.y + this.h/2 + bob;
            const pulse = Math.sin(this.animTime / 200) * 0.2 + 0.8;
            const colors = {
                shield: { glow: '#08ffc8', body: '#0a3a30', icon: '#08ffc8' },
                speed:  { glow: '#ffd60a', body: '#3a2d08', icon: '#ffd60a' },
                life:   { glow: '#ff2e63', body: '#3a0a20', icon: '#ff2e63' },
            };
            const c = colors[this.type];
            // Outer glow ring
            ctx.shadowColor = c.glow; ctx.shadowBlur = 18 * pulse;
            ctx.fillStyle = c.body;
            roundRect(ctx, this.x, this.y + bob, this.w, this.h, 5); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = c.glow; ctx.lineWidth = 2;
            roundRect(ctx, this.x, this.y + bob, this.w, this.h, 5); ctx.stroke();

            ctx.fillStyle = c.icon;
            if (this.type === 'shield') {
                ctx.beginPath();
                ctx.moveTo(cx, this.y + bob + 4);
                ctx.lineTo(cx + 7, this.y + bob + 8);
                ctx.lineTo(cx + 7, this.y + bob + 13);
                ctx.lineTo(cx, this.y + bob + 18);
                ctx.lineTo(cx - 7, this.y + bob + 13);
                ctx.lineTo(cx - 7, this.y + bob + 8);
                ctx.closePath(); ctx.fill();
            } else if (this.type === 'speed') {
                ctx.beginPath();
                ctx.moveTo(cx + 3, this.y + bob + 4);
                ctx.lineTo(cx - 4, this.y + bob + 11);
                ctx.lineTo(cx + 1, this.y + bob + 11);
                ctx.lineTo(cx - 2, this.y + bob + 18);
                ctx.lineTo(cx + 5, this.y + bob + 10);
                ctx.lineTo(cx, this.y + bob + 10);
                ctx.closePath(); ctx.fill();
            } else if (this.type === 'life') {
                // Heart
                ctx.beginPath();
                ctx.arc(cx - 3.5, this.y + bob + 10, 4, 0, Math.PI * 2);
                ctx.arc(cx + 3.5, this.y + bob + 10, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.moveTo(cx - 7, this.y + bob + 12);
                ctx.lineTo(cx, this.y + bob + 19);
                ctx.lineTo(cx + 7, this.y + bob + 12);
                ctx.closePath(); ctx.fill();
            }
        }
    }

    // ============================================================
    // TRAPS
    // ============================================================

    // --- CollapseFloor ---
    class CollapseFloor {
        constructor(x, y, w, h) {
            this.x = x; this.y = y; this.w = w; this.h = h;
            this.startX = x; this.startY = y;
            this.state = 'idle'; this.timer = 0; this.vy = 0; this.shakeOffset = 0;
        }
        reset() { this.x = this.startX; this.y = this.startY; this.state = 'idle'; this.timer = 0; this.vy = 0; this.shakeOffset = 0; }
        isSolid() { return this.state === 'idle' || this.state === 'shaking'; }
        update(dt, player, particles) {
            if (this.state === 'idle') {
                const onTop = player.x + player.w > this.x + 2 && player.x < this.x + this.w - 2 &&
                    Math.abs(player.y + player.h - this.y) < 3 && player.onGround && !player.dead;
                if (onTop) { this.state = 'shaking'; this.timer = 450; }
            } else if (this.state === 'shaking') {
                this.timer -= dt;
                this.shakeOffset = (Math.random() - 0.5) * 3;
                if (this.timer <= 0) {
                    this.state = 'falling'; this.vy = 1;
                    particles.emit(this.x + this.w/2, this.y + this.h/2, 12, {
                        speed: [1, 3], life: [300, 600],
                        color: ['#6a5a48','#8a7a68','#aa9a88'], size: [2, 4], gravity: 0.25,
                    });
                }
            } else if (this.state === 'falling') {
                this.vy += 0.6; this.y += this.vy;
                if (this.y > 3000) this.state = 'gone';
            }
        }
        draw(ctx) {
            if (this.state === 'gone') return;
            const dx = this.state === 'shaking' ? this.shakeOffset : 0;
            if (this.state === 'shaking') {
                ctx.globalAlpha = 0.3 + Math.sin(Date.now() / 50) * 0.2;
                ctx.fillStyle = '#ff2e63';
                ctx.fillRect(this.x + dx - 2, this.y - 2, this.w + 4, this.h + 4);
                ctx.globalAlpha = 1;
            }
            ctx.fillStyle = '#3a3328'; ctx.fillRect(this.x + dx, this.y, this.w, this.h);
            ctx.fillStyle = this.state === 'shaking' ? '#ff2e63' : '#5a4d3a';
            ctx.fillRect(this.x + dx, this.y, this.w, 3);
            ctx.strokeStyle = '#1a1410'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(this.x + dx + this.w * 0.3, this.y);
            ctx.lineTo(this.x + dx + this.w * 0.4, this.y + this.h);
            ctx.moveTo(this.x + dx + this.w * 0.7, this.y);
            ctx.lineTo(this.x + dx + this.w * 0.6, this.y + this.h);
            ctx.stroke();
            ctx.strokeRect(this.x + dx, this.y, this.w, this.h);
        }
    }

    // --- SlidingWall ---
    class SlidingWall {
        constructor(x, y, w, h, dx, dy, range, speed, delay = 0) {
            this.x = x; this.y = y; this.w = w; this.h = h;
            this.startX = x; this.startY = y;
            this.dx = dx; this.dy = dy; this.range = range; this.speed = speed;
            this.delay = delay; this.timer = -delay; this.t = 0; this.dir = 1;
        }
        reset() { this.x = this.startX; this.y = this.startY; this.t = 0; this.dir = 1; this.timer = -this.delay; }
        isSolid() { return true; }
        update(dt, player, particles) {
            this.timer += dt; if (this.timer < 0) return;
            this.t += this.dir * this.speed * dt / 16;
            if (this.t >= this.range) {
                this.t = this.range; this.dir = -1;
                particles.emit(this.x + this.w/2 + this.dx*this.t, this.y + this.h/2 + this.dy*this.t, 5,
                    { speed: [0.5, 2], life: [200, 400], color: '#ff3232', size: [1, 3] });
            } else if (this.t <= 0) { this.t = 0; this.dir = 1; }
            this.x = this.startX + this.dx * this.t;
            this.y = this.startY + this.dy * this.t;
        }
        checkCrush(player) { return aabb(this, player); }
        draw(ctx) {
            ctx.fillStyle = '#1a1014'; ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.save();
            ctx.beginPath(); ctx.rect(this.x, this.y, this.w, this.h); ctx.clip();
            ctx.fillStyle = '#ff3232';
            const stripeW = 10, stripeGap = 10;
            for (let i = -this.h; i < this.w + this.h; i += stripeW + stripeGap) {
                ctx.beginPath();
                ctx.moveTo(this.x + i, this.y);
                ctx.lineTo(this.x + i + stripeW, this.y);
                ctx.lineTo(this.x + i + stripeW + this.h, this.y + this.h);
                ctx.lineTo(this.x + i + this.h, this.y + this.h);
                ctx.closePath(); ctx.fill();
            }
            ctx.restore();
            ctx.strokeStyle = '#0a0a14'; ctx.lineWidth = 2;
            ctx.strokeRect(this.x, this.y, this.w, this.h);
            ctx.strokeStyle = 'rgba(255,50,50,0.5)'; ctx.lineWidth = 1;
            ctx.strokeRect(this.x + 2, this.y + 2, this.w - 4, this.h - 4);
        }
    }

    // --- CrushingBlock — Slams down from above, rises slowly ---
    class CrushingBlock {
        constructor(x, topY, w, h, slamDistance, startDelay = 0) {
            this.x = x; this.w = w; this.h = h;
            this.topY = topY; this.y = topY;
            this.slamDistance = slamDistance; this.bottomY = topY + slamDistance;
            this.startDelay = startDelay;
            this.state = 'idle'; this.timer = 1500 + startDelay;
            this.shakeOffset = 0;
        }
        reset() { this.y = this.topY; this.state = 'idle'; this.timer = 1500 + this.startDelay; this.shakeOffset = 0; }
        isSolid() { return false; } // Non-solid; deadly on contact during slam/rest
        update(dt, player, particles, camera, sound) {
            this.timer -= dt;
            if (this.state === 'idle') {
                if (this.timer <= 0) { this.state = 'warning'; this.timer = 500; }
            } else if (this.state === 'warning') {
                this.shakeOffset = (Math.random() - 0.5) * 4;
                if (this.timer <= 0) { this.state = 'slamming'; this.timer = 250; this.shakeOffset = 0; }
            } else if (this.state === 'slamming') {
                const p = 1 - (this.timer / 250);
                this.y = this.topY + this.slamDistance * (p * p);
                if (this.timer <= 0) {
                    this.y = this.bottomY; this.state = 'resting'; this.timer = 600;
                    camera.shake(10); sound.crush();
                    particles.emit(this.x + this.w/2, this.y + this.h, 18, {
                        speed: [1, 5], life: [300, 700],
                        color: ['#aa1a1a','#ff3232','#666666'], size: [2, 5], gravity: 0.3,
                    });
                }
            } else if (this.state === 'resting') {
                if (this.timer <= 0) { this.state = 'rising'; this.timer = 1200; }
            } else if (this.state === 'rising') {
                const p = this.timer / 1200;
                this.y = this.bottomY - this.slamDistance * (1 - p * p);
                if (this.timer <= 0) { this.y = this.topY; this.state = 'idle'; this.timer = 1500; }
            }
        }
        checkCrush(player) {
            if (this.state === 'slamming' || this.state === 'resting') return aabb(this, player);
            return false;
        }
        draw(ctx) {
            const dx = this.state === 'warning' ? this.shakeOffset : 0;
            const dangerous = this.state === 'slamming' || this.state === 'resting';
            // Danger zone indicator
            if (this.state !== 'resting' && this.state !== 'slamming') {
                ctx.fillStyle = 'rgba(255, 50, 50, 0.08)';
                ctx.fillRect(this.x + dx, this.y + this.h, this.w, this.bottomY - this.y - this.h);
                ctx.strokeStyle = 'rgba(255, 50, 50, 0.15)'; ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(this.x + dx, this.y + this.h);
                ctx.lineTo(this.x + dx, this.bottomY);
                ctx.moveTo(this.x + dx + this.w, this.y + this.h);
                ctx.lineTo(this.x + dx + this.w, this.bottomY);
                ctx.stroke(); ctx.setLineDash([]);
            }
            // Body
            ctx.fillStyle = dangerous ? '#2a1014' : '#1a1014';
            ctx.fillRect(this.x + dx, this.y, this.w, this.h);
            // Hazard stripes
            ctx.save();
            ctx.beginPath(); ctx.rect(this.x + dx, this.y, this.w, this.h); ctx.clip();
            ctx.fillStyle = dangerous ? '#ff3232' : '#aa1a1a';
            const sW = 8, sG = 8;
            for (let i = -this.h; i < this.w + this.h; i += sW + sG) {
                ctx.beginPath();
                ctx.moveTo(this.x + dx + i, this.y);
                ctx.lineTo(this.x + dx + i + sW, this.y);
                ctx.lineTo(this.x + dx + i + sW + this.h, this.y + this.h);
                ctx.lineTo(this.x + dx + i + this.h, this.y + this.h);
                ctx.closePath(); ctx.fill();
            }
            ctx.restore();
            ctx.strokeStyle = '#0a0a14'; ctx.lineWidth = 2;
            ctx.strokeRect(this.x + dx, this.y, this.w, this.h);
            // Warning flash
            if (this.state === 'warning') {
                ctx.globalAlpha = 0.3 + Math.sin(Date.now() / 50) * 0.2;
                ctx.fillStyle = '#ff3232';
                ctx.fillRect(this.x + dx - 2, this.y - 2, this.w + 4, this.h + 4);
                ctx.globalAlpha = 1;
            }
            // Spikes on bottom
            ctx.fillStyle = '#0a0a14';
            const spikes = Math.max(1, Math.floor(this.w / 7));
            const sw = this.w / spikes;
            for (let i = 0; i < spikes; i++) {
                const sx = this.x + dx + i * sw;
                ctx.beginPath();
                ctx.moveTo(sx, this.y + this.h);
                ctx.lineTo(sx + sw / 2, this.y + this.h + 5);
                ctx.lineTo(sx + sw, this.y + this.h);
                ctx.closePath(); ctx.fill();
            }
        }
    }

    // --- MovingExit ---
    class MovingExit {
        constructor(x, y, w, h, dx, dy, range, speed) {
            this.x = x; this.y = y; this.w = w; this.h = h;
            this.startX = x; this.startY = y;
            this.dx = dx; this.dy = dy; this.range = range; this.speed = speed;
            this.t = 0; this.dir = 1; this.pulseTime = 0;
        }
        reset() { this.x = this.startX; this.y = this.startY; this.t = 0; this.dir = 1; }
        update(dt) {
            this.t += this.dir * this.speed * dt / 16;
            if (this.t >= this.range) { this.t = this.range; this.dir = -1; }
            else if (this.t <= 0) { this.t = 0; this.dir = 1; }
            this.x = this.startX + this.dx * this.t;
            this.y = this.startY + this.dy * this.t;
            this.pulseTime += dt;
        }
        checkWin(player) { return aabb(this, player); }
        draw(ctx) {
            const pulse = 0.7 + Math.sin(this.pulseTime / 200) * 0.3;
            ctx.shadowColor = '#08ffc8'; ctx.shadowBlur = 22 * pulse;
            ctx.fillStyle = '#08ffc8'; ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#a0fff0'; ctx.fillRect(this.x + 4, this.y + 4, this.w - 8, this.h - 8);
            ctx.fillStyle = '#0a3a30';
            ctx.fillRect(this.x + this.w/2 - 4, this.y + 6, 8, this.h - 12);
        }
    }

    // --- Spike ---
    class Spike {
        constructor(x, y, w, h, dir = 'up') { this.x = x; this.y = y; this.w = w; this.h = h; this.dir = dir; }
        reset() {}
        checkHit(player) {
            const hb = { x: this.x + 2, y: this.y + 2, w: this.w - 4, h: this.h - 4 };
            return aabb(hb, player);
        }
        draw(ctx) {
            const spikes = Math.max(1, Math.floor(this.w / 8));
            const sw = this.w / spikes;
            ctx.fillStyle = '#ff3232'; ctx.strokeStyle = '#0a0a14'; ctx.lineWidth = 1;
            for (let i = 0; i < spikes; i++) {
                const sx = this.x + i * sw;
                ctx.beginPath();
                if (this.dir === 'up') {
                    ctx.moveTo(sx, this.y + this.h);
                    ctx.lineTo(sx + sw / 2, this.y);
                    ctx.lineTo(sx + sw, this.y + this.h);
                } else {
                    ctx.moveTo(sx, this.y);
                    ctx.lineTo(sx + sw / 2, this.y + this.h);
                    ctx.lineTo(sx + sw, this.y);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            ctx.fillStyle = '#aa1a1a';
            if (this.dir === 'up') ctx.fillRect(this.x, this.y + this.h - 3, this.w, 3);
            else ctx.fillRect(this.x, this.y, this.w, 3);
        }
    }

    // --- Exit (static) ---
    class Exit {
        constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; this.pulseTime = 0; }
        reset() {}
        update(dt) { this.pulseTime += dt; }
        checkWin(player) { return aabb(this, player); }
        draw(ctx) {
            const pulse = 0.7 + Math.sin(this.pulseTime / 200) * 0.3;
            ctx.shadowColor = '#08ffc8'; ctx.shadowBlur = 25 * pulse;
            ctx.fillStyle = '#08ffc8'; ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#a0fff0'; ctx.fillRect(this.x + 3, this.y + 3, this.w - 6, this.h - 6);
            ctx.fillStyle = '#0a3a30'; ctx.fillRect(this.x + this.w/2 - 5, this.y + 6, 10, this.h - 12);
            ctx.fillStyle = '#ffd60a'; ctx.fillRect(this.x + this.w/2 + 2, this.y + this.h/2 - 1, 2, 2);
        }
    }

    // ============================================================
    // LEVEL DATA
    // Tile codes:
    //   # = solid    . = empty    P = player spawn    E = exit
    //   ^ = spike up    v = spike down    C = collapse floor
    //   L = lava    o = coin    S = shield    B = speed boost    1 = extra life
    // ============================================================
    const LEVELS = [
        // ---- LEVEL 1: First Steps ----
        {
            name: 'First Steps',
            hint: 'Coins, lava, and collapse. Grab the shield.',
            tiles: [
                '................................................................',
                '..................................o............................',
                '.........o..o.....................#.#...........ooo.............',
                '...................ooo............#o#...........................',
                '...................CCC###.........#o#..........o###o...........',
                '................o................##o#....oo....##.##...........',
                '..................................#o#....CC....#.E.#............',
                '.......###CCC##...........o.......#o#..........##.##............',
                '...........................ooo....#o#..........o###o............',
                '###........................CCC#####S#......###.....C##........',
                '#............................................#..................',
                '#........^^^o................................#.....oo..........o',
                '#......##CCC#..............ooo................#CCCC##^^^#.....o#',
                '#..P............oooS....###...####................C..........o##',
                '#######........####.....###LLL####................C.........o###',
                '######..................##########..o.............C........o####',
                '######o.................oooooooooo................C........#####',
                '########################CCCCCCCCCC#^##############.....#########',
                '###########################LLLL#####################LLL#########',
            ],
            entities: [],
        },

        // ---- LEVEL 2: The Grinder ----
        {
            name: 'The Grinder',
            hint: 'Crushing blocks and sliding walls. Speed boost helps.',
            tiles: [
                '###################################################################',
                '#..................o#..........................#.......#.........M#',
                '#.............oS^^^.#.........#.o..............#.......#......#####',
                '#..............####C..........#..o............o#.......#.....o....#',
                '#..................#######.####.............####.......#o...###...#',
                '#.........................o....................#......o##.........#',
                '#........o.ooo............o..................oo#.......oo.........#',
                '#......#CCC####...........o.............###CCC##o......##.........#',
                '#.........................S.............#...................o.....#',
                '#......................................o#...........#......###...o#',
                '#o.....^^^^o...........................##........^^^#............o#',
                '#o..########.................................########............o#',
                '#o.....................o........................................o##',
                '#..P....o........B.....#.....###oo..........o.o.o.o............o###',
                '######............###..#LLLLL###CCC####################.......o####',
                '######.................#######................................#####',
                '##ooo............o.............^^^..........#######....############',
                '############.....#.....#######################ooo########oooo######',
                '############LLLLL#LLLLL###########################################',
            ],
            entities: [
                { type: 'crushingBlock', x: 11, y: 2, w: 28, h: 28, slamDistance: 140, startDelay: 0 },
                { type: 'crushingBlock', x: 12, y: 2, w: 28, h: 28, slamDistance: 140, startDelay: 200 },
                { type: 'crushingBlock', x: 13, y: 2, w: 28, h: 28, slamDistance: 140, startDelay: 300 },
                { type: 'crushingBlock', x: 35, y: 9, w: 28, h: 28, slamDistance: 140, startDelay: 0 },
                { type: 'slidingWall', x: 46, y: 13, w: 28, h: 28, dx: 1, dy: 0, range: 220, speed: 2.2 },
                { type: 'slidingWall', x: 50, y: 15, w: 28, h: 28, dx: 1, dy: 0, range: 220, speed: 2.2 },
                { type: 'movingExit', x: 61, y: 1, w: 28, h: 28, dx: 1, dy: 0, range: 120, speed: 1.4 },
            ],
        },

        // ---- LEVEL 3: Devil's Design ----
        {
            name: "Devil's Design",
            hint: 'Everything wants you dead. Dig to find the extra life.',
            tiles: [
                '##########################################################################',
                '#..........o#..................#........#...........................ooooo#',
                '#o.P.B.....##..................#o.....#o#.............M.............ooooo#',
                '#######....##..................##.....#o#..........#########.......#######',
                '#o.......^^##..................#......#o#..........#.oo.####.......#o..###',
                '#....########.o#......#o.......#.....o#o#......o...#.##............##...##',
                '#........o...o###LLLL###o......#o....##o#........o...#######.............#',
                '#...........o############o.....##.....#o#......o...#########...#####....##',
                '#...........##############.....oC.....#o#........o.....................###',
                '########CCC################CCC####....#o#.......###...........o...o...####',
                '#.............o.o.o.o.o.o..^^...#.....#o#......................o.o.......#',
                '#.##.....^...###################.....o#o#....................o..o..o.^...#',
                '#.###########........................##o#....................#########...#',
                '#....................................o#o#........o.o.........o#######....#',
                '#...........................###..^^^..#................##.....o#####...E.#',
                '####CCCCCCCCCCCC####........###########C###C##...###...##......o###..#####',
                '##oooSoooSoooSoooS##..............o.o.#.....##...ooo...##.......o#..ooooo#',
                '###LL#LLL#LLL#LLL###^^...........o.o.o#^^^.1##LLL###LLL##1^^^....#..ooooo#',
                '###########################...############################################',
                '###########################LLL############################################',
            ],
            entities: [
                { type: 'crushingBlock', x: 21, y: 1, w: 28, h: 28, slamDistance: 140, startDelay: 0 },
                { type: 'crushingBlock', x: 16, y: 1, w: 28, h: 28, slamDistance: 140, startDelay: 0 },
                { type: 'crushingBlock', x: 42, y: 2, w: 28, h: 28, slamDistance: 140, startDelay: 600 },
                { type: 'crushingBlock', x: 60, y: 2, w: 28, h: 28, slamDistance: 140, startDelay: 1200 },
                { type: 'slidingWall', x: 16, y: 14, w: 28, h: 28, dx: 1, dy: 0, range: 180, speed: 2.6 },
                { type: 'slidingWall', x: 50, y: 13, w: 28, h: 28, dx: 1, dy: 0, range: 180, speed: 2.6, delay: 600 },
                { type: 'movingExit', x: 54, y: 2, w: 28, h: 28, dx: 1, dy: 0, range: 180, speed: 2.0 },
            ],
        },

        // ---- LEVEL 4: The Abyss ----
        {
            name: 'The Abyss',
            hint: 'The final circle. Use everything you have learned.',
            tiles: [
                "################################################################################",
                "#P....o.................####......................o.........................E...#",
                "#.#######...............#..#...........####..............####..............######",
                "#.......#......o........#..#......o....#..#....^^^^......#..#........o.........##",
                "#####...#####.......#####..#####.......#..##########.....#..#####.........#######",
                "#...........#..................#.......#.................#......#....o.........##",
                "#..oooo.....#....####..........#########.....C...........####...##########......#",
                "#...........#....#..#.........................####...............#...............#",
                "########....######..##########.......o........#..#...............#....oooo.......#",
                "#.............................................#..#.....^^^^......#######.........#",
                "#....####...............#######..........####.#..###########..............####...#",
                "#.......#....o..........#.....#..........#..#.#..............o.............#.....#",
                "#####...###########.....#.S...############..#.###########.....######.......#.1...#",
                "#.......................#...............................#...........#.......#######",
                "#....#######.......######......oooo...........######....#####.......#............#",
                "#...........#..................####...........#....#........#...B...##########...#",
                "######......###############.............###############.....#########............#",
                "#......o.............C..........^^^^^^..............C.............oooo...........#",
                "##########......############......##########......############......##############",
                "##########LLLLLL############LLLLLL##########LLLLLL############LLLLLL##############",
            ],
            entities: [
                { type: 'crushingBlock', x: 18, y: 6, w: 28, h: 28, slamDistance: 140, startDelay: 0 },
                { type: 'crushingBlock', x: 25, y: 2, w: 28, h: 28, slamDistance: 140, startDelay: 400 },
                { type: 'crushingBlock', x: 40, y: 2, w: 28, h: 28, slamDistance: 140, startDelay: 800 },
                { type: 'crushingBlock', x: 55, y: 2, w: 28, h: 28, slamDistance: 140, startDelay: 1200 },
                { type: 'slidingWall', x: 30, y: 13, w: 28, h: 112, dx: 0, dy: 1, range: 140, speed: 2.0 },
                { type: 'slidingWall', x: 50, y: 13, w: 28, h: 112, dx: 0, dy: 1, range: 140, speed: 2.0, delay: 500 },
            ],
        },
    ];

    // ============================================================
    // LEVEL
    // ============================================================
    class Level {
        constructor(data) {
            this.name = data.name; this.hint = data.hint;
            const maxW = Math.max(...data.tiles.map(r => r.length));
            this.tiles = data.tiles.map(r => r.padEnd(maxW, '.'));
            // Store original for restoring dug tiles on reset
            this.originalTiles = this.tiles.map(r => r);
            this.entityDefs = data.entities || [];
            this.tileW = maxW; this.tileH = this.tiles.length;
            this.pixelW = this.tileW * CONFIG.TILE_SIZE;
            this.pixelH = this.tileH * CONFIG.TILE_SIZE;
            this.parse(); this.spawnEntities();
        }

        parse() {
            this.solid = [];
            this.lavaTiles = [];
            for (let y = 0; y < this.tileH; y++) {
                this.solid[y] = [];
                for (let x = 0; x < this.tileW; x++) {
                    const c = this.tiles[y][x];
                    this.solid[y][x] = (c === '#');
                    if (c === 'L') {
                        this.lavaTiles.push({
                            x: x * CONFIG.TILE_SIZE, y: y * CONFIG.TILE_SIZE,
                            w: CONFIG.TILE_SIZE, h: CONFIG.TILE_SIZE, tx: x, ty: y,
                        });
                    }
                }
            }
        }

        spawnEntities() {
            this.spikes = []; this.collapseFloors = []; this.slidingWalls = [];
            this.crushingBlocks = []; this.exits = []; this.coins = []; this.powerUps = [];
            this.playerStart = { x: 50, y: 50 };

            for (let y = 0; y < this.tileH; y++) {
                for (let x = 0; x < this.tileW; x++) {
                    const c = this.tiles[y][x];
                    const px = x * CONFIG.TILE_SIZE, py = y * CONFIG.TILE_SIZE;
                    const ts = CONFIG.TILE_SIZE;
                    if (c === 'P') this.playerStart = { x: px + 3, y: py + (ts - CONFIG.PLAYER_H) };
                    else if (c === 'E') this.exits.push(new Exit(px, py, ts, ts));
                    else if (c === '^') this.spikes.push(new Spike(px, py + ts/2, ts, ts/2, 'up'));
                    else if (c === 'v') this.spikes.push(new Spike(px, py, ts, ts/2, 'down'));
                    else if (c === 'C') this.collapseFloors.push(new CollapseFloor(px, py, ts, ts));
                    else if (c === 'o') this.coins.push(new Coin(px + (ts-16)/2, py + (ts-16)/2));
                    else if (c === 'S') this.powerUps.push(new PowerUp(px + (ts-22)/2, py + (ts-22)/2, 'shield'));
                    else if (c === 'B') this.powerUps.push(new PowerUp(px + (ts-22)/2, py + (ts-22)/2, 'speed'));
                    else if (c === '1') this.powerUps.push(new PowerUp(px + (ts-22)/2, py + (ts-22)/2, 'life'));
                }
            }

            for (const def of this.entityDefs) {
                const px = def.x * CONFIG.TILE_SIZE, py = def.y * CONFIG.TILE_SIZE;
                if (def.type === 'slidingWall')
                    this.slidingWalls.push(new SlidingWall(px, py, def.w, def.h, def.dx, def.dy, def.range, def.speed, def.delay || 0));
                else if (def.type === 'movingExit')
                    this.exits.push(new MovingExit(px, py, def.w, def.h, def.dx, def.dy, def.range, def.speed));
                else if (def.type === 'crushingBlock')
                    this.crushingBlocks.push(new CrushingBlock(px, py, def.w, def.h, def.slamDistance, def.startDelay || 0));
            }
        }

        // Restore tiles and traps on player death
        reset() {
            this.tiles = this.originalTiles.map(r => r);
            this.parse();
            this.collapseFloors.forEach(c => c.reset());
            this.slidingWalls.forEach(w => w.reset());
            this.crushingBlocks.forEach(cb => cb.reset());
            this.exits.forEach(e => e.reset());
            // Coins and power-ups stay collected (don't reset)
        }

        // Dig a tile (called by Player.dig)
        digTile(cx, cy) {
            this.tiles[cy] = this.tiles[cy].substring(0, cx) + '.' + this.tiles[cy].substring(cx + 1);
            this.solid[cy][cx] = false;
        }

        getSolidTilesNear(box) {
            const tiles = [];
            const TS = CONFIG.TILE_SIZE;
            const x0 = Math.floor(box.x / TS) - 1, x1 = Math.floor((box.x + box.w) / TS) + 1;
            const y0 = Math.floor(box.y / TS) - 1, y1 = Math.floor((box.y + box.h) / TS) + 1;
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    if (y < 0 || y >= this.tileH || x < 0 || x >= this.tileW) continue;
                    if (this.solid[y][x])
                        tiles.push({ x: x * TS, y: y * TS, w: TS, h: TS });
                }
            }
            for (const cf of this.collapseFloors) if (cf.isSolid()) tiles.push({ x: cf.x, y: cf.y, w: cf.w, h: cf.h });
            for (const sw of this.slidingWalls) if (sw.isSolid()) tiles.push({ x: sw.x, y: sw.y, w: sw.w, h: sw.h });
            return tiles;
        }

        update(dt, player, particles, camera, sound) {
            this.collapseFloors.forEach(c => c.update(dt, player, particles));
            this.slidingWalls.forEach(w => w.update(dt, player, particles));
            this.crushingBlocks.forEach(cb => cb.update(dt, player, particles, camera, sound));
            this.exits.forEach(e => e.update(dt));
            this.coins.forEach(c => c.update(dt));
            this.powerUps.forEach(p => p.update(dt));

            // Spike collisions → instant kill
            for (const s of this.spikes) {
                if (!player.dead && !player.invulnerable && s.checkHit(player))
                    player.kill(particles, camera, sound);
            }
            // Sliding wall crush → instant kill
            for (const w of this.slidingWalls) {
                if (!player.dead && !player.invulnerable && w.checkCrush(player))
                    player.kill(particles, camera, sound);
            }
            // Crushing block → instant kill
            for (const cb of this.crushingBlocks) {
                if (!player.dead && !player.invulnerable && cb.checkCrush(player))
                    player.kill(particles, camera, sound);
            }
            // Lava → damage (not instant kill)
            for (const lava of this.lavaTiles) {
                if (!player.dead && !player.invulnerable && aabb(lava, player))
                    player.takeDamage(1, particles, camera, sound);
            }
        }

        checkWin(player) { return this.exits.some(e => e.checkWin(player)); }

        draw(ctx, camera) {
            const TS = CONFIG.TILE_SIZE;
            const sx = Math.max(0, Math.floor(camera.viewX / TS));
            const ex = Math.min(this.tileW, Math.ceil((camera.viewX + CONFIG.CANVAS_W) / TS));
            const sy = Math.max(0, Math.floor(camera.viewY / TS));
            const ey = Math.min(this.tileH, Math.ceil((camera.viewY + CONFIG.CANVAS_H) / TS));

            for (let y = sy; y < ey; y++)
                for (let x = sx; x < ex; x++)
                    if (this.tiles[y][x] === '#') this.drawSolidTile(ctx, x, y);

            this.drawLava(ctx);
            this.spikes.forEach(s => s.draw(ctx));
            this.collapseFloors.forEach(c => c.draw(ctx));
            this.crushingBlocks.forEach(cb => cb.draw(ctx));
            this.slidingWalls.forEach(w => w.draw(ctx));
            this.coins.forEach(c => c.draw(ctx));
            this.powerUps.forEach(p => p.draw(ctx));
            this.exits.forEach(e => e.draw(ctx));
        }

        drawLava(ctx) {
            const time = Date.now();
            for (const lava of this.lavaTiles) {
                const x = lava.x, y = lava.y, ts = CONFIG.TILE_SIZE;
                ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 20;
                const grad = ctx.createLinearGradient(x, y, x, y + ts);
                grad.addColorStop(0, '#ff6600'); grad.addColorStop(0.3, '#ff3300'); grad.addColorStop(1, '#cc1100');
                ctx.fillStyle = grad; ctx.fillRect(x, y, ts, ts);
                ctx.shadowBlur = 0;
                // Surface wave
                const wave = Math.sin(time / 200 + lava.tx * 0.5) * 2;
                ctx.fillStyle = '#ffaa00'; ctx.fillRect(x, y + wave, ts, 2);
                ctx.fillStyle = '#ffdd44'; ctx.fillRect(x, y + wave + 2, ts, 1);
                // Bubbles
                const bt = (time / 800 + lava.tx * 0.3) % 1;
                if (bt < 0.7) {
                    const bx = x + ts * 0.3 + Math.sin(time / 400 + lava.tx) * 6;
                    const by = y + ts - bt * ts * 1.2;
                    const bs = Math.max(0, 3 - bt * 2);
                    if (bs > 0) { ctx.fillStyle = `rgba(255,220,100,${1 - bt})`; ctx.fillRect(bx, by, bs, bs); }
                }
            }
        }

        drawSolidTile(ctx, tx, ty) {
            const x = tx * CONFIG.TILE_SIZE, y = ty * CONFIG.TILE_SIZE, ts = CONFIG.TILE_SIZE;
            const above = ty > 0 && this.solid[ty - 1] && this.solid[ty - 1][tx];
            const below = ty < this.tileH - 1 && this.solid[ty + 1] && this.solid[ty + 1][tx];
            ctx.fillStyle = '#2a2438'; ctx.fillRect(x, y, ts, ts);
            if (!above) { ctx.fillStyle = '#3d3552'; ctx.fillRect(x, y, ts, 4); ctx.fillStyle = '#5a4d70'; ctx.fillRect(x, y, ts, 1); }
            if (!below) { ctx.fillStyle = '#1a1626'; ctx.fillRect(x, y + ts - 4, ts, 4); }
            ctx.fillStyle = 'rgba(255,255,255,0.025)';
            ctx.fillRect(x + 4, y + 4, 3, 3); ctx.fillRect(x + ts - 7, y + ts - 7, 3, 3);
            ctx.strokeStyle = '#1a1626'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);
        }
    }

    // ============================================================
    // BACKGROUND
    // ============================================================
    class Background {
        constructor() {
            this.stars = [];
            for (let i = 0; i < 90; i++) this.stars.push({
                x: Math.random() * 1800, y: Math.random() * 540,
                z: Math.random() * 0.7 + 0.3, size: Math.random() * 1.8 + 0.5,
                twinkle: Math.random() * Math.PI * 2,
            });
            // this.time = 0;
        }
        update(dt) { for (const s of this.stars) s.twinkle += dt / 500; }
        draw(ctx, camera) {
            const grad = ctx.createLinearGradient(0, 0, 0, CONFIG.CANVAS_H);
            grad.addColorStop(0, '#08080f'); grad.addColorStop(0.5, '#14101e'); grad.addColorStop(1, '#1a0e1f');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
            for (const s of this.stars) {
                const sx = ((s.x - camera.x * s.z * 0.3) % 1800 + 1800) % 1800;
                const sy = s.y - camera.y * s.z * 0.15;
                if (sx < -5 || sx > CONFIG.CANVAS_W + 5 || sy < -5 || sy > CONFIG.CANVAS_H + 5) continue;
                ctx.globalAlpha = (0.3 + Math.sin(s.twinkle) * 0.3) * s.z;
                ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, sy, s.size, s.size);
            }
            ctx.globalAlpha = 1;
            // Distant silhouettes
            ctx.fillStyle = 'rgba(20,10,30,0.5)';
            ctx.beginPath(); ctx.moveTo(0, CONFIG.CANVAS_H);
            for (let i = 0; i < 24; i++) {
                const px = (i * 80 - camera.x * 0.15) % 1920;
                const py = CONFIG.CANVAS_H - 80 - Math.sin(i * 1.3) * 30;
                ctx.lineTo(px, py);
            }
            ctx.lineTo(CONFIG.CANVAS_W, CONFIG.CANVAS_H); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(30,15,40,0.6)';
            ctx.beginPath(); ctx.moveTo(0, CONFIG.CANVAS_H);
            for (let i = 0; i < 20; i++) {
                const px = (i * 100 - camera.x * 0.3) % 2000;
                const py = CONFIG.CANVAS_H - 40 - Math.sin(i * 0.9) * 25;
                ctx.lineTo(px, py);
            }
            ctx.lineTo(CONFIG.CANVAS_W, CONFIG.CANVAS_H); ctx.closePath(); ctx.fill();
        }
    }

    // ============================================================
    // GAME
    // ============================================================
    const STATE = { START: 'start', PLAYING: 'playing', LEVEL_COMPLETE: 'levelComplete', GAME_OVER: 'gameOver', WIN: 'win' };
    const DEATH_MESSAGES = [
        'The floor was a lie.', 'Spike met flesh.', 'Crushed by design.',
        'Gravity always wins.', 'The wall has no mercy.', 'Should have jumped.',
        'Should not have jumped.', 'Timing is everything.', 'The devil grins.',
        'Predictable.', 'Lava is hot. Who knew?', 'Dig deeper next time.',
    ];

    class Game {
        constructor() {
            this.canvas = document.getElementById('game');
            this.ctx = this.canvas.getContext('2d');
            this.ctx.imageSmoothingEnabled = false;
            this.input = new Input();
            this.camera = new Camera();
            this.particles = new ParticleSystem();
            this.background = new Background();
            this.sound = new SoundManager();
            this.state = STATE.START;
            this.levelIndex = 0;
            this.deathCount = 0;
            this.score = 0;
            this.levelScore = 0;
            this.startTime = 0;
            this.totalTime = 0;
            this.player = null; this.level = null;
            this.lastTime = 0;
            this.prevPlayerDead = false;
            this.setupUI();
        }

        setupUI() {
            document.getElementById('startBtn').addEventListener('click', () => { this.sound.init(); this.start(); });
            document.getElementById('restartBtn').addEventListener('click', () => this.restart());
            document.getElementById('nextBtn').addEventListener('click', () => this.nextLevel());
            document.getElementById('playAgainBtn').addEventListener('click', () => this.restart());
            document.getElementById('muteBtn').addEventListener('click', () => this.toggleMute());
        }

        toggleMute() {
            this.sound.init();
            const muted = this.sound.toggleMute();
            document.getElementById('muteBtn').textContent = muted ? '♪ SOUND: OFF' : '♪ SOUND: ON';
        }

        start() {
            this.state = STATE.PLAYING;
            this.levelIndex = 0; this.deathCount = 0; this.score = 0;
            this.startTime = performance.now();
            this.loadLevel(0);
            this.hideAllOverlays();
            this.updateHUD();
        }

        restart() {
            this.state = STATE.PLAYING;
            this.levelIndex = 0; this.deathCount = 0; this.score = 0;
            this.startTime = performance.now();
            this.loadLevel(0);
            this.hideAllOverlays();
            this.updateHUD();
        }

        nextLevel() {
            this.levelIndex++;
            if (this.levelIndex >= LEVELS.length) this.win();
            else { this.state = STATE.PLAYING; this.loadLevel(this.levelIndex); this.hideAllOverlays(); }
        }

        hideAllOverlays() {
            ['startScreen','gameOverScreen','levelCompleteScreen','winScreen']
                .forEach(id => document.getElementById(id).classList.add('hidden'));
        }

        loadLevel(idx) {
            this.level = new Level(LEVELS[idx]);
            this.player = new Player(this.level.playerStart.x, this.level.playerStart.y);
            this.player.setSpawn(this.level.playerStart.x, this.level.playerStart.y);
            this.player.resetForLevel();
            this.particles.clear();
            this.camera.snapTo(this.player.x, this.player.y);
            this.levelScore = 0;
            this.prevPlayerDead = false;
            document.getElementById('levelNum').textContent = idx + 1;
            const intro = document.getElementById('levelIntro');
            document.getElementById('introName').textContent = this.level.name;
            document.getElementById('introHint').textContent = this.level.hint;
            intro.classList.remove('show'); void intro.offsetWidth; intro.classList.add('show');
            this.updateHUD();
        }

        respawnPlayer() {
            this.player.reset();
            this.level.reset();
            this.particles.emit(this.player.x + this.player.w/2, this.player.y + this.player.h/2, 16, {
                speed: [1, 4], life: [300, 600], color: '#08ffc8', size: [2, 4],
            });
            this.updateHUD();
        }

        applyPowerUp(type) {
            switch (type) {
                case 'shield': this.player.shield = true; break;
                case 'speed': this.player.speedBoostTimer = CONFIG.SPEED_BOOST_DURATION; break;
                case 'life': this.player.extraLives++; break;
            }
            this.updateHUD();
        }

        triggerDeathFlash() {
            const flash = document.getElementById('deathFlash');
            flash.classList.remove('flash'); void flash.offsetWidth; flash.classList.add('flash');
        }

        completeLevel() {
            this.state = STATE.LEVEL_COMPLETE;
            this.sound.complete();
            this.particles.emit(this.player.x + this.player.w/2, this.player.y + this.player.h/2, 36, {
                speed: [2, 7], life: [500, 1100],
                color: ['#08ffc8', '#ffd60a', '#ffffff'], size: [2, 5], gravity: 0.05,
            });
            if (this.levelIndex >= LEVELS.length - 1) { this.win(); return; }
            document.getElementById('levelScore').textContent = this.levelScore;
            document.getElementById('totalScore').textContent = this.score;
            document.getElementById('levelMsg').textContent =
                `Stage ${this.levelIndex + 1} cleared. Next: ${LEVELS[this.levelIndex + 1].name}`;
            document.getElementById('levelCompleteScreen').classList.remove('hidden');
        }

        gameOver() {
            this.state = STATE.GAME_OVER;
            this.totalTime = (performance.now() - this.startTime) / 1000;
            document.getElementById('finalDeaths').textContent = this.deathCount;
            document.getElementById('finalLevel').textContent = this.levelIndex;
            document.getElementById('finalScore').textContent = this.score;
            document.getElementById('finalTime').textContent = this.totalTime.toFixed(1);
            document.getElementById('gameOverMsg').textContent = DEATH_MESSAGES[randInt(0, DEATH_MESSAGES.length - 1)];
            document.getElementById('gameOverScreen').classList.remove('hidden');
        }

        win() {
            this.state = STATE.WIN;
            this.sound.win();
            this.totalTime = (performance.now() - this.startTime) / 1000;
            document.getElementById('winDeaths').textContent = this.deathCount;
            document.getElementById('winTime').textContent = this.totalTime.toFixed(1);
            document.getElementById('winScore').textContent = this.score;
            document.getElementById('winScreen').classList.remove('hidden');
            document.getElementById('levelCompleteScreen').classList.add('hidden');
        }

        updateHUD() {
            document.getElementById('deathCount').textContent = this.deathCount;
            document.getElementById('scoreCount').textContent = this.score;
            document.getElementById('digCount').textContent = this.player ? this.player.digsRemaining : CONFIG.MAX_DIGS;
            if (this.player) {
                document.getElementById('healthDisplay').textContent = '♥'.repeat(this.player.health) + '♡'.repeat(this.player.maxHealth - this.player.health);
                // Shield
                const si = document.getElementById('shieldIndicator');
                if (this.player.shield) si.classList.remove('hidden-hud'); else si.classList.add('hidden-hud');
                // Speed boost
                const sp = document.getElementById('speedIndicator');
                if (this.player.speedBoostTimer > 0) {
                    sp.classList.remove('hidden-hud');
                    document.getElementById('speedTimer').textContent = (this.player.speedBoostTimer / 1000).toFixed(1);
                } else sp.classList.add('hidden-hud');
                // Extra lives
                const li = document.getElementById('lifeIndicator');
                if (this.player.extraLives > 0) {
                    li.classList.remove('hidden-hud');
                    document.getElementById('lifeCount').textContent = this.player.extraLives;
                } else li.classList.add('hidden-hud');
            }
        }

        update(dt) {
            this.background.update(dt);
            this.particles.update(dt);

            // Mute toggle
            if (this.input.wasPressed('mute')) this.toggleMute();

            if (this.state !== STATE.PLAYING) { this.input.endFrame(); return; }

            // Timer
            const elapsed = (performance.now() - this.startTime) / 1000;
            document.getElementById('timeCount').textContent = elapsed.toFixed(1);

            // Manual reset
            if (this.input.wasPressed('reset')) { this.respawnPlayer(); this.input.endFrame(); return; }

            // Update player & level
            this.player.update(dt, this.input, this.level, this.particles, this.camera, this.sound);
            this.level.update(dt, this.player, this.particles, this.camera, this.sound);

            // Coin collection
            for (const coin of this.level.coins) {
                if (coin.checkCollect(this.player)) {
                    this.score += 100; this.levelScore += 100;
                    this.sound.coin();
                    this.particles.emit(coin.x + coin.w/2, coin.y + coin.h/2, 8, {
                        speed: [1, 3], life: [200, 400], color: '#ffd60a', size: [2, 4],
                    });
                    this.updateHUD();
                }
            }

            // Power-up collection
            for (const pu of this.level.powerUps) {
                if (pu.checkCollect(this.player)) {
                    this.sound.powerup();
                    this.applyPowerUp(pu.type);
                    this.particles.emit(pu.x + pu.w/2, pu.y + pu.h/2, 16, {
                        speed: [1, 4], life: [300, 600],
                        color: pu.type === 'shield' ? '#08ffc8' : pu.type === 'speed' ? '#ffd60a' : '#ff2e63',
                        size: [2, 4],
                    });
                }
            }

            // --- DEATH COUNTER FIX: detect death transition ---
            if (!this.prevPlayerDead && this.player.dead) {
                this.sound.death();
                this.triggerDeathFlash();
                if (this.player.extraLives > 0) {
                    this.player.extraLives--;
                    // Extra life consumed: no death counter increment
                } else {
                    this.deathCount++;
                }
                this.updateHUD();
            }
            this.prevPlayerDead = this.player.dead;

            // Respawn after death animation
            if (this.player.dead && this.player.respawnTimer <= 0) this.respawnPlayer();

            // Win check
            if (!this.player.dead && this.level.checkWin(this.player)) this.completeLevel();

            // Camera
            this.camera.follow(this.player);
            this.camera.update();
            const maxX = Math.max(0, this.level.pixelW - CONFIG.CANVAS_W);
            const maxY = Math.max(0, this.level.pixelH - CONFIG.CANVAS_H);
            this.camera.x = clamp(this.camera.x, 0, maxX);
            this.camera.y = clamp(this.camera.y, 0, maxY);

            // Update speed boost timer display
            if (this.player.speedBoostTimer > 0) this.updateHUD();

            this.input.endFrame();
        }

        draw() {
            const ctx = this.ctx;
            ctx.clearRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);
            this.background.draw(ctx, this.camera);

            ctx.save();
            this.camera.apply(ctx);
            if (this.level) this.level.draw(ctx, this.camera);
            if (this.player) this.player.draw(ctx);
            this.particles.draw(ctx);
            ctx.restore();

            // Vignette
            const grad = ctx.createRadialGradient(
                CONFIG.CANVAS_W/2, CONFIG.CANVAS_H/2, 150,
                CONFIG.CANVAS_W/2, CONFIG.CANVAS_H/2, 600);
            grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.65)');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, CONFIG.CANVAS_W, CONFIG.CANVAS_H);

            // Scanlines
            ctx.globalAlpha = 0.04; ctx.fillStyle = '#000000';
            for (let y = 0; y < CONFIG.CANVAS_H; y += 3) ctx.fillRect(0, y, CONFIG.CANVAS_W, 1);
            ctx.globalAlpha = 1;
        }

        loop(t) {
            const dt = Math.min(t - this.lastTime, 33);
            this.lastTime = t;
            this.update(dt);
            this.draw();
            requestAnimationFrame((tt) => this.loop(tt));
        }

        run() { this.lastTime = performance.now(); requestAnimationFrame((tt) => this.loop(tt)); }
    }

    // ============================================================
    // BOOT
    // ============================================================
    const game = new Game();
    game.run();
    window.game = game;
})();
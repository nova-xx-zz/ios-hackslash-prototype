(() => {
  "use strict";

  // ---------- Setup ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0, height = 0;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const dist2 = (x1, y1, x2, y2) => (x2 - x1) ** 2 + (y2 - y1) ** 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const choice = (arr) => arr[randInt(0, arr.length - 1)];

  const BEST_KEY = "hackslash_best_wave";
  function getBest() { return parseInt(localStorage.getItem(BEST_KEY) || "0", 10); }
  function setBest(w) {
    if (w > getBest()) localStorage.setItem(BEST_KEY, String(w));
  }

  // ---------- Rarity table ----------
  const RARITIES = [
    { name: "コモン", color: "#cfd8dc", weight: 60, mult: 1 },
    { name: "レア", color: "#4dc3ff", weight: 30, mult: 2 },
    { name: "エピック", color: "#b24dff", weight: 10, mult: 4 },
  ];
  function rollRarity() {
    const total = RARITIES.reduce((s, r) => s + r.weight, 0);
    let roll = rand(0, total);
    for (const r of RARITIES) {
      if (roll < r.weight) return r;
      roll -= r.weight;
    }
    return RARITIES[0];
  }
  const ITEM_KINDS = [
    { key: "atk", label: "攻撃力の欠片" },
    { key: "speed", label: "俊足の欠片" },
    { key: "crit", label: "会心の欠片" },
    { key: "maxHp", label: "生命の欠片" },
  ];

  // ---------- Input: virtual joystick ----------
  const joystickZone = document.getElementById("joystickZone");
  const joystickBase = document.getElementById("joystickBase");
  const joystickStick = document.getElementById("joystickStick");
  let stickActive = false;
  let stickPointerId = null;
  let stickOrigin = { x: 0, y: 0 };
  let stickVec = { x: 0, y: 0 }; // -1..1

  function stickStart(x, y, pointerId) {
    stickActive = true;
    stickPointerId = pointerId;
    stickOrigin = { x, y };
    joystickBase.style.display = "flex";
    joystickBase.style.left = (x - 50) + "px";
    joystickBase.style.top = (y - 50) + "px";
    joystickStick.style.transform = "translate(0px, 0px)";
  }
  function stickMove(x, y) {
    if (!stickActive) return;
    const dx = x - stickOrigin.x;
    const dy = y - stickOrigin.y;
    const maxR = 40;
    const d = Math.hypot(dx, dy) || 1;
    const cl = Math.min(d, maxR);
    const nx = (dx / d) * cl;
    const ny = (dy / d) * cl;
    joystickStick.style.transform = `translate(${nx}px, ${ny}px)`;
    stickVec = { x: clamp(dx / maxR, -1, 1), y: clamp(dy / maxR, -1, 1) };
  }
  function stickEnd() {
    stickActive = false;
    stickPointerId = null;
    stickVec = { x: 0, y: 0 };
    joystickBase.style.display = "none";
  }

  joystickZone.addEventListener("pointerdown", (e) => {
    if (stickActive) return;
    e.preventDefault();
    joystickZone.setPointerCapture(e.pointerId);
    stickStart(e.clientX, e.clientY, e.pointerId);
  });
  joystickZone.addEventListener("pointermove", (e) => {
    if (!stickActive || e.pointerId !== stickPointerId) return;
    e.preventDefault();
    stickMove(e.clientX, e.clientY);
  });
  function releaseStick(e) {
    if (e.pointerId !== stickPointerId) return;
    stickEnd();
  }
  joystickZone.addEventListener("pointerup", releaseStick);
  joystickZone.addEventListener("pointercancel", releaseStick);

  // ---------- Game state ----------
  let state = "menu"; // menu | playing | gameover
  let camera = { x: 0, y: 0 };
  let player, enemies, orbs, particles, floaters;
  let wave, waveTimer, spawnQueue, spawnTimer, elapsed;
  let shake = 0;

  function makePlayer() {
    return {
      x: 0, y: 0, r: 16,
      speed: 190,
      hp: 100, maxHp: 100,
      atk: 12,
      crit: 0.08,
      attackRange: 90,
      attackCooldown: 0.55,
      attackTimer: 0,
      level: 1,
      xp: 0,
      xpToNext: 20,
      invuln: 0,
      facing: { x: 0, y: -1 },
      hitFlash: 0,
    };
  }

  const ENEMY_TYPES = [
    { key: "grunt", r: 14, hp: 18, speed: 70, dmg: 8, xp: 6, color: "#ff6b6b" },
    { key: "runner", r: 10, hp: 10, speed: 130, dmg: 5, xp: 5, color: "#ffb84d" },
    { key: "brute", r: 20, hp: 55, speed: 45, dmg: 16, xp: 14, color: "#c04dff" },
  ];

  function spawnEnemyAround(typeIndex) {
    const type = ENEMY_TYPES[typeIndex];
    const angle = rand(0, Math.PI * 2);
    const dist = rand(420, 560);
    const x = player.x + Math.cos(angle) * dist;
    const y = player.y + Math.sin(angle) * dist;
    const hpMult = 1 + (wave - 1) * 0.12;
    enemies.push({
      x, y, r: type.r,
      hp: type.hp * hpMult, maxHp: type.hp * hpMult,
      speed: type.speed, dmg: type.dmg, xp: type.xp,
      color: type.color, key: type.key,
      hitFlash: 0, knockX: 0, knockY: 0,
      contactCooldown: 0,
    });
  }

  function startWave(n) {
    wave = n;
    document.getElementById("waveBadge").textContent = "Wave " + wave;
    const count = 5 + Math.floor(wave * 2.2);
    spawnQueue = [];
    for (let i = 0; i < count; i++) {
      let idx = 0;
      if (wave >= 2 && Math.random() < 0.35) idx = 1;
      if (wave >= 3 && Math.random() < 0.2) idx = 2;
      spawnQueue.push(idx);
    }
    spawnTimer = 0;
    waveTimer = 0;
  }

  function resetGame() {
    player = makePlayer();
    enemies = [];
    orbs = [];
    particles = [];
    floaters = [];
    elapsed = 0;
    startWave(1);
    updateHud();
  }

  // ---------- Collectibles ----------
  function spawnOrb(x, y, kind, value) {
    // kind: 'xp' | 'gold' | 'item'
    orbs.push({ x, y, kind, value, r: kind === "item" ? 8 : 5, vx: 0, vy: 0 });
  }

  function killEnemy(e) {
    spawnOrb(e.x, e.y, "xp", e.xp);
    if (Math.random() < 0.35) spawnOrb(e.x + rand(-6, 6), e.y + rand(-6, 6), "gold", randInt(1, 4));
    if (Math.random() < 0.12) {
      const rarity = rollRarity();
      const kind = choice(ITEM_KINDS);
      orbs.push({
        x: e.x, y: e.y, kind: "item", r: 8,
        vx: 0, vy: 0,
        itemKind: kind, rarity,
      });
    }
    for (let i = 0; i < 6; i++) {
      particles.push({
        x: e.x, y: e.y,
        vx: rand(-90, 90), vy: rand(-90, 90),
        life: rand(0.25, 0.5), color: e.color,
      });
    }
  }

  function applyItem(itemKind, rarity) {
    const mult = rarity.mult;
    switch (itemKind.key) {
      case "atk": player.atk += 2 * mult; break;
      case "speed": player.speed += 6 * mult; break;
      case "crit": player.crit = clamp(player.crit + 0.02 * mult, 0, 0.75); break;
      case "maxHp":
        player.maxHp += 8 * mult;
        player.hp = Math.min(player.maxHp, player.hp + 8 * mult);
        break;
    }
    toast(`${rarity.name} ${itemKind.label} 取得！`, rarity.color);
  }

  function gainXp(v) {
    player.xp += v;
    while (player.xp >= player.xpToNext) {
      player.xp -= player.xpToNext;
      player.level++;
      player.xpToNext = Math.round(player.xpToNext * 1.35 + 6);
      player.maxHp += 10;
      player.hp = player.maxHp;
      player.atk += 1.5;
      toast(`レベルアップ！ Lv.${player.level}`, "#4dc3ff");
      shake = Math.max(shake, 8);
    }
    updateHud();
  }

  // ---------- Toast / HUD ----------
  const toastArea = document.getElementById("toastArea");
  function toast(text, color) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    if (color) el.style.borderColor = color;
    toastArea.appendChild(el);
    setTimeout(() => el.remove(), 1650);
  }

  const hpFill = document.getElementById("hpFill");
  const hpText = document.getElementById("hpText");
  const xpFill = document.getElementById("xpFill");
  const xpText = document.getElementById("xpText");
  const levelBadge = document.getElementById("levelBadge");

  function updateHud() {
    hpFill.style.transform = `scaleX(${clamp(player.hp / player.maxHp, 0, 1)})`;
    hpText.textContent = `${Math.max(0, Math.round(player.hp))}/${Math.round(player.maxHp)}`;
    xpFill.style.transform = `scaleX(${clamp(player.xp / player.xpToNext, 0, 1)})`;
    xpText.textContent = `XP ${Math.round(player.xp)}/${player.xpToNext}`;
    levelBadge.textContent = "Lv." + player.level;
  }

  // ---------- Combat ----------
  function tryAttack(dt) {
    player.attackTimer -= dt;
    if (player.attackTimer > 0) return;
    let target = null, bestD = player.attackRange ** 2;
    for (const e of enemies) {
      const d = dist2(player.x, player.y, e.x, e.y);
      if (d < bestD) { bestD = d; target = e; }
    }
    if (!target) return;
    player.attackTimer = player.attackCooldown;
    player.facing = normalize(target.x - player.x, target.y - player.y);

    const isCrit = Math.random() < player.crit;
    const dmg = player.atk * (isCrit ? 1.8 : 1);
    target.hp -= dmg;
    target.hitFlash = 0.12;
    const kn = normalize(target.x - player.x, target.y - player.y);
    target.knockX += kn.x * 120;
    target.knockY += kn.y * 120;

    floaters.push({
      x: target.x, y: target.y - target.r - 4,
      text: (isCrit ? "CRIT " : "") + Math.round(dmg),
      life: 0.6, vy: -40, color: isCrit ? "#ffd24d" : "#ffffff",
    });

    // simple slash particle
    particles.push({
      x: target.x, y: target.y, vx: 0, vy: 0, life: 0.15,
      color: "#ffffff", slash: true, angle: Math.atan2(kn.y, kn.x),
    });

    if (target.hp <= 0) {
      const idx = enemies.indexOf(target);
      if (idx >= 0) enemies.splice(idx, 1);
      killEnemy(target);
    }
  }

  function normalize(x, y) {
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
  }

  // ---------- Main update ----------
  function update(dt) {
    elapsed += dt;

    // movement
    const mv = normalize(stickVec.x, stickVec.y);
    const mag = Math.min(1, Math.hypot(stickVec.x, stickVec.y));
    if (mag > 0.05) {
      player.x += mv.x * player.speed * dt * mag;
      player.y += mv.y * player.speed * dt * mag;
      player.facing = mv;
    }

    tryAttack(dt);

    // enemy spawn queue
    spawnTimer -= dt;
    if (spawnQueue.length > 0 && spawnTimer <= 0) {
      spawnEnemyAround(spawnQueue.pop());
      spawnTimer = 0.5;
    }

    // enemies update
    for (const e of enemies) {
      if (e.hitFlash > 0) e.hitFlash -= dt;
      e.knockX *= 0.88; e.knockY *= 0.88;
      const dir = normalize(player.x - e.x, player.y - e.y);
      e.x += (dir.x * e.speed + e.knockX) * dt;
      e.y += (dir.y * e.speed + e.knockY) * dt;

      e.contactCooldown -= dt;
      const rr = (e.r + player.r) ** 2;
      if (dist2(e.x, e.y, player.x, player.y) < rr && e.contactCooldown <= 0 && player.invuln <= 0) {
        player.hp -= e.dmg;
        player.invuln = 0.5;
        player.hitFlash = 0.25;
        e.contactCooldown = 0.8;
        shake = Math.max(shake, 5);
        updateHud();
        if (player.hp <= 0) { player.hp = 0; endGame(); return; }
      }
    }
    if (player.invuln > 0) player.invuln -= dt;
    if (player.hitFlash > 0) player.hitFlash -= dt;

    // orbs: magnet + collect
    const magnetR2 = 70 * 70;
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      const d2 = dist2(o.x, o.y, player.x, player.y);
      if (d2 < magnetR2) {
        const dir = normalize(player.x - o.x, player.y - o.y);
        const speed = 260;
        o.x += dir.x * speed * dt;
        o.y += dir.y * speed * dt;
      }
      if (d2 < (player.r + o.r + 6) ** 2) {
        if (o.kind === "xp") gainXp(o.value);
        else if (o.kind === "gold") toast(`+${o.value} ゴールド`, "#ffd24d");
        else if (o.kind === "item") applyItem(o.itemKind, o.rarity);
        orbs.splice(i, 1);
      }
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.9; p.vy *= 0.9;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      f.y += f.vy * dt;
      f.vy *= 0.94;
      if (f.life <= 0) floaters.splice(i, 1);
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 20);

    // wave progression
    if (spawnQueue.length === 0 && enemies.length === 0) {
      waveTimer += dt;
      if (waveTimer > 1.2) {
        toast(`ウェーブ ${wave} クリア！`, "#7c5cff");
        setBest(wave);
        startWave(wave + 1);
      }
    }

    camera.x = player.x;
    camera.y = player.y;
  }

  function endGame() {
    state = "gameover";
    setBest(wave);
    document.getElementById("resultText").textContent =
      `到達ウェーブ: ${wave}　レベル: ${player.level}　生存時間: ${Math.floor(elapsed)}秒`;
    document.getElementById("gameOverScreen").classList.remove("hidden");
    stickEnd();
  }

  // ---------- Render ----------
  function worldToScreen(x, y) {
    return { x: x - camera.x + width / 2, y: y - camera.y + height / 2 };
  }

  function render() {
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
    }

    // ground grid
    const gridSize = 60;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    const offX = ((camera.x % gridSize) + gridSize) % gridSize;
    const offY = ((camera.y % gridSize) + gridSize) % gridSize;
    ctx.beginPath();
    for (let x = -offX; x < width; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = -offY; y < height; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();

    // orbs
    for (const o of orbs) {
      const s = worldToScreen(o.x, o.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, o.r, 0, Math.PI * 2);
      if (o.kind === "xp") ctx.fillStyle = "#4dc3ff";
      else if (o.kind === "gold") ctx.fillStyle = "#ffd24d";
      else ctx.fillStyle = o.rarity.color;
      ctx.fill();
      if (o.kind === "item") {
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // particles
    for (const p of particles) {
      const s = worldToScreen(p.x, p.y);
      if (p.slash) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(p.angle);
        ctx.strokeStyle = `rgba(255,255,255,${clamp(p.life / 0.15, 0, 1)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 26, -0.6, 0.6);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.globalAlpha = clamp(p.life / 0.4, 0, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // enemies
    for (const e of enemies) {
      const s = worldToScreen(e.x, e.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = e.hitFlash > 0 ? "#ffffff" : e.color;
      ctx.fill();
      // hp bar
      const w = e.r * 2;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(s.x - w / 2, s.y - e.r - 8, w, 4);
      ctx.fillStyle = "#ff4d5e";
      ctx.fillRect(s.x - w / 2, s.y - e.r - 8, w * clamp(e.hp / e.maxHp, 0, 1), 4);
    }

    // player
    {
      const s = worldToScreen(player.x, player.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, player.r, 0, Math.PI * 2);
      ctx.fillStyle = player.hitFlash > 0 ? "#ff9999" : "#7c5cff";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
      // facing indicator
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + player.facing.x * (player.r + 8), s.y + player.facing.y * (player.r + 8));
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.stroke();
      // attack range ring (subtle)
      ctx.beginPath();
      ctx.arc(s.x, s.y, player.attackRange, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(124,92,255,0.15)";
      ctx.stroke();
    }

    // floaters
    ctx.textAlign = "center";
    ctx.font = "bold 14px -apple-system, sans-serif";
    for (const f of floaters) {
      const s = worldToScreen(f.x, f.y);
      ctx.globalAlpha = clamp(f.life / 0.6, 0, 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, s.x, s.y);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  // ---------- Loop ----------
  let lastTime = 0;
  function frame(t) {
    const dt = Math.min(0.05, (t - lastTime) / 1000 || 0);
    lastTime = t;
    if (state === "playing") {
      update(dt);
      render();
    }
    requestAnimationFrame(frame);
  }

  // ---------- Screens ----------
  const startScreen = document.getElementById("startScreen");
  const gameOverScreen = document.getElementById("gameOverScreen");
  document.getElementById("bestScore").textContent = "ベストウェーブ: " + getBest();

  document.getElementById("startBtn").addEventListener("click", () => {
    startScreen.classList.add("hidden");
    resetGame();
    state = "playing";
  });
  document.getElementById("retryBtn").addEventListener("click", () => {
    gameOverScreen.classList.add("hidden");
    document.getElementById("bestScore").textContent = "ベストウェーブ: " + getBest();
    resetGame();
    state = "playing";
  });

  requestAnimationFrame((t) => { lastTime = t; requestAnimationFrame(frame); });
})();

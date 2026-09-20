(() => {
  "use strict";

  const BEST_KEY = "jobquest_best_cleared";
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MAX_ACTIVE = 5;

  function getBestStage() { return parseInt(localStorage.getItem(BEST_KEY) || "0", 10); }
  function setBestStage(n) { if (n > getBestStage()) localStorage.setItem(BEST_KEY, String(n)); }

  // ---------- Roster ----------
  let nextCharSeq = 1;
  function newCharacter(name, job, race, opts) {
    opts = opts || {};
    const c = {
      id: "c" + nextCharSeq++, name, job, race: race || "human",
      subAbilityId: null,
      skillActive: {}, // abilityId -> bool (default true when unlocked)
      level: opts.level || 1, exp: 0, expToNext: 30,
      equip: null,
      atb: 0, defending: false, alive: true,
      active: opts.active !== undefined ? opts.active : true,
      isMonster: opts.isMonster || false,
    };
    c.expToNext = 30 + c.level * 15;
    const s = computeStats(c);
    c.hp = s.maxHp; c.mp = s.maxMp;
    return c;
  }

  function computeStats(c) {
    const job = JOBS[c.job];
    const race = RACES[c.race] || RACES.human;
    const growth = 1 + 0.12 * (c.level - 1);
    const s = {
      maxHp: Math.round(job.base.hp * growth * race.mult.hp),
      maxMp: Math.round(job.base.mp * growth * race.mult.mp),
      atk: Math.round(job.base.atk * growth * race.mult.atk),
      mag: Math.round(job.base.mag * growth * race.mult.mag),
      def: Math.round(job.base.def * growth * race.mult.def),
      spd: job.base.spd * race.mult.spd,
    };
    if (c.equip) s[c.equip.stat] += c.equip.value;
    return s;
  }

  function racePassive(c, key) {
    const race = RACES[c.race] || RACES.human;
    return race.passive[key] || 0;
  }

  function availableAbilities(c) {
    const job = JOBS[c.job];
    const list = job.abilities.filter((a) => c.level >= a.reqLevel);
    if (c.subAbilityId) {
      const sub = getAbilityById(c.subAbilityId);
      if (sub && !list.find((a) => a.id === sub.id)) list.push(sub);
    }
    return list;
  }

  function isSkillActive(c, abilityId) {
    return c.skillActive[abilityId] !== false; // default ON
  }

  function subAbilityCandidates(c) {
    const list = [];
    for (const jobId in JOBS) {
      if (jobId === c.job) continue;
      for (const a of JOBS[jobId].abilities) {
        if (c.level >= a.reqLevel) list.push(a);
      }
    }
    return list;
  }

  function activeParty() { return roster.filter((c) => c.active); }
  function currentMaxLevel() { return roster.reduce((m, c) => Math.max(m, c.level), 1); }

  let roster = [
    newCharacter("アレン", "warrior", "human"),
    newCharacter("ガイ", "warrior", "beastkin"),
    newCharacter("ミナ", "mage", "sylvan"),
    newCharacter("ノア", "mage", "nocturne"),
    newCharacter("ルカ", "priest", "stonekin"),
  ];

  let battle = null;
  let run = null; // 進行中のダンジョン { dungeon, battleIndex, expTotal, drops }
  let clearedDungeons = new Set();
  let selectedDungeonId = null;
  let jobsReturnScreen = "screen-title";
  let speedMult = 1;

  function isDungeonOpen(d) {
    if (clearedDungeons.has(d.id)) return true;
    if (d.id === DUNGEONS[0].id) return true;
    return DUNGEONS.some((src) => clearedDungeons.has(src.id) && src.unlocks.includes(d.id));
  }

  // ---------- Screen management ----------
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
    document.getElementById(id).classList.remove("hidden");
  }

  // ---------- Title screen ----------
  function renderTitle() {
    const el = document.getElementById("partyPreview");
    el.innerHTML = "";
    for (const c of activeParty()) {
      const div = document.createElement("div");
      div.className = "mini-card";
      div.innerHTML = `<div class="name">${c.name}</div><div class="job">${RACES[c.race].name}・${JOBS[c.job].name} Lv.${c.level}</div>`;
      el.appendChild(div);
    }
    const best = getBestStage();
    const bits = [];
    if (best > 0) bits.push(`クリア済みダンジョン: ${best}`);
    bits.push(`所持なかま: ${roster.length}人`);
    document.getElementById("bestClearText").textContent = bits.join("　/　");
  }

  document.getElementById("btnGoBattle").addEventListener("click", () => {
    openMap();
  });
  document.getElementById("btnGoJobs").addEventListener("click", () => {
    jobsReturnScreen = "screen-title";
    renderJobsScreen();
    showScreen("screen-jobs");
  });

  // ---------- Map screen ----------
  function averagePartyLevel() {
    const p = activeParty();
    if (p.length === 0) return 1;
    return Math.round(p.reduce((s, c) => s + c.level, 0) / p.length);
  }

  function openMap() {
    renderMap();
    showScreen("screen-map");
  }

  function renderMap() {
    const nodes = document.getElementById("mapNodes");
    const svg = document.getElementById("mapLines");
    nodes.innerHTML = "";
    svg.innerHTML = "";

    for (const d of DUNGEONS) {
      for (const nextId of d.unlocks) {
        const next = getDungeon(nextId);
        if (!next) continue;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", d.x);
        line.setAttribute("y1", d.y);
        line.setAttribute("x2", next.x);
        line.setAttribute("y2", next.y);
        if (clearedDungeons.has(d.id)) line.classList.add("open");
        svg.appendChild(line);
      }
    }

    for (const d of DUNGEONS) {
      const cleared = clearedDungeons.has(d.id);
      const open = isDungeonOpen(d);
      const btn = document.createElement("button");
      btn.className = "map-node " + (cleared ? "cleared" : open ? "open" : "locked") +
        (selectedDungeonId === d.id ? " selected" : "");
      btn.style.left = d.x + "%";
      btn.style.top = d.y + "%";
      btn.innerHTML = `<div class="dot">${cleared ? "✓" : open ? "▶" : "—"}</div>
        <div class="label">${d.name}<br>Lv.${d.level}</div>`;
      if (open) btn.addEventListener("click", () => selectDungeon(d));
      nodes.appendChild(btn);
    }
  }

  function selectDungeon(d) {
    selectedDungeonId = d.id;
    renderMap();
    renderDungeonInfo(d);
  }

  function renderDungeonInfo(d) {
    const el = document.getElementById("dungeonInfo");
    const avg = averagePartyLevel();
    const enemyNames = d.pool.map((k) => getEnemyTemplate(k).name).join("・");
    const warn = avg < d.level
      ? `<span class="level-warn">（編成の平均Lv.${avg} — 推奨に届いていません）</span>`
      : `（編成の平均Lv.${avg}）`;
    el.innerHTML = `
      <div class="dname">${d.name}${clearedDungeons.has(d.id) ? "　クリア済み" : ""}</div>
      <div class="dmeta">
        ${d.desc}<br>
        推奨レベル: ${d.level} ${warn}<br>
        戦闘数: ${d.battles}回（最後はボス戦）<br>
        出現モンスター: ${enemyNames}
      </div>`;
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.id = "btnEnterDungeon";
    btn.textContent = "出発する";
    btn.addEventListener("click", () => startDungeon(d.id));
    el.appendChild(btn);
  }

  document.getElementById("btnMapBack").addEventListener("click", () => {
    renderTitle();
    showScreen("screen-title");
  });

  // ---------- Party / job screen ----------
  function renderJobsScreen() {
    const wrap = document.getElementById("jobCharList");
    wrap.innerHTML = "";

    const hint = document.createElement("div");
    hint.className = "sub";
    hint.style.margin = "0 0 12px";
    hint.textContent = `編成人数: ${activeParty().length} / ${MAX_ACTIVE}（編成に入れたキャラだけが戦闘に参加します）`;
    wrap.appendChild(hint);

    for (const c of roster) {
      const card = document.createElement("div");
      card.className = "job-char-card";

      const activeRow = document.createElement("div");
      activeRow.className = "job-pick-row";
      const activeBtn = document.createElement("button");
      const atCap = !c.active && activeParty().length >= MAX_ACTIVE;
      activeBtn.className = "job-pick" + (c.active ? " active" : "") + (atCap ? " disabled" : "");
      activeBtn.textContent = c.active ? "編成中（外す）" : "ベンチ（編成に入れる）";
      activeBtn.addEventListener("click", () => {
        if (atCap) return;
        c.active = !c.active;
        if (c.active) {
          const s = computeStats(c);
          c.hp = Math.min(c.hp, s.maxHp);
          c.mp = Math.min(c.mp, s.maxMp);
        }
        renderJobsScreen();
      });
      activeRow.appendChild(activeBtn);

      const jobRow = document.createElement("div");
      jobRow.className = "job-pick-row";
      for (const jobId in JOBS) {
        const btn = document.createElement("button");
        btn.className = "job-pick" + (c.job === jobId ? " active" : "");
        btn.textContent = JOBS[jobId].name;
        btn.addEventListener("click", () => {
          c.job = jobId;
          if (c.subAbilityId) {
            const sub = getAbilityById(c.subAbilityId);
            if (sub && JOBS[jobId].abilities.find((a) => a.id === sub.id)) c.subAbilityId = null;
          }
          const s = computeStats(c);
          c.hp = Math.min(c.hp, s.maxHp);
          c.mp = Math.min(c.mp, s.maxMp);
          renderJobsScreen();
        });
        jobRow.appendChild(btn);
      }

      const subRow = document.createElement("div");
      subRow.className = "sub-ability-row";
      const candidates = subAbilityCandidates(c);
      subRow.textContent = "サブアビリティ（他ジョブで習得済みの技を1つ装備できる）";
      const subPickRow = document.createElement("div");
      subPickRow.className = "sub-pick-row";

      const noneBtn = document.createElement("button");
      noneBtn.className = "sub-pick" + (!c.subAbilityId ? " active" : "");
      noneBtn.textContent = "なし";
      noneBtn.addEventListener("click", () => { c.subAbilityId = null; renderJobsScreen(); });
      subPickRow.appendChild(noneBtn);

      for (const a of candidates) {
        const btn = document.createElement("button");
        btn.className = "sub-pick" + (c.subAbilityId === a.id ? " active" : "");
        btn.textContent = a.name;
        btn.addEventListener("click", () => { c.subAbilityId = a.id; renderJobsScreen(); });
        subPickRow.appendChild(btn);
      }
      if (candidates.length === 0) {
        const hintEl = document.createElement("div");
        hintEl.className = "sub-ability-row";
        hintEl.textContent = "（まだ他ジョブの技を習得していません）";
        subRow.appendChild(hintEl);
      }

      const skillRow = document.createElement("div");
      skillRow.className = "sub-ability-row";
      skillRow.textContent = "オート戦闘で使うスキル（OFFにすると自動行動では使わない）";
      const skillToggleRow = document.createElement("div");
      skillToggleRow.className = "skill-toggle-row";
      for (const a of availableAbilities(c)) {
        const on = isSkillActive(c, a.id);
        const btn = document.createElement("button");
        btn.className = "skill-toggle" + (on ? " on" : "");
        btn.textContent = `${a.name} ${on ? "ON" : "OFF"}`;
        btn.addEventListener("click", () => {
          c.skillActive[a.id] = !isSkillActive(c, a.id);
          renderJobsScreen();
        });
        skillToggleRow.appendChild(btn);
      }
      const locked = JOBS[c.job].abilities.filter((a) => c.level < a.reqLevel);
      for (const a of locked) {
        const span = document.createElement("span");
        span.className = "skill-toggle";
        span.style.opacity = "0.35";
        span.textContent = `${a.name}（Lv.${a.reqLevel}で習得）`;
        skillToggleRow.appendChild(span);
      }

      const race = RACES[c.race];
      const stats = computeStats(c);
      card.innerHTML = `<div class="cname">${c.name}${c.isMonster ? "（テイム）" : ""} — ${race.name}・${JOBS[c.job].name} Lv.${c.level}
        <span style="float:right;color:var(--sub-text);font-size:11px;">HP${stats.maxHp} MP${stats.maxMp} ATK${stats.atk} MAG${stats.mag} DEF${stats.def} SPD${Math.round(stats.spd)}</span></div>
        <div class="sub-ability-row">${race.desc}</div>`;
      card.appendChild(activeRow);
      card.appendChild(jobRow);
      card.appendChild(subRow);
      card.appendChild(subPickRow);
      card.appendChild(skillRow);
      card.appendChild(skillToggleRow);
      wrap.appendChild(card);
    }
  }

  document.getElementById("btnJobsDone").addEventListener("click", () => {
    if (jobsReturnScreen === "screen-result") showScreen("screen-result");
    else if (jobsReturnScreen === "screen-map") openMap();
    else { renderTitle(); showScreen("screen-title"); }
  });
  document.getElementById("btnResultJobs").addEventListener("click", () => {
    jobsReturnScreen = "screen-result";
    renderJobsScreen();
    showScreen("screen-jobs");
  });
  document.getElementById("btnMapJobs").addEventListener("click", () => {
    jobsReturnScreen = "screen-map";
    renderJobsScreen();
    showScreen("screen-jobs");
  });
  document.getElementById("btnRecruit").addEventListener("click", () => {
    const r = rollNewRecruit();
    const lvl = Math.max(1, currentMaxLevel() - 1);
    const c = newCharacter(r.name, r.job, r.race, { level: lvl, active: false });
    roster.push(c);
    renderJobsScreen();
  });

  // ---------- Battle ----------
  const ATB_RATE = 7;
  const BASIC_ATTACK = { id: "attack", name: "たたかう", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.0, hits: 1 };

  let enemyEls = {}, partyEls = {};

  function startDungeon(id) {
    const d = getDungeon(id);
    run = {
      dungeon: d, battleIndex: 0,
      expTotal: 0, drops: [], levelUps: [], abilityUnlocks: [], defeatedTamable: [],
    };
    for (const c of activeParty()) {
      const s = computeStats(c);
      c.hp = s.maxHp; c.mp = s.maxMp; c.alive = true;
    }
    startBattle();
  }

  function startBattle() {
    const d = run.dungeon;
    const isBoss = run.battleIndex === d.battles - 1;
    const enemies = buildEncounter(d, run.battleIndex);
    battle = {
      enemies: enemies.map((e, i) => ({ ...e, id: "e" + i, alive: true })),
      log: [],
      active: true,
    };
    for (const c of activeParty()) { c.atb = rand(0, 25); c.defending = false; c.actedFlash = 0; }
    buildBattleDOM();
    document.getElementById("stageLabel").textContent =
      `${d.name}　${run.battleIndex + 1}/${d.battles}${isBoss ? "（ボス）" : ""}`;
    logMsg(isBoss ? `${d.name} — ボスが立ちはだかる！` : `${d.name} — 敵が現れた！`, "system");
    showScreen("screen-battle");
  }

  function buildBattleDOM() {
    const enemyRow = document.getElementById("enemyRow");
    const partyRow = document.getElementById("partyRow");
    enemyRow.innerHTML = "";
    partyRow.innerHTML = "";
    enemyEls = {}; partyEls = {};

    for (const e of battle.enemies) {
      const card = document.createElement("div");
      card.className = "enemy-card";
      card.innerHTML = `
        <div class="enemy-sprite" style="background:${e.color}"></div>
        <div class="enemy-name">${e.name}</div>
        <div class="mini-bar hp"><div class="fill" style="width:100%"></div></div>`;
      enemyRow.appendChild(card);
      enemyEls[e.id] = card;
    }

    for (const c of activeParty()) {
      const card = document.createElement("div");
      card.className = "actor-card";
      card.innerHTML = `
        <div class="actor-name">${c.name}</div>
        <div class="actor-job">${JOBS[c.job].name} Lv.${c.level}</div>
        <div class="stat-bar hp"><div class="fill" style="width:100%"></div></div>
        <div class="stat-num hpnum"></div>
        <div class="stat-bar mp"><div class="fill" style="width:100%"></div></div>
        <div class="stat-num mpnum"></div>
        <div class="stat-bar atb"><div class="fill" style="width:0%"></div></div>`;
      partyRow.appendChild(card);
      partyEls[c.id] = card;
    }
    updateBattleDOM();
  }

  function updateBattleDOM() {
    for (const e of battle.enemies) {
      const el = enemyEls[e.id];
      if (!el) continue;
      el.classList.toggle("dead", !e.alive);
      el.querySelector(".mini-bar.hp .fill").style.width = clamp((e.hp / e.maxHp) * 100, 0, 100) + "%";
    }
    for (const c of activeParty()) {
      const el = partyEls[c.id];
      if (!el) continue;
      const s = computeStats(c);
      el.classList.toggle("down", !c.alive);
      el.classList.toggle("acted", c.actedFlash > 0);
      el.querySelector(".stat-bar.hp .fill").style.width = clamp((c.hp / s.maxHp) * 100, 0, 100) + "%";
      el.querySelector(".hpnum").textContent = `HP ${Math.max(0, Math.round(c.hp))}/${s.maxHp}`;
      el.querySelector(".stat-bar.mp .fill").style.width = clamp((c.mp / s.maxMp) * 100, 0, 100) + "%";
      el.querySelector(".mpnum").textContent = `MP ${Math.max(0, Math.round(c.mp))}/${s.maxMp}`;
      el.querySelector(".stat-bar.atb .fill").style.width = clamp(c.atb, 0, 100) + "%";
    }
  }

  function logMsg(text, cls) {
    battle.log.push({ text, cls: cls || "" });
    const box = document.getElementById("battleLog");
    const div = document.createElement("div");
    div.className = "line " + (cls || "");
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  document.getElementById("btnSpeedToggle").addEventListener("click", () => {
    speedMult = speedMult === 1 ? 2 : 1;
    document.getElementById("btnSpeedToggle").textContent = `再生速度 x${speedMult}`;
  });

  // ---------- Auto-battle AI ----------
  function chooseAction(c) {
    const abilities = availableAbilities(c).filter((a) => isSkillActive(c, a.id) && c.mp >= a.mpCost);
    const usable = abilities.filter((a) => {
      if (a.kind !== "heal") return true;
      if (a.target === "single-ally") return activeParty().some((p) => p.alive && p.hp < computeStats(p).maxHp * 0.8);
      if (a.target === "all-ally") return activeParty().filter((p) => p.alive).some((p) => p.hp < computeStats(p).maxHp * 0.7);
      return true;
    });
    if (usable.length === 0) return BASIC_ATTACK;
    usable.sort((a, b) => b.reqLevel - a.reqLevel);
    return usable[0];
  }

  function pickEnemyTarget() {
    const alive = battle.enemies.filter((e) => e.alive);
    if (alive.length === 0) return null;
    return alive.reduce((lowest, e) => (e.hp < lowest.hp ? e : lowest), alive[0]);
  }

  function pickAllyTarget() {
    const alive = activeParty().filter((p) => p.alive);
    if (alive.length === 0) return null;
    return alive.reduce((lowest, p) => {
      const lr = lowest.hp / computeStats(lowest).maxHp;
      const pr = p.hp / computeStats(p).maxHp;
      return pr < lr ? p : lowest;
    }, alive[0]);
  }

  function performCharacterAction(c) {
    const ability = chooseAction(c);
    c.mp = Math.max(0, c.mp - ability.mpCost);
    const stats = computeStats(c);
    let targets = [];
    if (ability.target === "single") { const t = pickEnemyTarget(); if (t) targets = [t]; }
    else if (ability.target === "single-ally") { const t = pickAllyTarget(); if (t) targets = [t]; }
    else if (ability.target === "all-enemy") targets = battle.enemies.filter((e) => e.alive);
    else if (ability.target === "all-ally") targets = activeParty().filter((p) => p.alive);

    const lifesteal = racePassive(c, "lifesteal");
    for (const t of targets) {
      for (let h = 0; h < ability.hits; h++) {
        if (ability.kind === "heal") {
          const s = computeStats(t);
          const amount = Math.max(1, Math.round(stats.mag * ability.power * rand(0.9, 1.1)));
          t.hp = Math.min(s.maxHp, t.hp + amount);
          logMsg(`${c.name} の${ability.name}！ ${t.name}のHPが${amount}かいふく！`, "heal");
        } else {
          const isMagic = ability.kind === "magic";
          const atkStat = isMagic ? stats.mag : stats.atk;
          const mitig = isMagic ? 0.15 : 0.3;
          let dmg = Math.max(1, Math.round(atkStat * ability.power - t.def * mitig));
          dmg = Math.round(dmg * rand(0.9, 1.15));
          const critChance = isMagic ? 0 : 0.1 + racePassive(c, "critBonus");
          if (!isMagic && Math.random() < critChance) { dmg = Math.round(dmg * 1.5); logMsg("かいしんの一撃！", "hit"); }
          t.hp -= dmg;
          let line = `${c.name} の${ability.name}！ ${t.name}に${dmg}のダメージ！`;
          if (lifesteal > 0) {
            const heal = Math.max(1, Math.round(dmg * lifesteal));
            const cs = computeStats(c);
            c.hp = Math.min(cs.maxHp, c.hp + heal);
            line += `（${heal}吸収）`;
          }
          logMsg(line, "hit");
          checkEnemyDeath(t);
        }
      }
    }
    c.actedFlash = 0.35;
    c.atb = 0;
  }

  function checkEnemyDeath(e) {
    if (battle.enemies.includes(e) && e.alive && e.hp <= 0) {
      e.alive = false;
      e.hp = 0;
      logMsg(`${e.name} をたおした！`, "system");
    }
  }
  function checkPartyDown(p) {
    if (roster.includes(p) && p.hp <= 0 && p.alive) {
      p.alive = false;
      p.hp = 0;
      logMsg(`${p.name} はたおれた！`, "hit");
    }
  }

  function performEnemyAction(e) {
    const alive = activeParty().filter((p) => p.alive);
    if (alive.length === 0) return;
    const target = alive[Math.floor(Math.random() * alive.length)];
    const stats = computeStats(target);
    let dmg = Math.max(1, Math.round(e.atk - stats.def * 0.4));
    dmg = Math.round(dmg * rand(0.9, 1.15));
    const dmgMult = racePassive(target, "dmgTakenMult") || 1;
    dmg = Math.max(1, Math.round(dmg * dmgMult));
    target.hp -= dmg;
    logMsg(`${e.name} のこうげき！ ${target.name}に${dmg}のダメージ！`, "hit");
    checkPartyDown(target);
    e.atb = 0;
  }

  function checkBattleEnd() {
    if (!battle.active) return false;
    if (battle.enemies.every((e) => !e.alive)) { battle.active = false; onVictory(); return true; }
    if (activeParty().every((p) => !p.alive)) { battle.active = false; onDefeat(); return true; }
    return false;
  }

  // ---------- Main ATB loop ----------
  let lastT = 0;
  function loop(t) {
    const dtRaw = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    if (battle && battle.active) tick(dtRaw * speedMult);
    requestAnimationFrame(loop);
  }

  function tick(dt) {
    for (const c of activeParty()) {
      if (c.actedFlash > 0) c.actedFlash -= dt;
      if (!c.alive) continue;
      c.atb = Math.min(100, c.atb + computeStats(c).spd * ATB_RATE * dt);
      if (c.atb >= 100) {
        performCharacterAction(c);
        if (checkBattleEnd()) { updateBattleDOM(); return; }
      }
    }
    for (const e of battle.enemies) {
      if (!e.alive) continue;
      e.atb = Math.min(100, e.atb + e.spd * ATB_RATE * dt);
      if (e.atb >= 100) {
        performEnemyAction(e);
        if (checkBattleEnd()) { updateBattleDOM(); return; }
      }
    }
    updateBattleDOM();
  }

  requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });

  // ---------- Taming（ダンジョンクリア時に判定） ----------
  function attemptTame() {
    const candidates = run.defeatedTamable;
    if (candidates.length === 0) return null;
    const key = candidates[Math.floor(Math.random() * candidates.length)];
    const tpl = getEnemyTemplate(key);
    const success = Math.random() < tpl.tameChance;
    if (!success) return { success: false, name: tpl.name };
    const lvl = Math.max(1, currentMaxLevel() - 2);
    const mon = newCharacter(tpl.name, "warrior", key, { level: lvl, active: false, isMonster: true });
    roster.push(mon);
    return { success: true, name: tpl.name, char: mon };
  }

  // ---------- Victory / rewards ----------
  function onVictory() {
    const expGain = battle.enemies.reduce((s, e) => s + e.exp, 0);
    run.expTotal += expGain;

    for (const e of battle.enemies) {
      const tpl = getEnemyTemplate(e.key);
      if (tpl && tpl.tamable) run.defeatedTamable.push(e.key);
    }

    for (const c of activeParty()) {
      if (!c.alive) continue;
      const race = RACES[c.race];
      c.exp += Math.round(expGain * race.expMult);
      while (c.exp >= c.expToNext) {
        c.exp -= c.expToNext;
        c.level += 1;
        c.expToNext = 30 + c.level * 15;
        const s = computeStats(c);
        c.hp = s.maxHp; c.mp = s.maxMp;
        run.levelUps.push(c.name + " Lv." + c.level);
        for (const a of JOBS[c.job].abilities) {
          if (a.reqLevel === c.level) run.abilityUnlocks.push(`${c.name}が「${a.name}」を習得！`);
        }
      }
    }

    run.drops.push(rollItemDrop());
    if (Math.random() < 0.4) run.drops.push(rollItemDrop());

    const isLast = run.battleIndex + 1 >= run.dungeon.battles;
    if (!isLast) {
      run.battleIndex += 1;
      renderResultScreen({ cleared: false, battleExp: expGain });
    } else {
      const firstClear = !clearedDungeons.has(run.dungeon.id);
      clearedDungeons.add(run.dungeon.id);
      setBestStage(clearedDungeons.size);
      const unlocked = firstClear
        ? run.dungeon.unlocks.map((id) => getDungeon(id)).filter(Boolean)
        : [];
      renderResultScreen({ cleared: true, tameResult: attemptTame(), unlocked });
    }
    showScreen("screen-result");
  }

  function onDefeat() {
    document.getElementById("gameoverText").textContent =
      `${run.dungeon.name} の ${run.battleIndex + 1}戦目 で全滅してしまった…（クリア済みダンジョン: ${clearedDungeons.size}）`;
    showScreen("screen-gameover");
  }

  function renderResultScreen(info) {
    const d = run.dungeon;
    const nextBtn = document.getElementById("btnNextBattle");
    nextBtn.classList.toggle("hidden", !!info.cleared);
    if (!info.cleared) {
      const nextIsBoss = run.battleIndex === d.battles - 1;
      nextBtn.textContent = nextIsBoss ? "ボス戦へ進む" : "つぎの戦闘へ";
    }
    document.getElementById("resultTitle").textContent = info.cleared
      ? `${d.name} クリア！`
      : `${run.battleIndex}/${d.battles} 戦目クリア`;
    const body = document.getElementById("resultBody");
    body.innerHTML = "";

    const summary = document.createElement("div");
    summary.textContent = info.cleared
      ? `ダンジョン合計 EXP +${run.expTotal}`
      : `EXP +${info.battleExp}（ここまで合計 +${run.expTotal}）`;
    body.appendChild(summary);

    if (run.levelUps.length) {
      const lu = document.createElement("div");
      lu.style.color = "#ffd24d";
      lu.textContent = "LEVEL UP! " + run.levelUps.join(" / ");
      body.appendChild(lu);
    }

    if (run.abilityUnlocks.length) {
      const au = document.createElement("div");
      au.style.color = "#4dc3ff";
      au.textContent = run.abilityUnlocks.join(" / ");
      body.appendChild(au);
    }

    // 道中は装備選択を出さず、獲得数だけ見せる
    if (!info.cleared) {
      const hint = document.createElement("div");
      hint.style.color = "var(--sub-text)";
      hint.textContent = `戦利品 ${run.drops.length}個（ダンジョンクリア時にまとめて装備できます）`;
      body.appendChild(hint);
      const hp = document.createElement("div");
      hp.style.color = "var(--sub-text)";
      hp.textContent = "HP/MPは次の戦闘に持ち越されます。";
      body.appendChild(hp);
      return;
    }

    if (info.tameResult) {
      const tm = document.createElement("div");
      if (info.tameResult.success) {
        tm.style.color = "#7dffb0";
        tm.textContent = `${info.tameResult.name} をテイムした！（パーティ編成からなかまに加えられます）`;
      } else {
        tm.style.color = "var(--sub-text)";
        tm.textContent = `${info.tameResult.name} のテイムに失敗した…`;
      }
      body.appendChild(tm);
    }

    if (info.unlocked && info.unlocked.length) {
      const un = document.createElement("div");
      un.style.color = "#7c5cff";
      un.textContent = "新しいダンジョンが解放された: " + info.unlocked.map((x) => x.name).join(" / ");
      body.appendChild(un);
    }

    for (const item of run.drops) {
      const row = document.createElement("div");
      row.className = "drop-row";
      const dot = document.createElement("div");
      dot.className = "drop-dot";
      dot.style.background = item.rarity.color;
      row.appendChild(dot);
      const label = document.createElement("div");
      label.textContent = `${item.name}（${item.stat.toUpperCase()}+${item.value}）`;
      row.appendChild(label);
      const pickRow = document.createElement("div");
      pickRow.className = "equip-pick-row";
      for (const c of activeParty()) {
        const btn = document.createElement("button");
        btn.className = "equip-pick";
        btn.textContent = c.name;
        btn.addEventListener("click", () => {
          c.equip = { name: item.name, stat: item.stat, value: item.value, rarity: item.rarity.key };
          const s = computeStats(c);
          c.hp = Math.min(c.hp, s.maxHp);
          c.mp = Math.min(c.mp, s.maxMp);
          pickRow.querySelectorAll(".equip-pick").forEach((b) => b.classList.remove("done"));
          btn.classList.add("done");
        });
        pickRow.appendChild(btn);
      }
      row.appendChild(pickRow);
      body.appendChild(row);
    }
  }

  document.getElementById("btnNextBattle").addEventListener("click", () => {
    startBattle();
  });
  document.getElementById("btnResultMap").addEventListener("click", () => {
    restoreParty();
    openMap();
  });
  document.getElementById("btnRetryTitle").addEventListener("click", () => {
    restoreParty();
    openMap();
  });

  function restoreParty() {
    for (const c of roster) {
      c.hp = computeStats(c).maxHp;
      c.mp = computeStats(c).maxMp;
      c.alive = true;
    }
  }

  renderTitle();
  showScreen("screen-title");
})();

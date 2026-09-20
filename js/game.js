(() => {
  "use strict";

  const BEST_KEY = "jobquest_best_stage";
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MAX_ACTIVE = 5;

  function getBestStage() { return parseInt(localStorage.getItem(BEST_KEY) || "0", 10); }
  function setBestStage(s) { if (s > getBestStage()) localStorage.setItem(BEST_KEY, String(s)); }

  // ---------- Roster ----------
  let nextCharSeq = 1;
  function newCharacter(name, job, race, opts) {
    opts = opts || {};
    const c = {
      id: "c" + nextCharSeq++, name, job, race: race || "human",
      jobJP: { warrior: 0, mage: 0, priest: 0 },
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
    const list = job.abilities.filter((a) => c.jobJP[c.job] >= a.reqJP);
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
        if (c.jobJP[jobId] >= a.reqJP) list.push(a);
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

  let stage = 1;
  let battle = null;
  let returnToResultAfterJobs = false;
  let speedMult = 1;

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
    if (best > 0) bits.push(`さいこう到達: Stage ${best}`);
    bits.push(`所持なかま: ${roster.length}人`);
    document.getElementById("bestClearText").textContent = bits.join("　/　");
  }

  document.getElementById("btnGoBattle").addEventListener("click", () => {
    stage = 1;
    startBattle(stage);
  });
  document.getElementById("btnGoJobs").addEventListener("click", () => {
    returnToResultAfterJobs = false;
    renderJobsScreen();
    showScreen("screen-jobs");
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
    if (returnToResultAfterJobs) showScreen("screen-result");
    else { renderTitle(); showScreen("screen-title"); }
  });
  document.getElementById("btnResultJobs").addEventListener("click", () => {
    returnToResultAfterJobs = true;
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
  const BASIC_ATTACK = { id: "attack", name: "たたかう", reqJP: 0, mpCost: 0, kind: "physical", target: "single", power: 1.0, hits: 1 };

  let enemyEls = {}, partyEls = {};

  function startBattle(st) {
    const enemies = buildEncounter(st);
    battle = {
      stage: st,
      enemies: enemies.map((e, i) => ({ ...e, id: "e" + i, alive: true })),
      log: [],
      active: true,
    };
    for (const c of activeParty()) { c.atb = rand(0, 25); c.defending = false; c.actedFlash = 0; }
    buildBattleDOM();
    document.getElementById("stageLabel").textContent = `Stage ${st}`;
    logMsg(`Stage ${st} — 敵が現れた！`, "system");
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
    usable.sort((a, b) => b.reqJP - a.reqJP);
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

  // ---------- Taming ----------
  function attemptTame() {
    const candidates = battle.enemies.filter((e) => !e.alive && getEnemyTemplate(e.key) && getEnemyTemplate(e.key).tamable);
    if (candidates.length === 0) return null;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const tpl = getEnemyTemplate(target.key);
    const success = Math.random() < tpl.tameChance;
    if (!success) return { success: false, name: target.name };
    const lvl = Math.max(1, currentMaxLevel() - 2);
    const mon = newCharacter(target.name, "warrior", target.key, { level: lvl, active: false, isMonster: true });
    roster.push(mon);
    return { success: true, name: target.name, char: mon };
  }

  // ---------- Victory / rewards ----------
  function onVictory() {
    setBestStage(stage);
    const expGain = battle.enemies.reduce((s, e) => s + e.exp, 0);
    const jpGain = battle.enemies.reduce((s, e) => s + e.jp, 0);
    const levelUps = [];
    for (const c of activeParty()) {
      if (!c.alive) continue;
      const race = RACES[c.race];
      c.exp += Math.round(expGain * race.expMult);
      c.jobJP[c.job] += jpGain;
      while (c.exp >= c.expToNext) {
        c.exp -= c.expToNext;
        c.level += 1;
        c.expToNext = 30 + c.level * 15;
        const s = computeStats(c);
        c.hp = s.maxHp; c.mp = s.maxMp;
        levelUps.push(c.name + " Lv." + c.level);
      }
    }
    const drops = [];
    drops.push(rollItemDrop());
    if (Math.random() < 0.4) drops.push(rollItemDrop());

    const tameResult = attemptTame();

    renderResultScreen({ victory: true, expGain, jpGain, levelUps, drops, tameResult });
    showScreen("screen-result");
  }

  function onDefeat() {
    document.getElementById("gameoverText").textContent =
      `Stage ${stage} で全滅してしまった…（さいこう到達: Stage ${getBestStage()}）`;
    showScreen("screen-gameover");
  }

  function renderResultScreen(info) {
    document.getElementById("resultTitle").textContent = `Stage ${stage} クリア！`;
    const body = document.getElementById("resultBody");
    body.innerHTML = "";

    const summary = document.createElement("div");
    summary.textContent = `EXP +${info.expGain}　JP +${info.jpGain}`;
    body.appendChild(summary);

    if (info.levelUps.length) {
      const lu = document.createElement("div");
      lu.style.color = "#ffd24d";
      lu.textContent = "LEVEL UP! " + info.levelUps.join(" / ");
      body.appendChild(lu);
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

    for (const item of info.drops) {
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
    stage += 1;
    startBattle(stage);
  });
  document.getElementById("btnResultTitle").addEventListener("click", () => {
    renderTitle();
    showScreen("screen-title");
  });
  document.getElementById("btnRetryTitle").addEventListener("click", () => {
    stage = 1;
    for (const c of roster) {
      c.hp = computeStats(c).maxHp;
      c.mp = computeStats(c).maxMp;
      c.alive = true;
    }
    renderTitle();
    showScreen("screen-title");
  });

  renderTitle();
  showScreen("screen-title");
})();

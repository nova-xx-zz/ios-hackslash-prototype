(() => {
  "use strict";

  const BEST_KEY = "jobquest_best_stage";
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function getBestStage() { return parseInt(localStorage.getItem(BEST_KEY) || "0", 10); }
  function setBestStage(s) { if (s > getBestStage()) localStorage.setItem(BEST_KEY, String(s)); }

  // ---------- Party ----------
  function newCharacter(id, name, job) {
    const c = {
      id, name, job,
      jobJP: { warrior: 0, mage: 0, priest: 0 },
      subAbilityId: null,
      level: 1, exp: 0, expToNext: 30,
      equip: null,
      atb: 0, defending: false, alive: true,
    };
    const s = computeStats(c);
    c.hp = s.maxHp; c.mp = s.maxMp;
    return c;
  }

  function computeStats(c) {
    const job = JOBS[c.job];
    const growth = 1 + 0.12 * (c.level - 1);
    const s = {
      maxHp: Math.round(job.base.hp * growth),
      maxMp: Math.round(job.base.mp * growth),
      atk: Math.round(job.base.atk * growth),
      mag: Math.round(job.base.mag * growth),
      def: Math.round(job.base.def * growth),
      spd: job.base.spd,
    };
    if (c.equip) s[c.equip.stat] += c.equip.value;
    return s;
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

  let party = [
    newCharacter("c1", "アレン", "warrior"),
    newCharacter("c2", "ミナ", "mage"),
    newCharacter("c3", "ルカ", "priest"),
  ];

  let stage = 1;
  let battle = null;
  let returnToResultAfterJobs = false;

  // ---------- Screen management ----------
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
    document.getElementById(id).classList.remove("hidden");
  }

  // ---------- Title screen ----------
  function renderTitle() {
    const el = document.getElementById("partyPreview");
    el.innerHTML = "";
    for (const c of party) {
      const div = document.createElement("div");
      div.className = "mini-card";
      div.innerHTML = `<div class="name">${c.name}</div><div class="job">${JOBS[c.job].name} Lv.${c.level}</div>`;
      el.appendChild(div);
    }
    const best = getBestStage();
    document.getElementById("bestClearText").textContent = best > 0 ? `さいこう到達: Stage ${best}` : "";
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

  // ---------- Job change screen ----------
  function renderJobsScreen() {
    const wrap = document.getElementById("jobCharList");
    wrap.innerHTML = "";
    for (const c of party) {
      const card = document.createElement("div");
      card.className = "job-char-card";

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
      subRow.innerHTML = "サブアビリティ（他ジョブで習得済みの技を1つ装備できる）";
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
        const hint = document.createElement("div");
        hint.className = "sub-ability-row";
        hint.textContent = "（まだ他ジョブの技を習得していません）";
        subRow.appendChild(hint);
      }

      const stats = computeStats(c);
      card.innerHTML = `<div class="cname">${c.name} — ${JOBS[c.job].name} Lv.${c.level}
        <span style="float:right;color:var(--sub-text);font-size:11px;">HP${stats.maxHp} MP${stats.maxMp} ATK${stats.atk} MAG${stats.mag} DEF${stats.def} SPD${stats.spd}</span></div>`;
      card.appendChild(jobRow);
      card.appendChild(subRow);
      card.appendChild(subPickRow);
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
      readyQueue: [],
      commandingId: null,
      pendingAction: null,
      paused: false,
      active: true,
    };
    for (const c of party) { c.atb = rand(0, 25); c.defending = false; }
    buildBattleDOM();
    logMsg(`Stage ${st} — 敵が現れた！`, "system");
    showScreen("screen-battle");
    hideCommandPanel();
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
      card.addEventListener("click", () => onEnemyCardClick(e.id));
      enemyRow.appendChild(card);
      enemyEls[e.id] = card;
    }

    for (const c of party) {
      const card = document.createElement("div");
      card.className = "actor-card";
      card.innerHTML = `
        <div class="actor-name"><span>${c.name}</span><span>${JOBS[c.job].name}</span></div>
        <div class="actor-job">Lv.${c.level}</div>
        <div class="stat-bar hp"><div class="fill" style="width:100%"></div></div>
        <div class="stat-num hpnum"></div>
        <div class="stat-bar mp"><div class="fill" style="width:100%"></div></div>
        <div class="stat-num mpnum"></div>
        <div class="stat-bar atb"><div class="fill" style="width:0%"></div></div>`;
      card.addEventListener("click", () => onPartyCardClick(c.id));
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
      const targetable = !!(battle.pendingAction && battle.pendingAction.needsTarget === "enemy" && e.alive);
      el.classList.toggle("targetable", targetable);
      el.querySelector(".mini-bar.hp .fill").style.width = clamp((e.hp / e.maxHp) * 100, 0, 100) + "%";
    }
    for (const c of party) {
      const el = partyEls[c.id];
      if (!el) continue;
      const s = computeStats(c);
      el.classList.toggle("down", !c.alive);
      el.classList.toggle("ready", c.alive && (battle.commandingId === c.id));
      const targetable = !!(battle.pendingAction && battle.pendingAction.needsTarget === "ally" && c.alive);
      el.classList.toggle("targetable", targetable);
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

  // ---------- Command UI ----------
  function showCommandPanel(actorId) {
    battle.commandingId = actorId;
    battle.pendingAction = null;
    const c = party.find((p) => p.id === actorId);
    document.getElementById("commandActorName").textContent = `${c.name} の行動`;
    const main = document.getElementById("commandMain");
    const sub = document.getElementById("commandSub");
    sub.classList.add("hidden");
    sub.innerHTML = "";
    main.classList.remove("hidden");
    main.innerHTML = "";

    main.appendChild(makeCmdBtn("たたかう", "", () => startTargeting(c, BASIC_ATTACK)));
    main.appendChild(makeCmdBtn(JOBS[c.job].commandName, "", () => showAbilityList(c)));
    main.appendChild(makeCmdBtn("ぼうぎょ", "被ダメージ半減", () => resolveDefend(c)));

    document.getElementById("commandPanel").classList.remove("hidden");
    updateBattleDOM();
  }

  function hideCommandPanel() {
    document.getElementById("commandPanel").classList.add("hidden");
  }

  function makeCmdBtn(title, sub, onClick) {
    const btn = document.createElement("button");
    btn.className = "cmd-btn";
    btn.innerHTML = `${title}${sub ? `<span class="sub">${sub}</span>` : ""}`;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function showAbilityList(c) {
    const main = document.getElementById("commandMain");
    const sub = document.getElementById("commandSub");
    main.classList.add("hidden");
    sub.classList.remove("hidden");
    sub.innerHTML = "";
    const abilities = availableAbilities(c);
    for (const a of abilities) {
      const affordable = c.mp >= a.mpCost;
      const btn = makeCmdBtn(a.name, `MP${a.mpCost} / ${a.desc}`, () => {
        if (!affordable) return;
        startTargeting(c, a);
      });
      if (!affordable) btn.style.opacity = "0.4";
      sub.appendChild(btn);
    }
    sub.appendChild(makeCmdBtn("もどる", "", () => showCommandPanel(c.id)));
  }

  function startTargeting(c, ability) {
    const mode = ability.target === "single" ? "enemy"
      : ability.target === "single-ally" ? "ally"
      : ability.target === "all-enemy" ? "auto-enemy"
      : "auto-ally";

    if (mode === "auto-enemy" || mode === "auto-ally") {
      resolveAbility(c, ability, null);
      return;
    }
    battle.pendingAction = { ability, casterId: c.id, needsTarget: mode };
    document.getElementById("commandActorName").textContent = `${c.name}：対象をえらんでください`;
    document.getElementById("commandMain").classList.add("hidden");
    const sub = document.getElementById("commandSub");
    sub.classList.remove("hidden");
    sub.innerHTML = "";
    sub.appendChild(makeCmdBtn("もどる", "", () => showCommandPanel(c.id)));
    updateBattleDOM();
  }

  function onEnemyCardClick(enemyId) {
    if (!battle.pendingAction || battle.pendingAction.needsTarget !== "enemy") return;
    const enemy = battle.enemies.find((e) => e.id === enemyId);
    if (!enemy || !enemy.alive) return;
    const c = party.find((p) => p.id === battle.pendingAction.casterId);
    const ability = battle.pendingAction.ability;
    battle.pendingAction = null;
    resolveAbility(c, ability, enemy);
  }

  function onPartyCardClick(charId) {
    if (!battle.pendingAction || battle.pendingAction.needsTarget !== "ally") return;
    const target = party.find((p) => p.id === charId);
    if (!target || !target.alive) return;
    const c = party.find((p) => p.id === battle.pendingAction.casterId);
    const ability = battle.pendingAction.ability;
    battle.pendingAction = null;
    resolveAbility(c, ability, target);
  }

  function resolveDefend(c) {
    c.defending = true;
    logMsg(`${c.name} は みをまもっている。`, "system");
    endTurn(c);
  }

  function resolveAbility(c, ability, target) {
    c.mp = Math.max(0, c.mp - ability.mpCost);
    const stats = computeStats(c);
    let targets = [];
    if (ability.target === "single" || ability.target === "single-ally") targets = [target];
    else if (ability.target === "all-enemy") targets = battle.enemies.filter((e) => e.alive);
    else if (ability.target === "all-ally") targets = party.filter((p) => p.alive);

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
          if (!isMagic && Math.random() < 0.1) { dmg = Math.round(dmg * 1.5); logMsg("かいしんの一撃！", "hit"); }
          if (t.defending) { dmg = Math.round(dmg * 0.5); t.defending = false; }
          t.hp -= dmg;
          logMsg(`${c.name} の${ability.name}！ ${t.name}に${dmg}のダメージ！`, "hit");
          checkEnemyDeath(t);
          checkPartyDown(t);
        }
      }
    }
    endTurn(c);
  }

  function checkEnemyDeath(e) {
    if (battle.enemies.includes(e) && e.alive && e.hp <= 0) {
      e.alive = false;
      e.hp = 0;
      logMsg(`${e.name} をたおした！`, "system");
    }
  }
  function checkPartyDown(p) {
    if (party.includes(p) && p.hp <= 0 && p.alive) {
      p.alive = false;
      p.hp = 0;
      logMsg(`${p.name} はたおれた！`, "hit");
      battle.readyQueue = battle.readyQueue.filter((id) => id !== p.id);
    }
  }

  function endTurn(c) {
    c.atb = 0;
    battle.commandingId = null;
    battle.pendingAction = null;
    battle.readyQueue = battle.readyQueue.filter((id) => id !== c.id);
    hideCommandPanel();
    battle.paused = false;
    updateBattleDOM();
    checkBattleEnd();
  }

  function performEnemyAction(e) {
    const alive = party.filter((p) => p.alive);
    if (alive.length === 0) return;
    const target = alive[Math.floor(Math.random() * alive.length)];
    const stats = computeStats(target);
    let dmg = Math.max(1, Math.round(e.atk - stats.def * 0.4));
    dmg = Math.round(dmg * rand(0.9, 1.15));
    if (target.defending) { dmg = Math.round(dmg * 0.5); target.defending = false; }
    target.hp -= dmg;
    logMsg(`${e.name} のこうげき！ ${target.name}に${dmg}のダメージ！`, "hit");
    checkPartyDown(target);
    e.atb = 0;
  }

  function checkBattleEnd() {
    if (!battle.active) return;
    if (battle.enemies.every((e) => !e.alive)) {
      battle.active = false;
      onVictory();
    } else if (party.every((p) => !p.alive)) {
      battle.active = false;
      onDefeat();
    }
  }

  // ---------- Main ATB loop ----------
  let lastT = 0;
  function loop(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    if (battle && battle.active && !battle.paused) {
      tick(dt);
    }
    requestAnimationFrame(loop);
  }

  function tick(dt) {
    let needsRender = false;
    for (const c of party) {
      if (!c.alive) continue;
      if (c.atb < 100) {
        c.atb = Math.min(100, c.atb + computeStats(c).spd * ATB_RATE * dt);
        needsRender = true;
      }
      if (c.atb >= 100 && !battle.readyQueue.includes(c.id) && battle.commandingId !== c.id) {
        battle.readyQueue.push(c.id);
      }
    }
    for (const e of battle.enemies) {
      if (!e.alive) continue;
      if (e.atb < 100) {
        e.atb = Math.min(100, e.atb + e.spd * ATB_RATE * dt);
        needsRender = true;
      }
      if (e.atb >= 100) {
        performEnemyAction(e);
        needsRender = true;
        checkBattleEnd();
        if (!battle.active) break;
      }
    }
    if (battle.active && !battle.commandingId && battle.readyQueue.length > 0) {
      const nextId = battle.readyQueue[0];
      const c = party.find((p) => p.id === nextId);
      if (c && c.alive) {
        battle.paused = true;
        showCommandPanel(nextId);
      } else {
        battle.readyQueue.shift();
      }
    }
    if (needsRender) updateBattleDOM();
  }

  requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });

  // ---------- Victory / rewards ----------
  function onVictory() {
    setBestStage(stage);
    const expGain = battle.enemies.reduce((s, e) => s + e.exp, 0);
    const jpGain = battle.enemies.reduce((s, e) => s + e.jp, 0);
    const levelUps = [];
    for (const c of party) {
      if (!c.alive) continue;
      c.exp += expGain;
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

    renderResultScreen({ victory: true, expGain, jpGain, levelUps, drops });
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
      for (const c of party) {
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
    for (const c of party) {
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

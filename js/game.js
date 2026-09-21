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
      equip: { weapon: null, armor: null, accessory: null },
      atb: 0, defending: false, alive: true,
      team: opts.team !== undefined ? opts.team : null, // 0..3 所属チーム / null は控え
      isMonster: opts.isMonster || false,
    };
    c.expToNext = 30 + c.level * 15;
    const s = computeStats(c);
    c.hp = s.maxHp; c.mp = s.maxMp;
    return c;
  }

  // テイムしたモンスターは人間のジョブではなく種族専用ジョブを使う
  function jobDef(c) {
    return c.isMonster ? MONSTER_JOBS[c.race] : JOBS[c.job];
  }

  function computeStats(c) {
    const job = jobDef(c);
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
    for (const slot of SLOTS) {
      const item = c.equip[slot.key];
      if (item) s[item.stat] += item.value;
    }
    // 石碑の加護はそのダンジョンの間だけ乗る（HP/MPは除く）
    if (run && !run.finished) {
      for (const stat of ["atk", "mag", "def", "spd"]) {
        const buff = run.buffs[stat];
        if (buff) s[stat] = Math.round(s[stat] * (1 + buff) * 10) / 10;
      }
    }
    return s;
  }

  // ジョブの基礎値を重みにして、そのキャラにとっての装備の価値を測る
  function itemScore(c, item) {
    const base = jobDef(c).base;
    const weights = {
      hp: base.hp / 30, mp: base.mp / 20,
      atk: base.atk / 10, mag: base.mag / 10,
      def: base.def / 8, spd: base.spd / 7,
    };
    return item.value * (weights[item.stat] || 0.5);
  }

  function racePassive(c, key) {
    const race = RACES[c.race] || RACES.human;
    return race.passive[key] || 0;
  }

  function availableAbilities(c) {
    const job = jobDef(c);
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
    if (c.isMonster) return list; // モンスターは人間の技を覚えない
    for (const jobId in JOBS) {
      if (jobId === c.job) continue;
      for (const a of JOBS[jobId].abilities) {
        if (c.level >= a.reqLevel) list.push(a);
      }
    }
    return list;
  }

  const TEAM_NAMES = ["第一のパーティ", "第二のパーティ", "第三のパーティ", "第四のパーティ"];
  const TEAM_LABELS = ["I", "II", "III", "IV"];
  let activeTeam = 0;

  function teamMembers(i) { return roster.filter((c) => c.team === i); }
  function activeParty() { return teamMembers(activeTeam); }
  function currentMaxLevel() { return roster.reduce((m, c) => Math.max(m, c.level), 1); }

  // ---------- Inventory ----------
  let inventory = [];

  function equipItem(c, item) {
    const idx = inventory.indexOf(item);
    if (idx >= 0) inventory.splice(idx, 1);
    const old = c.equip[item.slot];
    if (old) inventory.push(old);
    c.equip[item.slot] = item;
    clampVitals(c);
  }

  function unequipSlot(c, slotKey) {
    const item = c.equip[slotKey];
    if (!item) return;
    inventory.push(item);
    c.equip[slotKey] = null;
    clampVitals(c);
  }

  function autoEquip(c) {
    for (const slot of SLOTS) {
      const candidates = inventory.filter((i) => i.slot === slot.key);
      const current = c.equip[slot.key];
      if (candidates.length === 0) continue;
      const best = candidates.reduce((a, b) => (itemScore(c, b) > itemScore(c, a) ? b : a));
      if (!current || itemScore(c, best) > itemScore(c, current)) equipItem(c, best);
    }
  }

  function clampVitals(c) {
    const s = computeStats(c);
    c.hp = Math.min(c.hp, s.maxHp);
    c.mp = Math.min(c.mp, s.maxMp);
  }

  // computeStats が run.buffs を参照するため、roster を組み立てる前に宣言しておく
  let battle = null;
  let run = null; // 進行中のダンジョン { dungeon, battleIndex, buffs, expTotal, drops }
  let clearedDungeons = new Set();
  let selectedDungeonId = null;
  let jobsReturnScreen = "screen-title";
  let speedMult = 1;

  let roster = [
    newCharacter("アレン", "warrior", "human", { team: 0 }),
    newCharacter("ガイ", "warrior", "beastkin", { team: 0 }),
    newCharacter("ミナ", "mage", "sylvan", { team: 0 }),
    newCharacter("ノア", "mage", "nocturne", { team: 0 }),
    newCharacter("ルカ", "priest", "stonekin", { team: 0 }),
  ];

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
      div.innerHTML = `<div class="name">${c.name}</div><div class="job">${RACES[c.race].name}・${jobDef(c).name} Lv.${c.level}</div>`;
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
    const party = activeParty();
    const warn = avg < d.level
      ? `<span class="level-warn">（${TEAM_NAMES[activeTeam]}の平均Lv.${avg} — 推奨に届いていません）</span>`
      : `（${TEAM_NAMES[activeTeam]}の平均Lv.${avg}）`;
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
    if (party.length === 0) {
      btn.textContent = `${TEAM_NAMES[activeTeam]}が空です（編成してください）`;
      btn.disabled = true;
    } else {
      btn.textContent = `${TEAM_NAMES[activeTeam]}で出発する`;
      btn.addEventListener("click", () => startDungeon(d.id));
    }
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
    hint.textContent = TEAM_LABELS
      .map((l, i) => `${l}: ${teamMembers(i).length}/${MAX_ACTIVE}人`)
      .join("　") + "（1チーム最大5人。探索に出るのは選択中のチームのみ）";
    wrap.appendChild(hint);

    for (const c of roster) {
      const card = document.createElement("div");
      card.className = "job-char-card";

      const activeRow = document.createElement("div");
      activeRow.className = "job-pick-row";
      const benchBtn = document.createElement("button");
      benchBtn.className = "job-pick" + (c.team === null ? " active" : "");
      benchBtn.textContent = "控え";
      benchBtn.addEventListener("click", () => { c.team = null; renderJobsScreen(); });
      activeRow.appendChild(benchBtn);
      for (let i = 0; i < TEAM_LABELS.length; i++) {
        const btn = document.createElement("button");
        const atCap = c.team !== i && teamMembers(i).length >= MAX_ACTIVE;
        btn.className = "job-pick" + (c.team === i ? " active" : "") + (atCap ? " disabled" : "");
        btn.textContent = TEAM_LABELS[i];
        btn.addEventListener("click", () => {
          if (atCap) return;
          c.team = i;
          const s = computeStats(c);
          c.hp = Math.min(c.hp, s.maxHp);
          c.mp = Math.min(c.mp, s.maxMp);
          renderJobsScreen();
        });
        activeRow.appendChild(btn);
      }

      const jobRow = document.createElement("div");
      jobRow.className = "job-pick-row";
      if (c.isMonster) {
        const note = document.createElement("div");
        note.className = "sub-ability-row";
        note.textContent = "モンスターは転職できず、種族専用の技を使う";
        jobRow.appendChild(note);
      } else {
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
            clampVitals(c);
            renderJobsScreen();
          });
          jobRow.appendChild(btn);
        }
      }

      const subRow = document.createElement("div");
      subRow.className = "sub-ability-row";
      const candidates = subAbilityCandidates(c);
      const subPickRow = document.createElement("div");
      subPickRow.className = "sub-pick-row";
      if (!c.isMonster) {
        subRow.textContent = "サブアビリティ（他ジョブで習得済みの技を1つ装備できる）";

        const noneBtn = document.createElement("button");
        noneBtn.className = "sub-pick" + (!c.subAbilityId ? " active" : "");
        noneBtn.textContent = "なし";
        noneBtn.addEventListener("click", () => { c.subAbilityId = null; renderJobsScreen(); });
        subPickRow.appendChild(noneBtn);
      }

      for (const a of candidates) {
        const btn = document.createElement("button");
        btn.className = "sub-pick" + (c.subAbilityId === a.id ? " active" : "");
        btn.textContent = a.name;
        btn.addEventListener("click", () => { c.subAbilityId = a.id; renderJobsScreen(); });
        subPickRow.appendChild(btn);
      }
      if (!c.isMonster && candidates.length === 0) {
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
      const locked = jobDef(c).abilities.filter((a) => c.level < a.reqLevel);
      for (const a of locked) {
        const span = document.createElement("span");
        span.className = "skill-toggle";
        span.style.opacity = "0.35";
        span.textContent = `${a.name}（Lv.${a.reqLevel}で習得）`;
        skillToggleRow.appendChild(span);
      }

      const race = RACES[c.race];
      const stats = computeStats(c);
      card.innerHTML = `<div class="cname">${c.name}${c.isMonster ? "（テイム）" : ""} — ${race.name}・${jobDef(c).name} Lv.${c.level}
        <span style="float:right;color:var(--sub-text);font-size:11px;">HP${stats.maxHp} MP${stats.maxMp} ATK${stats.atk} MAG${stats.mag} DEF${stats.def} SPD${Math.round(stats.spd)}</span></div>
        <div class="sub-ability-row">${race.desc}</div>`;
      card.appendChild(activeRow);
      card.appendChild(jobRow);
      card.appendChild(buildEquipSection(c));
      card.appendChild(subRow);
      card.appendChild(subPickRow);
      card.appendChild(skillRow);
      card.appendChild(skillToggleRow);
      wrap.appendChild(card);
    }
  }

  // 装備セクション（スロットをタップで所持品から選ぶ）
  let openSlot = null; // "charId:slotKey"

  function buildEquipSection(c) {
    const wrap = document.createElement("div");

    const head = document.createElement("div");
    head.className = "sub-ability-row";
    head.textContent = `装備（所持品 ${inventory.length}個）`;
    wrap.appendChild(head);

    const row = document.createElement("div");
    row.className = "equip-slot-row";
    for (const slot of SLOTS) {
      const item = c.equip[slot.key];
      const key = `${c.id}:${slot.key}`;
      const btn = document.createElement("button");
      btn.className = "equip-slot" + (item ? " filled" : "") + (openSlot === key ? " open" : "");
      if (item) btn.style.borderColor = item.rarityColor;
      btn.innerHTML = `<span class="slot-name">${slot.name}</span>
        <span class="slot-item">${item ? itemLabel(item) : "なし"}</span>`;
      btn.addEventListener("click", () => {
        openSlot = openSlot === key ? null : key;
        renderJobsScreen();
      });
      row.appendChild(btn);
    }
    wrap.appendChild(row);

    const autoBtn = document.createElement("button");
    autoBtn.className = "sub-pick";
    autoBtn.style.marginTop = "6px";
    autoBtn.textContent = "おまかせ装備";
    autoBtn.addEventListener("click", () => { autoEquip(c); renderJobsScreen(); });
    wrap.appendChild(autoBtn);

    // 開いているスロットの候補一覧
    const opened = SLOTS.find((s) => openSlot === `${c.id}:${s.key}`);
    if (opened) {
      const list = document.createElement("div");
      list.className = "equip-choice-list";
      const candidates = inventory
        .filter((i) => i.slot === opened.key)
        .sort((a, b) => itemScore(c, b) - itemScore(c, a));

      if (c.equip[opened.key]) {
        const off = document.createElement("button");
        off.className = "equip-choice";
        off.textContent = "はずす";
        off.addEventListener("click", () => { unequipSlot(c, opened.key); renderJobsScreen(); });
        list.appendChild(off);
      }
      if (candidates.length === 0) {
        const none = document.createElement("div");
        none.className = "sub-ability-row";
        none.textContent = `（${opened.name}の手持ちがありません）`;
        list.appendChild(none);
      }
      for (const item of candidates) {
        const btn = document.createElement("button");
        btn.className = "equip-choice";
        btn.style.borderColor = item.rarityColor;
        btn.textContent = itemLabel(item);
        btn.addEventListener("click", () => { equipItem(c, item); openSlot = null; renderJobsScreen(); });
        list.appendChild(btn);
      }
      wrap.appendChild(list);
    }

    return wrap;
  }

  document.getElementById("btnJobsDone").addEventListener("click", () => {
    if (jobsReturnScreen === "screen-battle") {
      buildPartyDock();
      renderDock();
      showScreen("screen-battle");
    } else if (jobsReturnScreen === "screen-map") {
      openMap();
    } else {
      renderTitle();
      showScreen("screen-title");
    }
  });
  document.getElementById("btnMapJobs").addEventListener("click", () => {
    jobsReturnScreen = "screen-map";
    renderJobsScreen();
    showScreen("screen-jobs");
  });
  document.getElementById("btnRecruit").addEventListener("click", () => {
    const r = rollNewRecruit();
    const lvl = Math.max(1, currentMaxLevel() - 1);
    const c = newCharacter(r.name, r.job, r.race, { level: lvl });
    roster.push(c);
    renderJobsScreen();
  });

  // ---------- Battle ----------
  const ATB_RATE = 7;
  const BASIC_ATTACK = { id: "attack", name: "たたかう", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.0, hits: 1 };

  let partyEls = {};
  let currentCard = null;
  let nextBattleTimer = null;

  function startDungeon(id) {
    clearTimeout(nextBattleTimer);
    const d = getDungeon(id);
    run = {
      dungeon: d, battleIndex: 0, finished: false,
      buffs: { atk: 0, mag: 0, def: 0, spd: 0 },
      expTotal: 0, drops: [], levelUps: [], abilityUnlocks: [], defeatedTamable: [],
    };
    for (const c of activeParty()) {
      const s = computeStats(c);
      c.hp = s.maxHp; c.mp = s.maxMp; c.alive = true;
    }
    clearLog();
    logEvent("start", `${d.name} に出発した`, `全${d.battles}戦　推奨レベル ${d.level}`);
    buildPartyDock();
    renderDock();
    showScreen("screen-battle");
    startBattle();
  }

  function startBattle() {
    const d = run.dungeon;
    const isBoss = run.battleIndex === d.battles - 1;
    const enemies = buildEncounter(d, run.battleIndex);
    battle = {
      enemies: enemies.map((e, i) => ({ ...e, id: "e" + i, alive: true })),
      active: true,
    };
    for (const c of activeParty()) { c.atb = rand(0, 25); c.defending = false; c.actedFlash = 0; }

    logEvent("encounter", isBoss ? "ボスが立ちはだかる！" : "敵が現れた！", enemyRoster());
    renderDock();
  }

  // 敵の残り状況をテキストで表示（敵パネルの代わり）
  function enemyRoster() {
    const counts = {};
    for (const e of battle.enemies) {
      const k = e.name;
      if (!counts[k]) counts[k] = { total: 0, alive: 0 };
      counts[k].total += 1;
      if (e.alive) counts[k].alive += 1;
    }
    return Object.keys(counts)
      .map((k) => {
        const c = counts[k];
        return c.alive === 0 ? `${k} ×${c.total}（全滅）` : `${k} ×${c.alive}`;
      })
      .join("　");
  }

  // ---------- Log ----------
  function clearLog() {
    document.getElementById("logFeed").innerHTML = "";
    currentCard = null;
  }

  function logEvent(type, title, subtitle) {
    const feed = document.getElementById("logFeed");
    const card = document.createElement("div");
    card.className = "log-card " + type;
    const t = document.createElement("div");
    t.className = "lc-title";
    t.textContent = title;
    card.appendChild(t);
    const sub = document.createElement("div");
    sub.className = "lc-sub";
    sub.textContent = subtitle || "";
    if (!subtitle) sub.style.display = "none";
    card.appendChild(sub);
    const lines = document.createElement("div");
    lines.className = "lc-lines";
    card.appendChild(lines);
    feed.appendChild(card);
    currentCard = { card, sub, lines };
    scrollLog();
    return currentCard;
  }

  function logLine(text, cls) {
    if (!currentCard) logEvent("encounter", "戦闘", "");
    const div = document.createElement("div");
    div.className = "lc-line " + (cls || "");
    div.textContent = text;
    currentCard.lines.appendChild(div);
    scrollLog();
  }

  function updateCardSubtitle(text) {
    if (!currentCard) return;
    currentCard.sub.textContent = text;
    currentCard.sub.style.display = text ? "" : "none";
  }

  function scrollLog() {
    const feed = document.getElementById("logFeed");
    feed.scrollTop = feed.scrollHeight;
  }

  // ---------- Dock ----------
  function buildPartyDock() {
    const partyRow = document.getElementById("partyRow");
    partyRow.innerHTML = "";
    partyEls = {};
    for (const c of activeParty()) {
      const card = document.createElement("div");
      card.className = "actor-card";
      card.innerHTML = `
        <div class="actor-name">${c.name}</div>
        <div class="actor-job">${jobDef(c).name} Lv.${c.level}</div>
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

  function renderDock() {
    document.getElementById("teamName").textContent = TEAM_NAMES[activeTeam];
    const running = !!(run && !run.finished);
    const d = run ? run.dungeon : null;

    const buffText = run
      ? Object.keys(run.buffs)
          .filter((k) => run.buffs[k] > 0)
          .map((k) => `${STAT_LABELS[k]}+${Math.round(run.buffs[k] * 100)}%`)
          .join(" ")
      : "";
    document.getElementById("exploreSub").textContent = d
      ? `${d.name}　${Math.min(run.battleIndex + 1, d.battles)}/${d.battles}戦目${buffText ? "　加護: " + buffText : ""}`
      : "ダンジョン未選択";
    document.getElementById("dockDungeon").textContent = d ? d.name : "—";
    document.getElementById("dockStatus").textContent = !d
      ? ""
      : running ? "探索中…" : (run.wiped ? "失敗" : "踏破");
    const pct = d ? (Math.min(run.battleIndex + (running ? 0 : 1), d.battles) / d.battles) * 100 : 0;
    document.getElementById("dockProgressFill").style.width = clamp(pct, 0, 100) + "%";

    document.getElementById("btnRedeploy").disabled = running || !d;
    document.getElementById("btnDockMap").disabled = running;
    document.getElementById("btnDockJobs").disabled = running;

    const tabs = document.getElementById("teamTabs");
    tabs.innerHTML = "";
    TEAM_LABELS.forEach((label, i) => {
      const btn = document.createElement("button");
      btn.className = "team-tab" + (i === activeTeam ? " active" : "");
      btn.innerHTML = `${label}<span class="count">${teamMembers(i).length}人</span>`;
      btn.disabled = running;
      btn.addEventListener("click", () => {
        if (running) return;
        activeTeam = i;
        buildPartyDock();
        renderDock();
      });
      tabs.appendChild(btn);
    });
  }

  function updateBattleDOM() {
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

  document.getElementById("btnSpeedToggle").addEventListener("click", () => {
    speedMult = speedMult === 1 ? 2 : 1;
    document.getElementById("btnSpeedToggle").textContent = `x${speedMult}`;
  });
  document.getElementById("btnRedeploy").addEventListener("click", () => {
    if (run) startDungeon(run.dungeon.id);
  });
  document.getElementById("btnDockMap").addEventListener("click", () => {
    restoreParty();
    openMap();
  });
  document.getElementById("btnDockJobs").addEventListener("click", () => {
    jobsReturnScreen = "screen-battle";
    renderJobsScreen();
    showScreen("screen-jobs");
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

    const lifesteal = racePassive(c, "lifesteal") + (ability.lifesteal || 0);
    for (const t of targets) {
      for (let h = 0; h < ability.hits; h++) {
        if (ability.kind === "heal") {
          const s = computeStats(t);
          const amount = Math.max(1, Math.round(stats.mag * ability.power * rand(0.9, 1.1)));
          t.hp = Math.min(s.maxHp, t.hp + amount);
          logLine(`${c.name} の${ability.name}！ ${t.name}のHPが${amount}かいふく！`, "heal");
        } else {
          const isMagic = ability.kind === "magic";
          const atkStat = isMagic ? stats.mag : stats.atk;
          const mitig = isMagic ? 0.15 : 0.3;
          let dmg = Math.max(1, Math.round(atkStat * ability.power - t.def * mitig));
          dmg = Math.round(dmg * rand(0.9, 1.15));
          const critChance = isMagic ? 0 : 0.1 + racePassive(c, "critBonus");
          if (!isMagic && Math.random() < critChance) { dmg = Math.round(dmg * 1.5); logLine("かいしんの一撃！", ""); }
          t.hp -= dmg;
          let line = `${c.name} の${ability.name}！ ${t.name}に${dmg}のダメージ！`;
          if (lifesteal > 0) {
            const heal = Math.max(1, Math.round(dmg * lifesteal));
            const cs = computeStats(c);
            c.hp = Math.min(cs.maxHp, c.hp + heal);
            line += `（${heal}吸収）`;
          }
          logLine(line, "hit");
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
      logLine(`${e.name} をたおした！`, "system");
      updateCardSubtitle(enemyRoster());
    }
  }
  function checkPartyDown(p) {
    if (roster.includes(p) && p.hp <= 0 && p.alive) {
      p.alive = false;
      p.hp = 0;
      logLine(`${p.name} はたおれた！`, "down");
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
    logLine(`${e.name} のこうげき！ ${target.name}に${dmg}のダメージ！`, "hit");
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
    const mon = newCharacter(tpl.name, null, key, { level: lvl, isMonster: true });
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
        for (const a of jobDef(c).abilities) {
          if (a.reqLevel === c.level) run.abilityUnlocks.push(`${c.name}が「${a.name}」を習得！`);
        }
      }
    }

    gainItem(rollItemDrop());
    if (Math.random() < 0.4) gainItem(rollItemDrop());

    logLine(`EXP +${expGain}`, "system");

    const isLast = run.battleIndex + 1 >= run.dungeon.battles;
    if (!isLast) {
      run.battleIndex += 1;
      scheduleNext(() => {
        if (Math.random() < 0.6) rollDungeonEvent();
        scheduleNext(startBattle, 700);
      }, 900);
    } else {
      const firstClear = !clearedDungeons.has(run.dungeon.id);
      clearedDungeons.add(run.dungeon.id);
      setBestStage(clearedDungeons.size);
      const unlocked = firstClear
        ? run.dungeon.unlocks.map((id) => getDungeon(id)).filter(Boolean)
        : [];
      scheduleNext(() => finishRun({ cleared: true, tameResult: attemptTame(), unlocked }), 700);
    }
  }

  function onDefeat() {
    scheduleNext(() => finishRun({ cleared: false }), 700);
  }

  function scheduleNext(fn, delayMs) {
    clearTimeout(nextBattleTimer);
    nextBattleTimer = setTimeout(fn, delayMs / speedMult);
  }

  // ---------- 道中イベント ----------
  const EVENT_WEIGHTS = [
    { fn: () => rollTreasureEvent(), weight: 40 },
    { fn: () => rollTrapEvent(), weight: 25 },
    { fn: () => rollSpringEvent(), weight: 20 },
    { fn: () => rollShrineEvent(), weight: 15 },
  ];

  function rollDungeonEvent() {
    const total = EVENT_WEIGHTS.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * total;
    for (const e of EVENT_WEIGHTS) {
      if (roll < e.weight) { e.fn(); return; }
      roll -= e.weight;
    }
  }

  function rollTreasureEvent() {
    if (Math.random() < 0.35) {
      logEvent("treasure", "宝箱を見つけた！", "しかし、宝箱の中身は空っぽだった・・・");
      return;
    }
    const item = rollItemDrop();
    gainItem(item);
    logEvent("treasure", "宝箱を見つけた！", `${itemLabel(item)} を手に入れた`);
  }

  function rollTrapEvent() {
    const alive = activeParty().filter((p) => p.alive);
    if (alive.length === 0) return;
    const wide = Math.random() < 0.45;
    const targets = wide ? alive : [alive[Math.floor(Math.random() * alive.length)]];
    const ratio = wide ? 0.1 : 0.18;

    logEvent("trap", wide ? "毒ガスが噴き出した！" : "落とし穴に落ちた！", "");
    for (const c of targets) {
      const s = computeStats(c);
      const dmg = Math.max(1, Math.round(s.maxHp * ratio * rand(0.85, 1.15)));
      c.hp = Math.max(1, c.hp - dmg); // 罠では戦闘不能にならない
      logLine(`${c.name} は ${dmg} のダメージを受けた`, "down");
    }
    updateBattleDOM();
  }

  function rollSpringEvent() {
    const alive = activeParty().filter((p) => p.alive);
    if (alive.length === 0) return;
    logEvent("blessing", "清らかな泉を見つけた！", "パーティは水を飲んで休息した");
    for (const c of alive) {
      const s = computeStats(c);
      const hp = Math.round(s.maxHp * 0.3);
      const mp = Math.round(s.maxMp * 0.25);
      c.hp = Math.min(s.maxHp, c.hp + hp);
      c.mp = Math.min(s.maxMp, c.mp + mp);
      logLine(`${c.name} のHPが${hp}、MPが${mp}かいふく`, "heal");
    }
    updateBattleDOM();
  }

  function rollShrineEvent() {
    const stat = ["atk", "def", "spd"][Math.floor(Math.random() * 3)];
    run.buffs[stat] = (run.buffs[stat] || 0) + 0.12;
    logEvent("blessing", "古びた石碑を見つけた！", `祈りを捧げると ${STAT_LABELS[stat]} が上がった（このダンジョン中のみ）`);
    logLine(`${STAT_LABELS[stat]} +${Math.round(run.buffs[stat] * 100)}%`, "system");
    renderDock();
    updateBattleDOM();
  }

  function gainItem(item) {
    run.drops.push(item);
    inventory.push(item);
  }

  function finishRun(info) {
    run.finished = true;
    run.wiped = !info.cleared;

    const card = info.cleared
      ? logEvent("clear", `${run.dungeon.name} を踏破した！`, `合計 EXP +${run.expTotal}`)
      : logEvent("wipe", "パーティは全滅した・・・", `${run.dungeon.name} の ${run.battleIndex + 1}戦目で力尽きた`);

    currentCard = card;
    if (run.levelUps.length) logLine("LEVEL UP! " + run.levelUps.join(" / "), "system");
    if (run.abilityUnlocks.length) logLine(run.abilityUnlocks.join(" / "), "heal");

    if (info.tameResult) {
      logLine(
        info.tameResult.success
          ? `${info.tameResult.name} をテイムした！（編成からなかまに加えられます）`
          : `${info.tameResult.name} のテイムに失敗した…`,
        info.tameResult.success ? "heal" : ""
      );
    }
    if (info.unlocked && info.unlocked.length) {
      logLine("新しいダンジョンが解放された: " + info.unlocked.map((x) => x.name).join(" / "), "system");
    }

    if (run.drops.length) {
      const head = document.createElement("div");
      head.className = "lc-line system";
      head.textContent = `獲得アイテム ${run.drops.length}個（編成画面で装備できます）`;
      card.lines.appendChild(head);
      for (const item of run.drops) card.lines.appendChild(buildDropRow(item));
    }

    scrollLog();
    restoreParty();
    buildPartyDock();
    renderDock();
  }

  function buildDropRow(item) {
    const row = document.createElement("div");
    row.className = "drop-row";
    const dot = document.createElement("div");
    dot.className = "drop-dot";
    dot.style.background = item.rarityColor;
    row.appendChild(dot);
    const label = document.createElement("div");
    label.textContent = itemLabel(item);
    row.appendChild(label);
    return row;
  }

  function itemLabel(item) {
    return `${item.name}（${STAT_LABELS[item.stat]}+${item.value}）`;
  }

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

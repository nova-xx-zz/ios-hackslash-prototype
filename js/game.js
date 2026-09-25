(() => {
  "use strict";

  const BEST_KEY = "jobquest_best_cleared";
  const MATERIAL_KEY = "jobquest_material";
  const AUTO_DISASSEMBLE_KEY = "jobquest_autodisassemble";
  const AUTO_DISASSEMBLE_FILTER_KEY = "jobquest_autodisassemble_filter";
  const AUTO_REPEAT_TARGET_KEY = "jobquest_autorepeat_target";
  const AUTO_REPEAT_OPTIONS = [1, 3, 5, 10, 20, 50];
  const DEX_SEEN_KEY = "jobquest_dex_seen";
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MAX_ACTIVE = 5;

  function getBestStage() { return parseInt(localStorage.getItem(BEST_KEY) || "0", 10); }
  function setBestStage(n) { if (n > getBestStage()) localStorage.setItem(BEST_KEY, String(n)); }

  let material = parseInt(localStorage.getItem(MATERIAL_KEY) || "0", 10);
  let autoDisassemble = localStorage.getItem(AUTO_DISASSEMBLE_KEY) === "1";
  function addMaterial(n) { material += n; localStorage.setItem(MATERIAL_KEY, String(material)); }

  // 自動分解の対象レア度（プレイヤーがフィルターで選択、端末に保存）
  let autoDisassembleRarities = new Set(DEFAULT_AUTO_DISASSEMBLE_RARITIES);
  try {
    const saved = JSON.parse(localStorage.getItem(AUTO_DISASSEMBLE_FILTER_KEY));
    if (Array.isArray(saved)) autoDisassembleRarities = new Set(saved);
  } catch (e) { /* 保存値が壊れていたら既定値のまま */ }
  function saveAutoDisassembleFilter() {
    localStorage.setItem(AUTO_DISASSEMBLE_FILTER_KEY, JSON.stringify([...autoDisassembleRarities]));
  }

  // モンスター図鑑（遭遇したモンスターのキーを端末に保存）
  let dexSeen = new Set();
  try {
    const savedDex = JSON.parse(localStorage.getItem(DEX_SEEN_KEY));
    if (Array.isArray(savedDex)) dexSeen = new Set(savedDex);
  } catch (e) { /* 保存値が壊れていたら空のまま */ }
  function markDexSeen(key) {
    if (dexSeen.has(key)) return;
    dexSeen.add(key);
    localStorage.setItem(DEX_SEEN_KEY, JSON.stringify([...dexSeen]));
  }

  // ---------- Roster ----------
  let nextCharSeq = 1;
  function expForLevel(level) { return 30 + level * 15; }

  function newCharacter(name, job, race, opts) {
    opts = opts || {};
    const c = {
      id: "c" + nextCharSeq++, name, job, race: race || "human",
      subAbilityIds: [null, null],
      jobLevels: {}, // ジョブID -> {level, exp, expToNext}（転職してもレベルを保持するため）
      skillActive: {}, // abilityId -> bool (default true when unlocked)
      abilityPriority: {}, // abilityId -> 1(温存)/2(通常)/3(優先)、既定2
      targetPriority: "weakest", // weakest / strongest / random
      level: opts.level || 1, exp: 0, expToNext: 30,
      equip: { weapon: null, armor: null, accessory: null },
      atb: 0, defending: false, alive: true,
      team: opts.team !== undefined ? opts.team : null, // 0..3 所属チーム / null は控え
      isMonster: opts.isMonster || false,
    };
    c.expToNext = expForLevel(c.level);
    if (!c.isMonster && job) c.jobLevels[job] = { level: c.level, exp: c.exp, expToNext: c.expToNext };
    const s = computeStats(c);
    c.hp = s.maxHp; c.mp = s.maxMp;
    return c;
  }

  // 転職: 直前のジョブの進行を保存し、切り替え先のジョブの保持レベルを復元する（無ければLv1から）
  function switchJob(c, jobId) {
    if (c.isMonster || c.job === jobId) return;
    c.jobLevels[c.job] = { level: c.level, exp: c.exp, expToNext: c.expToNext };
    c.job = jobId;
    const saved = c.jobLevels[jobId] || { level: 1, exp: 0, expToNext: expForLevel(1) };
    c.jobLevels[jobId] = saved;
    c.level = saved.level; c.exp = saved.exp; c.expToNext = saved.expToNext;
    c.subAbilityIds = c.subAbilityIds.map((id) => {
      if (!id) return null;
      const sub = getAbilityById(id);
      return sub && JOBS[jobId].abilities.find((a) => a.id === sub.id) ? null : id;
    });
  }

  // 上級職は対応する基本職を規定レベルまで極めると解放される
  function jobUnlocked(c, jobId) {
    const job = JOBS[jobId];
    if (job.tier !== "advanced") return true;
    const req = job.requires;
    const lvl = (c.jobLevels[req.job] && c.jobLevels[req.job].level) || 0;
    return lvl >= req.level;
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
      if (item) s[item.stat] += itemEffectiveValue(item);
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
    return itemEffectiveValue(item) * (weights[item.stat] || 0.5);
  }

  function racePassive(c, key) {
    const race = RACES[c.race] || RACES.human;
    return race.passive[key] || 0;
  }

  function availableAbilities(c) {
    const job = jobDef(c);
    const list = job.abilities.filter((a) => c.level >= a.reqLevel);
    if (!c.isMonster) {
      for (const id of c.subAbilityIds) {
        if (!id) continue;
        const sub = getAbilityById(id);
        if (sub && !list.find((a) => a.id === sub.id)) list.push(sub);
      }
    }
    return list;
  }

  function isSkillActive(c, abilityId) {
    return c.skillActive[abilityId] !== false; // default ON
  }

  // サブアビリティ候補: 実際にそのジョブでレベルを上げたことがある（jobLevelsに記録がある）技のみ
  function subAbilityCandidates(c) {
    const list = [];
    if (c.isMonster) return list; // モンスターは人間の技を覚えない
    for (const jobId in JOBS) {
      if (jobId === c.job) continue;
      const trained = c.jobLevels[jobId];
      if (!trained) continue;
      for (const a of JOBS[jobId].abilities) {
        if (trained.level >= a.reqLevel) list.push(a);
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
  function isRunActive() { return !!(run && !run.finished); }

  // 自動周回（設定した回数だけ同じダンジョンへ再出撃し続ける）
  let autoRepeatTarget = clampAutoRepeatTarget(parseInt(localStorage.getItem(AUTO_REPEAT_TARGET_KEY) || "5", 10));
  let autoRepeatActive = false;
  let autoRepeatDone = 0;
  function clampAutoRepeatTarget(n) { return AUTO_REPEAT_OPTIONS.includes(n) ? n : 5; }
  function isDockLocked() { return isRunActive() || autoRepeatActive; }

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
    bits.push(`強化石: ${material}`);
    document.getElementById("bestClearText").textContent = bits.join("　/　");
  }

  document.getElementById("btnGoBattle").addEventListener("click", () => {
    openExploreHub();
  });
  document.getElementById("btnGoJobs").addEventListener("click", () => {
    jobsReturnScreen = "screen-title";
    renderJobsScreen();
    showScreen("screen-jobs");
  });
  document.getElementById("btnGoDex").addEventListener("click", () => {
    renderDexScreen();
    showScreen("screen-dex");
  });
  document.getElementById("btnDexBack").addEventListener("click", () => {
    renderTitle();
    showScreen("screen-title");
  });

  function renderDexScreen() {
    document.getElementById("dexCount").textContent =
      `発見済み ${dexSeen.size} / ${ENEMY_TEMPLATES.length} 体`;
    const body = document.getElementById("dexBody");
    body.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "dex-card-grid";
    for (const t of ENEMY_TEMPLATES) {
      const seen = dexSeen.has(t.key);
      const card = document.createElement("button");
      card.className = "dex-card" + (seen ? "" : " locked");
      card.innerHTML = seen
        ? `<div class="dex-card-icon">${t.icon || "❓"}</div>
           <div class="dex-card-name">${t.name}</div>
           <div class="dex-card-element">${t.element}</div>`
        : `<div class="dex-card-icon">❓</div>
           <div class="dex-card-name">？？？</div>
           <div class="dex-card-element">&nbsp;</div>`;
      if (seen) card.addEventListener("click", () => openDexDetail(t.key));
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  function openDexDetail(key) {
    const t = getEnemyTemplate(key);
    document.getElementById("dexIcon").textContent = t.icon || "❓";
    document.getElementById("dexName").textContent = t.name;
    document.getElementById("dexElement").textContent =
      `属性: ${t.element}　${t.tamable ? "テイム可能" : "テイム不可"}`;
    document.getElementById("dexDesc").textContent = t.desc || "";
    const statsBox = document.getElementById("dexStats");
    const rows = [
      ["HP", t.hp], ["ATK", t.atk], ["DEF", t.def], ["SPD", t.spd], ["EXP", t.exp],
    ];
    statsBox.innerHTML = rows.map(([label, value]) => `
      <div class="pm-stat-row">
        <span class="pm-stat-label">${label}</span>
        <span class="dex-stat-value">${value}</span>
      </div>`).join("");
    document.getElementById("dexModal").classList.remove("hidden");
  }
  function closeDexModal() {
    document.getElementById("dexModal").classList.add("hidden");
  }
  document.getElementById("btnDexModalClose").addEventListener("click", closeDexModal);
  document.getElementById("dexModal").addEventListener("click", (e) => {
    if (e.target.id === "dexModal") closeDexModal();
  });

  function openExploreHub() {
    buildPartyDock();
    renderDock();
    showScreen("screen-battle");
  }

  // ---------- Map screen ----------
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
        <div class="label">${d.name}</div>`;
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
    const party = activeParty();
    el.innerHTML = `
      <div class="dname">${d.name}${clearedDungeons.has(d.id) ? "　クリア済み" : ""}</div>
      <div class="dmeta">
        ${d.desc}<br>
        戦闘数: ${d.battles}回（最後はボス戦）
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
    openExploreHub();
  });

  // ---------- パーティ一覧（編成画面） ----------
  const expandedTeams = new Set([0]);
  let benchExpanded = true;
  let detailCharId = null;
  let detailTab = "stats";

  function renderJobsScreen() {
    const wrap = document.getElementById("rosterBody");
    wrap.innerHTML = "";

    wrap.appendChild(sectionLabel("パーティ"));
    for (let i = 0; i < TEAM_LABELS.length; i++) {
      const members = teamMembers(i);
      wrap.appendChild(buildPartyRow({
        key: "t" + i,
        name: `${TEAM_NAMES[i]}（${TEAM_LABELS[i]}）`,
        meta: `${members.length}/${MAX_ACTIVE}人`,
        deployed: i === activeTeam,
        expanded: expandedTeams.has(i),
        onToggle: () => {
          if (expandedTeams.has(i)) expandedTeams.delete(i); else expandedTeams.add(i);
          renderJobsScreen();
        },
        onDeploy: () => { activeTeam = i; renderJobsScreen(); },
        members,
        dropKey: String(i),
        emptyTile: null,
      }));
    }

    wrap.appendChild(sectionLabel("未編成"));
    const bench = roster.filter((c) => c.team === null);
    wrap.appendChild(buildPartyRow({
      key: "bench",
      name: "控え",
      meta: `${bench.length}人`,
      expanded: benchExpanded,
      onToggle: () => { benchExpanded = !benchExpanded; renderJobsScreen(); },
      members: bench,
      dropKey: "bench",
      emptyTile: () => openCreateScreen(),
    }));

    document.getElementById("rosterCount").textContent = rosterMessage ||
      `所持なかま ${roster.length}人　/　所持品 ${inventory.length}個　（カードを長押しでドラッグ移動）`;
  }

  let rosterMessage = "";
  let rosterMessageTimer = null;
  function flashRosterMessage(text) {
    rosterMessage = text;
    clearTimeout(rosterMessageTimer);
    rosterMessageTimer = setTimeout(() => { rosterMessage = ""; renderJobsScreen(); }, 1800);
  }

  function sectionLabel(text) {
    const el = document.createElement("div");
    el.className = "roster-section";
    el.textContent = text;
    return el;
  }

  function buildPartyRow(opts) {
    const frag = document.createDocumentFragment();

    const head = document.createElement("button");
    head.className = "party-row-head";
    head.dataset.drop = opts.dropKey;
    head.innerHTML = `<span class="chev">${opts.expanded ? "∨" : "＞"}</span>
      <span class="pname">${opts.name}</span>`;
    if (opts.deployed) {
      const tag = document.createElement("span");
      tag.className = "deployed";
      tag.textContent = "出撃中";
      head.appendChild(tag);
    }
    const meta = document.createElement("span");
    meta.className = "pmeta";
    meta.textContent = opts.meta;
    head.appendChild(meta);
    head.addEventListener("click", opts.onToggle);
    frag.appendChild(head);

    if (!opts.expanded) return frag;

    const strip = document.createElement("div");
    strip.className = "member-strip";
    strip.dataset.drop = opts.dropKey;
    for (const c of opts.members) strip.appendChild(buildMemberCard(c));
    if (opts.emptyTile) {
      const add = document.createElement("button");
      add.className = "member-card empty";
      add.textContent = "＋";
      add.title = "仲間を探す";
      add.addEventListener("click", opts.emptyTile);
      strip.appendChild(add);
    }
    if (opts.members.length === 0 && !opts.emptyTile) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.style.padding = "2px 4px 8px";
      none.textContent = "（このパーティは空です）";
      frag.appendChild(none);
    }
    frag.appendChild(strip);

    if (opts.onDeploy && !opts.deployed && opts.members.length > 0) {
      const btn = document.createElement("button");
      btn.className = "equip-choice";
      btn.style.margin = "0 2px 10px";
      btn.textContent = "このパーティで出撃する";
      btn.addEventListener("click", opts.onDeploy);
      frag.appendChild(btn);
    }
    return frag;
  }

  function buildMemberCard(c) {
    const stats = computeStats(c);
    const btn = document.createElement("button");
    btn.className = "member-card" + (c.isMonster ? " monster" : "");
    btn.innerHTML = `
      <div class="mtitle">${RACES[c.race].name}・${jobDef(c).name}</div>
      <div class="mname">${c.name}</div>
      <div class="mstats"><span>Lv.${c.level}</span><span>HP${stats.maxHp}</span></div>`;
    attachMemberDrag(btn, c);
    return btn;
  }

  // ---------- メンバーカードのドラッグ移動 ----------
  // iOS Safari では HTML5 drag&drop が使えないので Pointer Events で実装する。
  // 長押しでドラッグ開始、それ以前の指の移動は横スクロールとして扱う。
  const DRAG_HOLD_MS = 260;
  const DRAG_SLOP = 10;
  let dragState = null;

  function attachMemberDrag(card, c) {
    card.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const start = { x: e.clientX, y: e.clientY };
      let dragging = false;
      let canceled = false;

      const holdTimer = setTimeout(() => {
        if (canceled) return;
        dragging = true;
        startMemberDrag(c, card, start);
      }, DRAG_HOLD_MS);

      const onMove = (ev) => {
        if (dragging) {
          ev.preventDefault();
          moveMemberDrag(ev);
          return;
        }
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > DRAG_SLOP) {
          canceled = true;
          clearTimeout(holdTimer);
          detach();
        }
      };
      const onUp = (ev) => {
        clearTimeout(holdTimer);
        detach();
        if (dragging) dropMemberDrag(ev);
        else if (!canceled) openCharDetail(c);
      };
      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    // キーボード操作など、ポインタを伴わない click のためのフォールバック
    card.addEventListener("click", (e) => {
      if (e.detail === 0) openCharDetail(c);
    });
  }

  function startMemberDrag(c, card, pos) {
    const ghost = card.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = card.offsetWidth + "px";
    ghost.style.left = pos.x + "px";
    ghost.style.top = pos.y + "px";
    document.body.appendChild(ghost);
    card.classList.add("dragging");
    document.body.classList.add("dragging-member");
    dragState = { char: c, card, ghost, zone: null };
  }

  function moveMemberDrag(ev) {
    if (!dragState) return;
    dragState.ghost.style.left = ev.clientX + "px";
    dragState.ghost.style.top = ev.clientY + "px";
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const zone = el ? el.closest("[data-drop]") : null;
    if (zone === dragState.zone) return;
    if (dragState.zone) dragState.zone.classList.remove("drop-target", "full");
    if (zone) {
      zone.classList.add("drop-target");
      if (!canDropOn(zone.dataset.drop, dragState.char)) zone.classList.add("full");
    }
    dragState.zone = zone;
  }

  function canDropOn(key, c) {
    if (key === "bench") return true;
    const i = parseInt(key, 10);
    if (c.team === i) return true;
    return teamMembers(i).length < MAX_ACTIVE;
  }

  function dropMemberDrag() {
    if (!dragState) return;
    const { char, card, ghost, zone } = dragState;
    ghost.remove();
    card.classList.remove("dragging");
    document.body.classList.remove("dragging-member");
    if (zone) zone.classList.remove("drop-target", "full");
    dragState = null;

    if (zone) {
      const key = zone.dataset.drop;
      if (key === "bench") {
        char.team = null;
        benchExpanded = true;
      } else {
        const i = parseInt(key, 10);
        if (char.team !== i) {
          if (!canDropOn(key, char)) {
            flashRosterMessage(`${TEAM_NAMES[i]}は満員です（最大${MAX_ACTIVE}人）`);
            renderJobsScreen();
            return;
          }
          char.team = i;
          clampVitals(char);
          expandedTeams.add(i);
        }
      }
    }
    renderJobsScreen();
  }

  // ---------- キャラ作成（自由ビルド） ----------
  let draft = null;

  function openCreateScreen() {
    const r = rollNewRecruit();
    draft = { name: r.name, race: r.race, job: r.job };
    renderCreateScreen();
    showScreen("screen-create");
  }

  function renderCreateScreen() {
    const wrap = document.getElementById("createBody");
    wrap.innerHTML = "";

    // 名前
    const nameField = document.createElement("div");
    nameField.className = "create-row create-row-name";
    nameField.innerHTML = `<div class="cr-label">なまえ</div>`;
    const nameRow = document.createElement("div");
    nameRow.className = "name-row";
    const input = document.createElement("input");
    input.className = "name-input";
    input.id = "createName";
    input.type = "text";
    input.maxLength = 8;
    input.value = draft.name;
    input.addEventListener("input", () => {
      draft.name = input.value;
      updateCreatePreview();
    });
    nameRow.appendChild(input);
    const dice = document.createElement("button");
    dice.className = "pick-chip";
    dice.textContent = "別の名前";
    dice.addEventListener("click", () => {
      draft.name = rollNewRecruit().name;
      renderCreateScreen();
    });
    nameRow.appendChild(dice);
    nameField.appendChild(nameRow);
    wrap.appendChild(nameField);

    // 種族
    wrap.appendChild(buildCreatePickRow("しゅぞく", RACES[draft.race].name, RACES[draft.race].desc, () => openCreatePick("race")));

    // ジョブ
    const jobSub = JOBS[draft.job].abilities.map((a) => `${a.name}(Lv.${a.reqLevel})`).join(" / ");
    wrap.appendChild(buildCreatePickRow("ジョブ", JOBS[draft.job].name, jobSub, () => openCreatePick("job")));

    // プレビュー
    const previewLabel = document.createElement("div");
    previewLabel.className = "create-section-label";
    previewLabel.textContent = "プレビュー";
    wrap.appendChild(previewLabel);
    const box = document.createElement("div");
    box.className = "preview-box";
    box.id = "createPreview";
    wrap.appendChild(box);
    updateCreatePreview();
  }

  function buildCreatePickRow(label, value, sub, onClick) {
    const row = document.createElement("button");
    row.className = "create-row";
    row.innerHTML = `
      <div class="cr-main">
        <div class="cr-label">${label}</div>
        <div class="cr-value">${value}</div>
        <div class="cr-sub">${sub}</div>
      </div>
      <div class="cr-chev">›</div>`;
    row.addEventListener("click", onClick);
    return row;
  }

  function statStars(value, allValues, maxStars) {
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    if (min === max) return Math.ceil(maxStars / 2);
    return Math.max(1, Math.round(((value - min) / (max - min)) * (maxStars - 1)) + 1);
  }

  function jobStatStars(job, maxStars) {
    const stars = {};
    const peers = Object.values(JOBS).filter((j) => j.tier === job.tier);
    for (const k of Object.keys(STAT_LABELS)) {
      stars[k] = statStars(job.base[k], peers.map((j) => j.base[k]), maxStars);
    }
    return stars;
  }

  function raceStatStars(race, maxStars) {
    const stars = {};
    for (const k of Object.keys(STAT_LABELS)) {
      stars[k] = statStars(race.mult[k], PLAYER_RACE_IDS.map((id) => RACES[id].mult[k]), maxStars);
    }
    return stars;
  }

  function starBar(stars, maxStars) {
    return "★".repeat(stars) + "☆".repeat(maxStars - stars);
  }

  function openCreatePick(field) {
    renderPickModal(field, draft[field]);
  }

  function renderPickModal(field, id) {
    const isJob = field === "job";
    const def = isJob ? JOBS[id] : RACES[id];
    const ids = isJob ? BASIC_JOB_IDS : PLAYER_RACE_IDS;
    const MAX_STARS = 5;
    const stars = isJob ? jobStatStars(def, MAX_STARS) : raceStatStars(def, MAX_STARS);

    document.getElementById("pmIcon").textContent = def.icon || "❓";
    document.getElementById("pmName").textContent = def.name;
    document.getElementById("pmDesc").textContent = def.desc;

    const statsBox = document.getElementById("pmStats");
    statsBox.innerHTML = Object.keys(STAT_LABELS).map((k) => `
      <div class="pm-stat-row">
        <span class="pm-stat-label">${STAT_LABELS[k]}</span>
        <span class="pm-stat-stars">${starBar(stars[k], MAX_STARS)}</span>
      </div>`).join("");

    const listBox = document.getElementById("pmList");
    if (isJob) {
      listBox.innerHTML = `<div class="pm-list-label">アビリティ</div>` + def.abilities.map((a) => `
        <div class="pm-ability-row">
          <div class="pm-ability-name">${a.name}<span class="pm-ability-lv">Lv.${a.reqLevel}</span></div>
          <div class="pm-ability-desc">${a.desc}</div>
        </div>`).join("");
    } else {
      const passives = Object.keys(def.passive).map((k) => PASSIVE_LABELS[k](def.passive[k]));
      if (def.expMult !== 1) passives.push(`獲得経験値 ${Math.round((def.expMult - 1) * 100)}%`);
      listBox.innerHTML = `<div class="pm-list-label">種族特性</div>
        <div class="pm-ability-desc">${passives.length ? passives.join(" / ") : "特性なし"}</div>`;
    }

    const strip = document.getElementById("pmStrip");
    strip.innerHTML = "";
    for (const oid of ids) {
      const odef = isJob ? JOBS[oid] : RACES[oid];
      const chip = document.createElement("button");
      chip.className = "pm-chip" + (oid === id ? " active" : "");
      chip.textContent = odef.icon || "❓";
      chip.title = odef.name;
      chip.addEventListener("click", () => renderPickModal(field, oid));
      strip.appendChild(chip);
    }

    document.getElementById("btnPickModalOk").onclick = () => {
      draft[field] = id;
      renderCreateScreen();
      closePickModal();
    };
    document.getElementById("pickModal").classList.remove("hidden");
  }

  function closePickModal() {
    document.getElementById("pickModal").classList.add("hidden");
  }

  document.getElementById("pickModal").addEventListener("click", (e) => {
    if (e.target.id === "pickModal") closePickModal();
  });

  function createStartLevel() { return 1; }

  function updateCreatePreview() {
    const box = document.getElementById("createPreview");
    if (!box) return;
    const preview = newCharacter(draft.name || "ななし", draft.job, draft.race, { level: createStartLevel() });
    const s = computeStats(preview);
    const race = RACES[draft.race];
    const passives = Object.keys(race.passive).map((k) => PASSIVE_LABELS[k](race.passive[k]));
    if (race.expMult !== 1) passives.push(`獲得経験値 ${Math.round((race.expMult - 1) * 100)}%`);
    box.innerHTML = `
      <div class="pv-name">${draft.name || "ななし"} — ${race.name}・${JOBS[draft.job].name} Lv.${preview.level}</div>
      <div class="pv-stats">HP ${s.maxHp}　MP ${s.maxMp}　ATK ${s.atk}　MAG ${s.mag}　DEF ${s.def}　SPD ${Math.round(s.spd * 10) / 10}</div>
      <div class="pv-note">${passives.length ? "種族特性: " + passives.join(" / ") : "種族特性: なし"}</div>
      <div class="pv-note">習得済み: ${availableAbilities(preview).map((a) => a.name).join("、") || "なし"}</div>`;
  }

  const PASSIVE_LABELS = {
    critBonus: (v) => `会心率 +${Math.round(v * 100)}%`,
    dmgTakenMult: (v) => `被ダメージ ${Math.round((v - 1) * 100)}%`,
    lifesteal: (v) => `与ダメージの ${Math.round(v * 100)}% を吸収`,
    mpCostMult: (v) => `消費MP ${Math.round((v - 1) * 100)}%`,
    healBonus: (v) => `回復量 +${Math.round(v * 100)}%`,
  };

  function confirmCreate() {
    const name = (draft.name || "").trim() || "ななし";
    const c = newCharacter(name, draft.job, draft.race, { level: createStartLevel() });
    roster.push(c);
    benchExpanded = true;
    renderJobsScreen();
    showScreen("screen-jobs");
    return c;
  }

  document.getElementById("btnCreateBack").addEventListener("click", () => {
    renderJobsScreen();
    showScreen("screen-jobs");
  });
  document.getElementById("btnCreateRandom").addEventListener("click", () => {
    const r = rollNewRecruit();
    draft = { name: r.name, race: r.race, job: r.job };
    renderCreateScreen();
  });
  document.getElementById("btnCreateConfirm").addEventListener("click", () => { confirmCreate(); });

  // ---------- キャラ詳細 ----------
  function openCharDetail(c) {
    detailCharId = c.id;
    detailTab = "stats";
    renderCharDetail();
    showScreen("screen-chardetail");
  }

  const DETAIL_TABS = [
    { key: "stats", label: "能力値" },
    { key: "equip", label: "装備" },
    { key: "skill", label: "スキル" },
    { key: "job", label: "ジョブ" },
  ];

  function renderCharDetail() {
    const c = roster.find((x) => x.id === detailCharId);
    if (!c) { showScreen("screen-jobs"); return; }
    document.getElementById("detailName").textContent =
      `${c.name}${c.isMonster ? "（テイム）" : ""}`;

    renderDetailTabs();

    const wrap = document.getElementById("detailBody");
    wrap.innerHTML = "";
    const card = document.createElement("div");
    card.className = "job-char-card";
    if (detailTab === "equip") card.appendChild(buildEquipSection(c));
    else if (detailTab === "skill") card.appendChild(buildSkillTab(c));
    else if (detailTab === "job") card.appendChild(buildJobTab(c));
    else card.appendChild(buildStatsTab(c));
    wrap.appendChild(card);
  }

  function renderDetailTabs() {
    const tabs = document.getElementById("detailTabs");
    tabs.innerHTML = "";
    for (const t of DETAIL_TABS) {
      const btn = document.createElement("button");
      btn.className = "detail-tab" + (detailTab === t.key ? " active" : "");
      btn.textContent = t.label;
      btn.addEventListener("click", () => { detailTab = t.key; renderCharDetail(); });
      tabs.appendChild(btn);
    }
  }

  // ---------- 詳細: 能力値タブ ----------
  function buildStatsTab(c) {
    const wrap = document.createElement("div");
    const race = RACES[c.race];
    const stats = computeStats(c);

    wrap.innerHTML = `<div class="cname">${c.name}${c.isMonster ? "（テイム）" : ""} — ${race.name}・${jobDef(c).name} Lv.${c.level}</div>
      <div class="sub-ability-row">${race.desc}</div>`;

    const partyLabel = document.createElement("div");
    partyLabel.className = "sub-ability-row";
    partyLabel.textContent = "所属パーティ";
    wrap.appendChild(partyLabel);

    const activeRow = document.createElement("div");
    activeRow.className = "job-pick-row";
    const benchBtn = document.createElement("button");
    benchBtn.className = "job-pick" + (c.team === null ? " active" : "");
    benchBtn.textContent = "控え";
    benchBtn.addEventListener("click", () => { c.team = null; renderCharDetail(); });
    activeRow.appendChild(benchBtn);
    for (let i = 0; i < TEAM_LABELS.length; i++) {
      const btn = document.createElement("button");
      const atCap = c.team !== i && teamMembers(i).length >= MAX_ACTIVE;
      btn.className = "job-pick" + (c.team === i ? " active" : "") + (atCap ? " disabled" : "");
      btn.textContent = TEAM_LABELS[i];
      btn.addEventListener("click", () => {
        if (atCap) return;
        c.team = i;
        clampVitals(c);
        renderCharDetail();
      });
      activeRow.appendChild(btn);
    }
    wrap.appendChild(activeRow);

    const statLabel = document.createElement("div");
    statLabel.className = "sub-ability-row";
    statLabel.textContent = "能力値";
    wrap.appendChild(statLabel);

    const statBox = document.createElement("div");
    statBox.className = "detail-stat-box";
    const rows = [
      ["HP", stats.maxHp], ["MP", stats.maxMp],
      ["ATK", stats.atk], ["MAG", stats.mag],
      ["DEF", stats.def], ["SPD", Math.round(stats.spd * 10) / 10],
    ];
    statBox.innerHTML = rows.map(([k, v]) => `<div class="detail-stat-row"><span>${k}</span><span>${v}</span></div>`).join("");
    wrap.appendChild(statBox);

    return wrap;
  }

  // ---------- 詳細: ジョブタブ ----------
  function buildJobCard(c, jobId, unlocked) {
    const job = JOBS[jobId];
    const trained = c.jobLevels[jobId];
    const lvl = trained ? trained.level : 0;
    const mastered = lvl >= JOB_MASTER_LEVEL;
    const pct = trained ? clamp((trained.exp / trained.expToNext) * 100, 0, 100) : 0;

    const card = document.createElement("button");
    card.className = "job-card" + (c.job === jobId ? " active" : "") + (unlocked ? "" : " locked");
    card.innerHTML = `
      <div class="job-card-icon">${job.icon || "❓"}</div>
      <div class="job-card-level">${trained ? `Lv.${lvl}${mastered ? '<span class="star">★</span>' : ""}` : "未経験"}</div>
      <div class="job-card-name">${job.name}</div>
      <div class="job-card-exp-bar"><div class="fill" style="width:${pct}%"></div></div>`;
    if (!unlocked) card.title = `${JOBS[job.requires.job].name} Lv.${job.requires.level}で解放`;
    card.addEventListener("click", () => {
      if (!unlocked) return;
      switchJob(c, jobId);
      clampVitals(c);
      renderCharDetail();
    });
    return card;
  }

  function buildJobTab(c) {
    const wrap = document.createElement("div");
    if (c.isMonster) {
      const note = document.createElement("div");
      note.className = "sub-ability-row";
      note.textContent = "モンスターは転職できず、種族専用の技を使う";
      wrap.appendChild(note);
      return wrap;
    }

    const advIds = Object.keys(JOBS).filter((id) => JOBS[id].tier === "advanced");
    const masteredCount = (ids) => ids.filter((id) => (c.jobLevels[id] && c.jobLevels[id].level) >= JOB_MASTER_LEVEL).length;

    const basicHead = document.createElement("div");
    basicHead.className = "detail-section-head";
    basicHead.innerHTML = `<span>基本職</span><span class="count">${masteredCount(BASIC_JOB_IDS)}/${BASIC_JOB_IDS.length}</span>`;
    wrap.appendChild(basicHead);

    const basicGrid = document.createElement("div");
    basicGrid.className = "job-card-grid";
    for (const jobId of BASIC_JOB_IDS) basicGrid.appendChild(buildJobCard(c, jobId, true));
    wrap.appendChild(basicGrid);

    const advHead = document.createElement("div");
    advHead.className = "detail-section-head";
    advHead.innerHTML = `<span>上級職（対応する基本職をLv.${JOB_MASTER_LEVEL}まで極めると転職できる）</span><span class="count">${masteredCount(advIds)}/${advIds.length}</span>`;
    wrap.appendChild(advHead);

    const advGrid = document.createElement("div");
    advGrid.className = "job-card-grid";
    for (const jobId of advIds) advGrid.appendChild(buildJobCard(c, jobId, jobUnlocked(c, jobId)));
    wrap.appendChild(advGrid);

    return wrap;
  }

  // ---------- 詳細: スキルタブ ----------
  const ABILITY_KIND_ICONS = { physical: "⚔️", magic: "🔥", heal: "✨" };

  function buildSkillRow(c, a, opts) {
    opts = opts || {};
    const row = document.createElement("div");
    row.className = "skill-row" + (opts.locked ? " locked" : "");

    const icon = document.createElement("div");
    icon.className = "skill-row-icon";
    icon.textContent = ABILITY_KIND_ICONS[a.kind] || "◆";
    row.appendChild(icon);

    const name = document.createElement("div");
    name.className = "skill-row-name";
    name.textContent = a.name;
    row.appendChild(name);

    if (opts.locked) {
      const lockedLabel = document.createElement("div");
      lockedLabel.className = "skill-row-locked-label";
      lockedLabel.textContent = `Lv.${a.reqLevel}で習得`;
      row.appendChild(lockedLabel);
      return row;
    }

    if (opts.staticOn) {
      const staticToggle = document.createElement("div");
      staticToggle.className = "skill-toggle-circle on static";
      row.appendChild(staticToggle);
      return row;
    }

    const on = isSkillActive(c, a.id);
    const tier = getAbilityTier(c, a.id);
    const tierInfo = ABILITY_TIERS.find((t) => t.value === tier);
    const tierBtn = document.createElement("button");
    tierBtn.className = "priority-chip tier-" + tier + (on ? "" : " dim");
    tierBtn.textContent = tierInfo.label;
    tierBtn.title = "タップで優先度を切り替え（優先→通常→温存）";
    tierBtn.addEventListener("click", () => { cycleAbilityTier(c, a.id); renderCharDetail(); });
    row.appendChild(tierBtn);

    const toggle = document.createElement("button");
    toggle.className = "skill-toggle-circle" + (on ? " on" : "");
    toggle.title = on ? "タップでOFFにする" : "タップでONにする";
    toggle.addEventListener("click", () => {
      c.skillActive[a.id] = !isSkillActive(c, a.id);
      renderCharDetail();
    });
    row.appendChild(toggle);

    return row;
  }

  function buildSkillTab(c) {
    const wrap = document.createElement("div");

    const activeList = availableAbilities(c);
    const lockedList = jobDef(c).abilities.filter((a) => c.level < a.reqLevel);
    const activeHead = document.createElement("div");
    activeHead.className = "detail-section-head";
    activeHead.innerHTML = `<span>アクティブ（OFFで不使用、優先度で使う順番を調整）</span><span class="count">${activeList.length}/${activeList.length + lockedList.length}</span>`;
    wrap.appendChild(activeHead);

    const activeListWrap = document.createElement("div");
    activeListWrap.className = "skill-row-list";
    for (const a of activeList) activeListWrap.appendChild(buildSkillRow(c, a));
    for (const a of lockedList) activeListWrap.appendChild(buildSkillRow(c, a, { locked: true }));
    wrap.appendChild(activeListWrap);

    const race = RACES[c.race];
    const passives = Object.keys(race.passive).map((k) => ({ id: "p_" + k, name: PASSIVE_LABELS[k](race.passive[k]), kind: "passive" }));
    if (race.expMult !== 1) passives.push({ id: "p_exp", name: `獲得経験値 ${Math.round((race.expMult - 1) * 100)}%`, kind: "passive" });
    const passiveHead = document.createElement("div");
    passiveHead.className = "detail-section-head";
    passiveHead.innerHTML = `<span>パッシブ（種族特性、常時有効）</span><span class="count">${passives.length}/${passives.length}</span>`;
    wrap.appendChild(passiveHead);

    const passiveListWrap = document.createElement("div");
    passiveListWrap.className = "skill-row-list";
    for (const p of passives) passiveListWrap.appendChild(buildSkillRow(c, p, { staticOn: true }));
    if (passives.length === 0) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.textContent = "（この種族に特性はありません）";
      passiveListWrap.appendChild(none);
    }
    wrap.appendChild(passiveListWrap);

    if (!c.isMonster) {
      const subLabels = ["サブアビリティ①", "サブアビリティ②"];
      for (let slot = 0; slot < 2; slot++) {
        const subRow = document.createElement("div");
        subRow.className = "sub-ability-row";
        subRow.textContent = `${subLabels[slot]}（他ジョブで実際にレベルを上げた技を装備できる）`;
        wrap.appendChild(subRow);

        const subPickRow = document.createElement("div");
        subPickRow.className = "sub-pick-row";
        const noneBtn = document.createElement("button");
        noneBtn.className = "sub-pick" + (!c.subAbilityIds[slot] ? " active" : "");
        noneBtn.textContent = "なし";
        noneBtn.addEventListener("click", () => { c.subAbilityIds[slot] = null; renderCharDetail(); });
        subPickRow.appendChild(noneBtn);

        const otherSlotId = c.subAbilityIds[1 - slot];
        const candidates = subAbilityCandidates(c).filter((a) => a.id !== otherSlotId);
        for (const a of candidates) {
          const btn = document.createElement("button");
          btn.className = "sub-pick" + (c.subAbilityIds[slot] === a.id ? " active" : "");
          btn.textContent = a.name;
          btn.addEventListener("click", () => { c.subAbilityIds[slot] = a.id; renderCharDetail(); });
          subPickRow.appendChild(btn);
        }
        wrap.appendChild(subPickRow);
      }
      if (subAbilityCandidates(c).length === 0) {
        const hintEl = document.createElement("div");
        hintEl.className = "sub-ability-row";
        hintEl.textContent = "（まだ他ジョブの技を習得していません）";
        wrap.appendChild(hintEl);
      }
    }

    const targetRow = document.createElement("div");
    targetRow.className = "sub-ability-row";
    targetRow.textContent = "攻撃対象の優先度（単体を狙う技・通常攻撃に適用）";
    wrap.appendChild(targetRow);

    const targetPickRow = document.createElement("div");
    targetPickRow.className = "sub-pick-row";
    for (const mode of TARGET_MODES) {
      const btn = document.createElement("button");
      btn.className = "sub-pick" + (c.targetPriority === mode.value ? " active" : "");
      btn.textContent = mode.label;
      btn.addEventListener("click", () => { c.targetPriority = mode.value; renderCharDetail(); });
      targetPickRow.appendChild(btn);
    }
    wrap.appendChild(targetPickRow);

    return wrap;
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
        renderCharDetail();
      });
      row.appendChild(btn);
    }
    wrap.appendChild(row);

    const autoBtn = document.createElement("button");
    autoBtn.className = "equip-choice";
    autoBtn.style.marginTop = "6px";
    autoBtn.textContent = "おまかせ装備";
    autoBtn.addEventListener("click", () => { autoEquip(c); renderCharDetail(); });
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
        off.addEventListener("click", () => { unequipSlot(c, opened.key); renderCharDetail(); });
        list.appendChild(off);

        const enhance = document.createElement("button");
        enhance.className = "equip-choice enhance-open";
        enhance.textContent = "強化する";
        enhance.addEventListener("click", () => openEnhanceModal(c.equip[opened.key]));
        list.appendChild(enhance);
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
        btn.addEventListener("click", () => { equipItem(c, item); openSlot = null; renderCharDetail(); });
        list.appendChild(btn);
      }
      wrap.appendChild(list);
    }

    return wrap;
  }

  // ---------- 装備強化 ----------
  const SLOT_ICONS = { weapon: "⚔️", armor: "🛡️", accessory: "💍" };
  let enhanceItem = null;
  let enhanceMessage = "";

  function openEnhanceModal(item) {
    enhanceItem = item;
    enhanceMessage = "";
    renderEnhanceModal();
    document.getElementById("enhanceModal").classList.remove("hidden");
  }

  function closeEnhanceModal() {
    document.getElementById("enhanceModal").classList.add("hidden");
    enhanceItem = null;
    renderCharDetail();
  }

  function renderEnhanceModal() {
    const item = enhanceItem;
    if (!item) return;
    const rarity = RARITIES.find((r) => r.key === item.rarity);
    const maxed = item.plus >= ENHANCE_MAX_PLUS;
    const nextValue = itemEffectiveValue({ ...item, plus: item.plus + 1 });

    document.getElementById("enIcon").textContent = SLOT_ICONS[item.slot] || "❓";
    document.getElementById("enName").textContent = `${item.name}${item.plus > 0 ? "+" + item.plus : ""}`;
    document.getElementById("enDesc").textContent =
      `${rarity.name} / ${STAT_LABELS[item.stat]}+${itemEffectiveValue(item)}` +
      (maxed ? "（強化値が上限に達しています）" : ` → 成功で ${STAT_LABELS[item.stat]}+${nextValue}`);

    const rate = enhanceSuccessRate(item);
    const cost = enhanceCost(item);
    const statsBox = document.getElementById("enStats");
    statsBox.innerHTML = `
      <div class="pm-stat-row"><span class="pm-stat-label">強化値</span><span>+${item.plus} / +${ENHANCE_MAX_PLUS}</span></div>
      <div class="pm-stat-row"><span class="pm-stat-label">成功率</span><span>${Math.round(rate * 100)}%</span></div>
      <div class="pm-stat-row"><span class="pm-stat-label">消費強化石</span><span>${cost}（所持 ${material}）</span></div>`;

    const resultBox = document.getElementById("enResult");
    resultBox.textContent = enhanceMessage;
    resultBox.className = "enhance-result" + (enhanceMessage.startsWith("成功") ? " success" : enhanceMessage ? " fail" : "");

    const btn = document.getElementById("btnEnhanceGo");
    btn.disabled = maxed || material < cost;
    btn.textContent = maxed ? "強化値が上限です" : (material < cost ? "強化石が足りません" : "強化する");
  }

  document.getElementById("btnEnhanceGo").addEventListener("click", () => {
    const item = enhanceItem;
    if (!item || item.plus >= ENHANCE_MAX_PLUS) return;
    const cost = enhanceCost(item);
    if (material < cost) return;
    addMaterial(-cost);
    if (Math.random() < enhanceSuccessRate(item)) {
      item.plus += 1;
      enhanceMessage = `成功！ +${item.plus} になった`;
    } else {
      enhanceMessage = `失敗…（+${item.plus} のまま）`;
    }
    renderEnhanceModal();
  });
  document.getElementById("btnEnhanceClose").addEventListener("click", closeEnhanceModal);
  document.getElementById("enhanceModal").addEventListener("click", (e) => {
    if (e.target.id === "enhanceModal") closeEnhanceModal();
  });

  document.getElementById("btnJobsDone").addEventListener("click", () => {
    if (jobsReturnScreen === "screen-battle") {
      openExploreHub();
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
  document.getElementById("btnRecruit").addEventListener("click", () => { openCreateScreen(); });
  document.getElementById("btnDetailBack").addEventListener("click", () => {
    detailCharId = null;
    openSlot = null;
    renderJobsScreen();
    showScreen("screen-jobs");
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
      disassembleCount: 0, materialGained: 0,
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
    for (const e of battle.enemies) markDexSeen(e.key);
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
    document.getElementById("materialLine").textContent = `強化石 ${material}`;
    const running = isRunActive();
    const locked = isDockLocked();
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
    const feed = document.getElementById("logFeed");
    if (!run && feed.children.length === 0) {
      feed.innerHTML = `<p class="sub" style="margin:24px 0;text-align:center;">下の「マップ」からダンジョンを選んで冒険を始めましょう</p>`;
    }
    document.getElementById("dockStatus").textContent = !d
      ? ""
      : running ? "探索中…" : (run.wiped ? "失敗" : "踏破");
    const pct = d ? (Math.min(run.battleIndex + (running ? 0 : 1), d.battles) / d.battles) * 100 : 0;
    document.getElementById("dockProgressFill").style.width = clamp(pct, 0, 100) + "%";

    document.getElementById("btnRedeploy").disabled = locked || !d;
    document.getElementById("btnDockMap").disabled = locked;
    document.getElementById("btnDockJobs").disabled = locked;
    updateAutoDisassembleButton();
    renderDisassembleFilter();
    renderAutoRepeatRow();

    const tabs = document.getElementById("teamTabs");
    tabs.innerHTML = "";
    TEAM_LABELS.forEach((label, i) => {
      const btn = document.createElement("button");
      btn.className = "team-tab" + (i === activeTeam ? " active" : "");
      btn.innerHTML = `${label}<span class="count">${teamMembers(i).length}人</span>`;
      btn.disabled = locked;
      btn.addEventListener("click", () => {
        if (locked) return;
        activeTeam = i;
        buildPartyDock();
        renderDock();
      });
      tabs.appendChild(btn);
    });
  }

  function renderAutoRepeatRow() {
    const row = document.getElementById("autoRepeatRow");
    if (!row) return;
    row.innerHTML = "";
    const locked = isDockLocked();
    const canStart = !!(run && run.dungeon);

    const label = document.createElement("div");
    label.className = "auto-repeat-label";
    label.textContent = "自動周回";
    row.appendChild(label);

    if (autoRepeatActive) {
      const status = document.createElement("div");
      status.className = "auto-repeat-status";
      status.textContent = `${autoRepeatDone}/${autoRepeatTarget} 周`;
      row.appendChild(status);
    } else {
      const chips = document.createElement("div");
      chips.className = "auto-repeat-chips";
      for (const n of AUTO_REPEAT_OPTIONS) {
        const chip = document.createElement("button");
        chip.className = "auto-repeat-chip" + (autoRepeatTarget === n ? " active" : "");
        chip.textContent = `x${n}`;
        chip.disabled = locked;
        chip.addEventListener("click", () => {
          if (isDockLocked()) return;
          autoRepeatTarget = n;
          localStorage.setItem(AUTO_REPEAT_TARGET_KEY, String(n));
          renderAutoRepeatRow();
        });
        chips.appendChild(chip);
      }
      row.appendChild(chips);
    }

    const btn = document.createElement("button");
    btn.className = "btn small " + (autoRepeatActive ? "ghost" : "primary");
    btn.textContent = autoRepeatActive ? "停止" : "自動周回開始";
    btn.disabled = autoRepeatActive ? false : (locked || !canStart);
    if (!autoRepeatActive && !canStart) btn.title = "先にダンジョンへ出撃してください";
    btn.addEventListener("click", () => {
      if (autoRepeatActive) {
        autoRepeatActive = false;
        logLine("自動周回を停止しました", "system");
        renderDock();
        return;
      }
      if (isDockLocked() || !canStart) return;
      autoRepeatActive = true;
      autoRepeatDone = 0;
      startDungeon(run.dungeon.id);
    });
    row.appendChild(btn);
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
  function updateAutoDisassembleButton() {
    const locked = isDockLocked();
    const btn = document.getElementById("btnAutoDisassembleToggle");
    btn.textContent = autoDisassemble ? "自動分解 ON" : "自動分解 OFF";
    btn.classList.toggle("toggle-on", autoDisassemble);
    btn.disabled = locked;
    btn.title = locked ? "探索中は変更できません" : "";
    document.getElementById("disassembleFilterRow").classList.toggle("hidden", !autoDisassemble);
  }
  document.getElementById("btnAutoDisassembleToggle").addEventListener("click", () => {
    if (isDockLocked()) return;
    autoDisassemble = !autoDisassemble;
    localStorage.setItem(AUTO_DISASSEMBLE_KEY, autoDisassemble ? "1" : "0");
    updateAutoDisassembleButton();
  });
  function renderDisassembleFilter() {
    const locked = isDockLocked();
    const row = document.getElementById("disassembleFilterRow");
    row.innerHTML = `<span class="disassemble-filter-label">対象${locked ? "（探索中は変更不可）" : ""}:</span>`;
    for (const rarity of RARITIES) {
      const chip = document.createElement("button");
      const on = autoDisassembleRarities.has(rarity.key);
      chip.className = "disassemble-chip" + (on ? " active" : "");
      chip.textContent = rarity.key.toUpperCase();
      chip.title = rarity.name;
      chip.disabled = locked;
      if (on) chip.style.background = rarity.color;
      chip.addEventListener("click", () => {
        if (isDockLocked()) return;
        if (autoDisassembleRarities.has(rarity.key)) autoDisassembleRarities.delete(rarity.key);
        else autoDisassembleRarities.add(rarity.key);
        saveAutoDisassembleFilter();
        renderDisassembleFilter();
      });
      row.appendChild(chip);
    }
  }
  renderDisassembleFilter();
  updateAutoDisassembleButton();
  renderAutoRepeatRow();
  document.getElementById("btnRedeploy").addEventListener("click", () => {
    if (isDockLocked() || !run) return;
    startDungeon(run.dungeon.id);
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
  function mpCostFor(c, ability) {
    const mult = racePassive(c, "mpCostMult") || 1;
    return Math.max(0, Math.round(ability.mpCost * mult));
  }

  // アビリティ優先度: 3=優先 / 2=通常(既定) / 1=温存（他に使えるものがない時だけ使う）
  const ABILITY_TIERS = [
    { value: 3, label: "優先" },
    { value: 2, label: "通常" },
    { value: 1, label: "温存" },
  ];
  function getAbilityTier(c, abilityId) {
    return (c.abilityPriority && c.abilityPriority[abilityId]) || 2;
  }
  function cycleAbilityTier(c, abilityId) {
    if (!c.abilityPriority) c.abilityPriority = {};
    const cur = getAbilityTier(c, abilityId);
    const idx = ABILITY_TIERS.findIndex((t) => t.value === cur);
    c.abilityPriority[abilityId] = ABILITY_TIERS[(idx + 1) % ABILITY_TIERS.length].value;
  }

  // 敵ターゲット優先度
  const TARGET_MODES = [
    { value: "weakest", label: "弱い敵から" },
    { value: "strongest", label: "強い敵から" },
    { value: "random", label: "ランダム" },
  ];

  function chooseAction(c) {
    const abilities = availableAbilities(c).filter((a) => isSkillActive(c, a.id) && c.mp >= mpCostFor(c, a));
    const usable = abilities.filter((a) => {
      if (a.kind !== "heal") return true;
      if (a.target === "single-ally") return activeParty().some((p) => p.alive && p.hp < computeStats(p).maxHp * 0.8);
      if (a.target === "all-ally") return activeParty().filter((p) => p.alive).some((p) => p.hp < computeStats(p).maxHp * 0.7);
      return true;
    });
    if (usable.length === 0) return BASIC_ATTACK;
    usable.sort((a, b) => {
      const tierDiff = getAbilityTier(c, b.id) - getAbilityTier(c, a.id);
      if (tierDiff !== 0) return tierDiff;
      return b.reqLevel - a.reqLevel;
    });
    return usable[0];
  }

  function pickEnemyTarget(c) {
    const alive = battle.enemies.filter((e) => e.alive);
    if (alive.length === 0) return null;
    const mode = (c && c.targetPriority) || "weakest";
    if (mode === "random") return alive[Math.floor(Math.random() * alive.length)];
    if (mode === "strongest") return alive.reduce((hi, e) => (e.hp > hi.hp ? e : hi), alive[0]);
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
    c.mp = Math.max(0, c.mp - mpCostFor(c, ability));
    const stats = computeStats(c);
    let targets = [];
    if (ability.target === "single") { const t = pickEnemyTarget(c); if (t) targets = [t]; }
    else if (ability.target === "single-ally") { const t = pickAllyTarget(); if (t) targets = [t]; }
    else if (ability.target === "all-enemy") targets = battle.enemies.filter((e) => e.alive);
    else if (ability.target === "all-ally") targets = activeParty().filter((p) => p.alive);

    const lifesteal = racePassive(c, "lifesteal") + (ability.lifesteal || 0);
    for (const t of targets) {
      for (let h = 0; h < ability.hits; h++) {
        if (ability.kind === "heal") {
          const s = computeStats(t);
          const healMult = 1 + racePassive(c, "healBonus");
          const amount = Math.max(1, Math.round(stats.mag * ability.power * healMult * rand(0.9, 1.1)));
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
        c.expToNext = expForLevel(c.level);
        const s = computeStats(c);
        c.hp = s.maxHp; c.mp = s.maxMp;
        run.levelUps.push(c.name + " Lv." + c.level);
        for (const a of jobDef(c).abilities) {
          if (a.reqLevel === c.level) run.abilityUnlocks.push(`${c.name}が「${a.name}」を習得！`);
        }
      }
      // 転職してもレベルを保持できるよう、現在のジョブの進行を都度書き戻す
      if (!c.isMonster) c.jobLevels[c.job] = { level: c.level, exp: c.exp, expToNext: c.expToNext };
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
    if (autoDisassemble && autoDisassembleRarities.has(item.rarity)) {
      addMaterial(item.materialValue);
      run.disassembleCount += 1;
      run.materialGained += item.materialValue;
      return;
    }
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
    if (run.disassembleCount > 0) {
      logLine(`自動分解: ${run.disassembleCount}個（+強化石${run.materialGained}）　所持強化石 ${material}`, "system");
    }

    scrollLog();
    restoreParty();
    buildPartyDock();
    renderDock();

    if (autoRepeatActive) {
      if (run.wiped) {
        autoRepeatActive = false;
        logLine("パーティが全滅したため自動周回を停止しました", "system");
        renderDock();
      } else {
        autoRepeatDone += 1;
        if (autoRepeatDone >= autoRepeatTarget) {
          autoRepeatActive = false;
          logLine(`自動周回が完了しました（${autoRepeatDone}周）`, "system");
          renderDock();
        } else {
          logLine(`自動周回 ${autoRepeatDone}/${autoRepeatTarget} 周完了。次のダンジョンへ出発します…`, "system");
          renderAutoRepeatRow();
          const nextId = run.dungeon.id;
          scheduleNext(() => startDungeon(nextId), 1400);
        }
      }
    }
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
    const plusText = item.plus > 0 ? `+${item.plus}` : "";
    return `${item.name}${plusText}（${STAT_LABELS[item.stat]}+${itemEffectiveValue(item)}）`;
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

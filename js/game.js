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
      abilityPriority: {}, // abilityId -> 1(温存)/2(通常)/3(優先)、既定2
      targetPriority: "weakest", // weakest / strongest / random
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

  // ---------- パーティ一覧（編成画面） ----------
  const expandedTeams = new Set([0]);
  let benchExpanded = true;
  let detailCharId = null;

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

  function openCreatePick(field) {
    const title = document.getElementById("createPickTitle");
    const body = document.getElementById("createPickBody");
    body.innerHTML = "";
    title.textContent = field === "race" ? "しゅぞくを選ぶ" : "ジョブを選ぶ";
    const ids = field === "race" ? PLAYER_RACE_IDS : Object.keys(JOBS);
    for (const id of ids) {
      const def = field === "race" ? RACES[id] : JOBS[id];
      const sub = field === "race" ? def.desc : def.abilities.map((a) => `${a.name}(Lv.${a.reqLevel})`).join(" / ");
      const row = document.createElement("button");
      row.className = "create-row create-pick-option" + (draft[field] === id ? " active" : "");
      row.innerHTML = `
        <div class="cr-main">
          <div class="cr-value">${def.name}</div>
          <div class="cr-sub">${sub}</div>
        </div>
        <div class="cr-chev">${draft[field] === id ? "✓" : "›"}</div>`;
      row.addEventListener("click", () => {
        draft[field] = id;
        renderCreateScreen();
        showScreen("screen-create");
      });
      body.appendChild(row);
    }
    showScreen("screen-create-pick");
  }

  document.getElementById("btnCreatePickBack").addEventListener("click", () => showScreen("screen-create"));

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
    renderCharDetail();
    showScreen("screen-chardetail");
  }

  function renderCharDetail() {
    const c = roster.find((x) => x.id === detailCharId);
    if (!c) { showScreen("screen-jobs"); return; }
    const wrap = document.getElementById("detailBody");
    wrap.innerHTML = "";
    document.getElementById("detailName").textContent =
      `${c.name}${c.isMonster ? "（テイム）" : ""}`;

    {
      const card = document.createElement("div");
      card.className = "job-char-card";

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
            renderCharDetail();
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
        noneBtn.addEventListener("click", () => { c.subAbilityId = null; renderCharDetail(); });
        subPickRow.appendChild(noneBtn);
      }

      for (const a of candidates) {
        const btn = document.createElement("button");
        btn.className = "sub-pick" + (c.subAbilityId === a.id ? " active" : "");
        btn.textContent = a.name;
        btn.addEventListener("click", () => { c.subAbilityId = a.id; renderCharDetail(); });
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
      skillRow.textContent = "オート戦闘で使うスキル（OFFで不使用、優先度で使う順番を調整）";
      const skillListWrap = document.createElement("div");
      skillListWrap.className = "skill-list";
      for (const a of availableAbilities(c)) {
        const on = isSkillActive(c, a.id);
        const line = document.createElement("div");
        line.className = "skill-line";

        const onBtn = document.createElement("button");
        onBtn.className = "skill-toggle" + (on ? " on" : "");
        onBtn.textContent = `${a.name} ${on ? "ON" : "OFF"}`;
        onBtn.addEventListener("click", () => {
          c.skillActive[a.id] = !isSkillActive(c, a.id);
          renderCharDetail();
        });
        line.appendChild(onBtn);

        const tier = getAbilityTier(c, a.id);
        const tierInfo = ABILITY_TIERS.find((t) => t.value === tier);
        const tierBtn = document.createElement("button");
        tierBtn.className = "priority-chip tier-" + tier + (on ? "" : " dim");
        tierBtn.textContent = tierInfo.label;
        tierBtn.title = "タップで優先度を切り替え（優先→通常→温存）";
        tierBtn.addEventListener("click", () => {
          cycleAbilityTier(c, a.id);
          renderCharDetail();
        });
        line.appendChild(tierBtn);

        skillListWrap.appendChild(line);
      }
      const locked = jobDef(c).abilities.filter((a) => c.level < a.reqLevel);
      for (const a of locked) {
        const span = document.createElement("div");
        span.className = "skill-line";
        span.style.opacity = "0.35";
        span.textContent = `${a.name}（Lv.${a.reqLevel}で習得）`;
        skillListWrap.appendChild(span);
      }

      const targetRow = document.createElement("div");
      targetRow.className = "sub-ability-row";
      targetRow.textContent = "攻撃対象の優先度（単体を狙う技・通常攻撃に適用）";
      const targetPickRow = document.createElement("div");
      targetPickRow.className = "sub-pick-row";
      for (const mode of TARGET_MODES) {
        const btn = document.createElement("button");
        btn.className = "sub-pick" + (c.targetPriority === mode.value ? " active" : "");
        btn.textContent = mode.label;
        btn.addEventListener("click", () => { c.targetPriority = mode.value; renderCharDetail(); });
        targetPickRow.appendChild(btn);
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
      card.appendChild(skillListWrap);
      card.appendChild(targetRow);
      card.appendChild(targetPickRow);
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

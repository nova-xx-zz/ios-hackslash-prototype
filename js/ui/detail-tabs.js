// ---------- 画面: キャラ詳細: 能力値・ジョブ・合成・スキルタブ ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- 詳細: 能力値タブ ----------
function buildStatsTab(c) {
  const wrap = document.createElement("div");
  const race = RACES[c.race];
  const stats = computeStats(c);

  const rank = QPCore.stats.ivRank(c.ivs);
  // モンスターの見出しは「名前 個体S〜D Lv.X」に整理し、種族・職業・テイム表記を省く。
  // 人間の見出しは従来の表記を変更しない。
  const name = `${c.favorite ? "★" : ""}${escapeHtml(c.name)}`;
  const rankBadge = rank ? ` <span class="iv-rank iv-${rank}" title="個体値の評価">個体${rank}</span>` : "";
  const heading = c.isMonster
    ? `${name}${rankBadge} Lv.${c.level}`
    : `${name} — ${race.name}・${jobDef(c).name} Lv.${c.level}${rankBadge}`;
  wrap.innerHTML = `<div class="cname">${heading}</div>
    <div class="sub-ability-row">${race.desc}</div>`;

  // テイムしたモンスターはお気に入りにできる（お気に入りは合成の素材に選べなくなる）
  if (c.isMonster) {
    const fav = document.createElement("button");
    fav.className = "equip-choice favorite-toggle" + (c.favorite ? " on" : "");
    fav.textContent = c.favorite ? "★ お気に入り（合成の素材にしない）" : "☆ お気に入りにする（合成の素材にしない）";
    fav.addEventListener("click", () => { c.favorite = !c.favorite; renderCharDetail(); });
    wrap.appendChild(fav);
  }

  const partyLabel = document.createElement("div");
  partyLabel.className = "sub-ability-row";
  partyLabel.textContent = "所属パーティ";
  wrap.appendChild(partyLabel);

  const activeRow = document.createElement("div");
  activeRow.className = "job-pick-row";
  const benchLocked = c.team !== null && isTeamLocked(c.team);
  const benchBtn = document.createElement("button");
  benchBtn.className = "job-pick" + (c.team === null ? " active" : "") + (benchLocked ? " disabled" : "");
  benchBtn.textContent = "控え";
  benchBtn.addEventListener("click", () => {
    if (benchLocked) return;
    c.team = null; renderCharDetail();
  });
  activeRow.appendChild(benchBtn);
  for (let i = 0; i < TEAM_LABELS.length; i++) {
    const btn = document.createElement("button");
    const atCap = c.team !== i && teamMembers(i).length >= MAX_ACTIVE;
    const destLocked = c.team !== i && isTeamLocked(i);
    const srcLocked = c.team !== null && c.team !== i && isTeamLocked(c.team);
    const disabled = atCap || destLocked || srcLocked;
    btn.className = "job-pick" + (c.team === i ? " active" : "") + (disabled ? " disabled" : "");
    btn.textContent = TEAM_LABELS[i];
    btn.addEventListener("click", () => {
      if (disabled) return;
      c.team = i;
      c.group = null; // パーティに入ったら未編成グループからは外れる
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
    ["HP", stats.maxHp, "hp"], ["MP", stats.maxMp, "mp"],
    ["ATK", stats.atk, "atk"], ["MAG", stats.mag, "mag"],
    ["DEF", stats.def, "def"], ["SPD", Math.round(stats.spd * 10) / 10, "spd"],
  ];
  // テイムしたモンスターは、個体値が高い能力値に▲（1.05倍以上）、低い能力値に▼（0.95倍以下）
  const ivMark = (k) => {
    const v = c.ivs && c.ivs[k];
    if (!v) return "";
    if (v >= 1.05) return ' <span class="iv-mark up" title="個体値が高い">▲</span>';
    if (v <= 0.95) return ' <span class="iv-mark down" title="個体値が低い">▼</span>';
    return "";
  };
  statBox.innerHTML = rows.map(([k, v, key]) => `<div class="detail-stat-row"><span>${k}${ivMark(key)}</span><span>${v}</span></div>`).join("");
  wrap.appendChild(statBox);
  if (c.ivs) {
    const note = document.createElement("div");
    note.className = "sub-ability-row";
    note.textContent = "個体値: テイムした時に能力値ごとに決まる個体差（0.9〜1.1倍）。同じ種族を合成すると、素材の方が高い能力値が少しずつ上がります";
    wrap.appendChild(note);
  }
  // ひとり旅の加護（特殊職。docs/special-job-design.md §4）: 説明と、効いているかどうか
  const soloDef = !c.isMonster && JOBS[c.job] && JOBS[c.job].soloBonus;
  if (soloDef) {
    const on = !!soloBonus(c);
    const note = document.createElement("div");
    note.className = "sub-ability-row solo-bonus" + (on ? " on" : "");
    note.textContent = `ひとり旅の加護: チームが${jobDef(c).name}1人だけのとき ATK+${Math.round(soloDef.atkPct * 100)}%・受けるダメージ−${Math.round((1 - soloDef.dmgTakenMult) * 100)}%` +
      (on ? "（発動中。能力値に反映済み）" : "（今は発動していません）");
    wrap.appendChild(note);
  }

  // パッシブは「設定する技」ではなく常時発動する効果なので能力値の直下へ配置。
  // 効果は既存のcomputeStats/treePassiveから計算済みで、ここでは参照表示しかしない。
  const passiveSection = document.createElement("section");
  passiveSection.className = "stats-passive-section";
  const passiveTitle = document.createElement("div");
  passiveTitle.className = "detail-section-head";
  passiveTitle.textContent = "パッシブスキル";
  passiveSection.appendChild(passiveTitle);
  const passiveNote = document.createElement("p");
  passiveNote.className = "gambit-hint";
  passiveNote.textContent = "習得中の効果は常時有効です。能力値などには反映済みです。";
  passiveSection.appendChild(passiveNote);
  passiveSection.appendChild(gambitPassives(c));
  wrap.appendChild(passiveSection);

  return wrap;
}

// 特殊職の解放の条件の文（docs/special-job-design.md §6）
function specialJobUnlockText(job) {
  const u = job.unlock || {};
  if (u.testOpen) return "テスト中は条件なしで転職できる";
  const d = u.cleared ? getDungeon(u.cleared) : null;
  const name = d ? d.name : u.cleared;
  const product = SHOP_PRODUCTS.find((p) => p.kind === "unlock" && p.unlock === u.purchase);
  const onSale = product && Shop.products().includes(product);
  return activeJobWindow(job.id, Date.now())
    ? `無料キャンペーン中: 「${name}」（ノーマル）を踏破すると解放（解放後はずっと使える）`
    : onSale ? `「${name}」（ノーマル）の踏破後、ショップで解放できる` : `「${name}」（ノーマル）の踏破が必要。解放の方法は今後お知らせします`;
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
    <div class="job-card-icon">${jobInsignia(jobId)}</div>
    <div class="job-card-level">${trained ? `Lv.${lvl}${mastered ? '<span class="star">★</span>' : ""}` : "未経験"}</div>
    <div class="job-card-name${job.name.length >= 8 ? " long" : ""}">${job.name}</div>
    <div class="job-card-exp-bar"><div class="fill" style="width:${pct}%"></div></div>`;
  if (!unlocked) card.title = job.tier === "special" ? specialJobUnlockText(job)
    : jobId === "swordmaster" && isFeatureEnabled("jobTrialSwordmaster") ? "せんしLv50＋実績＋剣豪の試練で解放"
    : `${JOBS[job.requires.job].name} Lv.${job.requires.level}で解放`;
  card.addEventListener("click", () => {
    if (!unlocked) return;
    switchJob(c, jobId);
    // 新しいジョブで持てない装備・使えない装飾品の枠の装備は所持品に戻す
    const removed = normalizeCharEquip(c);
    clampVitals(c);
    if (removed > 0) flashDetailNotice(`${JOBS[jobId].name}が持てない装備${removed}個を所持品に戻しました`);
    renderCharDetail();
  });
  return card;
}

// ---------- 詳細: 合成タブ（テイムしたモンスター専用） ----------
function buildFusionTab(c) {
  const wrap = document.createElement("div");
  const desc = document.createElement("div");
  desc.className = "sub-ability-row";
  desc.textContent = "控えのモンスターを素材にして合成すると、経験値として還元されます。素材1体のEXPは、種族ごとの基本EXP（先の地方の種族ほど多い）＋素材が積み上げたEXPの半分で、同じ種族の素材は1.5倍になります（素材にしたモンスターは消滅します。装備していたアイテムは所持品に戻ります。チームに編成中のモンスターと、お気に入り（★）のモンスターは選べません）";
  wrap.appendChild(desc);

  const candidates = Inventory.fusionCandidates(c);
  for (const id of [...fusionSelection]) {
    if (!candidates.some((m) => m.id === id)) fusionSelection.delete(id);
  }

  if (candidates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sub-ability-row";
    empty.textContent = "合成できる控えのモンスターがいません";
    wrap.appendChild(empty);
    if (fusionMessage) {
      const msg = document.createElement("div");
      msg.className = "sub-ability-row";
      msg.textContent = fusionMessage;
      wrap.appendChild(msg);
    }
    return wrap;
  }

  // まとめて選ぶ: すべて／種族ごと（その種族が全部選ばれていれば外す）／選択を外す
  const bulk = document.createElement("div");
  bulk.className = "fusion-bulk-row";
  const bulkChip = (label, members) => {
    const all = members.length > 0 && members.every((m) => fusionSelection.has(m.id));
    const chip = document.createElement("button");
    chip.className = "priority-chip" + (all ? " tier-3" : "");
    chip.textContent = `${label}（${members.length}）`;
    chip.addEventListener("click", () => {
      for (const m of members) { if (all) fusionSelection.delete(m.id); else fusionSelection.add(m.id); }
      fusionMessage = "";
      fusionConfirm = false;
      renderCharDetail();
    });
    return chip;
  };
  const bulkLabel = document.createElement("span");
  bulkLabel.className = "disassemble-filter-label";
  bulkLabel.textContent = "まとめて選ぶ:";
  bulk.appendChild(bulkLabel);
  bulk.appendChild(bulkChip("すべて", candidates));
  const byRace = new Map();
  for (const m of candidates) { if (!byRace.has(m.race)) byRace.set(m.race, []); byRace.get(m.race).push(m); }
  for (const [raceKey, members] of byRace) bulk.appendChild(bulkChip(RACES[raceKey].name, members));
  if (fusionSelection.size > 0) {
    const clear = document.createElement("button");
    clear.className = "priority-chip";
    clear.textContent = "選択を外す";
    clear.addEventListener("click", () => { fusionSelection = new Set(); fusionConfirm = false; renderCharDetail(); });
    bulk.appendChild(clear);
  }
  wrap.appendChild(bulk);

  const list = document.createElement("div");
  list.className = "skill-row-list";
  for (const m of candidates) {
    const tpl = getEnemyTemplate(m.race);
    const row = document.createElement("div");
    row.className = "skill-row";
    const icon = document.createElement("div");
    icon.className = "skill-row-icon";
    icon.textContent = (tpl && tpl.icon) || "❓";
    row.appendChild(icon);
    const name = document.createElement("div");
    name.className = "skill-row-name";
    const sameRace = m.race === c.race ? "［同族×1.5］" : "";
    const mRank = QPCore.stats.ivRank(m.ivs);
    name.textContent = `${m.name}（${RACES[m.race].name}）${mRank ? " 個体" + mRank : ""} Lv.${m.level}　EXP+${Inventory.materialExp(c, m)}${sameRace}`;
    row.appendChild(name);
    const selected = fusionSelection.has(m.id);
    const toggle = document.createElement("button");
    toggle.className = "skill-toggle-circle" + (selected ? " on" : "");
    toggle.title = selected ? "タップで選択解除" : "タップで選択";
    toggle.addEventListener("click", () => {
      if (fusionSelection.has(m.id)) fusionSelection.delete(m.id);
      else fusionSelection.add(m.id);
      fusionMessage = "";
      fusionConfirm = false;
      renderCharDetail();
    });
    row.appendChild(toggle);
    list.appendChild(row);
  }
  wrap.appendChild(list);

  const selectedMonsters = candidates.filter((m) => fusionSelection.has(m.id));
  const totalExpGain = Inventory.fusionExpGain(c, selectedMonsters);

  const footer = document.createElement("div");
  footer.className = "fusion-footer";
  footer.innerHTML = `<span>選択中: ${selectedMonsters.length}体</span><span>獲得EXP: ${isMaxLevel(c) ? "+0（Lv上限）" : "+" + totalExpGain}</span>`;
  // 合成操作は一覧の末尾ではなく下部の固定アクションバーに表示する。

  // レベル上限に達したモンスターはEXPを受け取れないため、素材を無駄にしないよう合成させない。
  // ただし素材が全員同じ種族なら個体値は上がるので、合成できる（EXPは入らないことを書いておく）
  const maxed = isMaxLevel(c);
  const ivOnly = maxed && selectedMonsters.length > 0 && selectedMonsters.every((m) => m.race === c.race);
  const blocked = maxed && !ivOnly;
  const note = ivOnly ? "（上限のためEXPは入らず、個体値だけ上がる）" : "";
  const btn = document.createElement("button");
  btn.className = "btn primary";
  btn.textContent = blocked ? `Lv.${c.level}（上限）のため、同じ種族の素材だけ合成できます（個体値が上がる）`
    : selectedMonsters.length === 0 ? "素材を選んでください"
    : (fusionConfirm ? `本当に${selectedMonsters.length}体を合成する${note}（取り消せません）` : `${selectedMonsters.length}体を合成する${note}`);
  btn.disabled = blocked || selectedMonsters.length === 0;
  btn.addEventListener("click", () => {
    if (blocked || selectedMonsters.length === 0) return;
    if (!fusionConfirm) { fusionConfirm = true; armConfirm(); renderCharDetail(); return; }
    if (!confirmReady()) return;
    fusionConfirm = false;
    // 素材が装備していたアイテムは消滅させず所持品へ戻し、素材を取り除いてEXPを還元する（js/model/inventory.js）
    const result = Inventory.fuse(c, selectedMonsters);
    fusionSelection = new Set();
    fusionMessage = `${result.consumedNames.join("・")}を合成し、` + (maxed ? `${c.name}はLv上限のためEXPは入らなかった` : `${c.name}はEXP+${result.expGain}を獲得した`) +
      (result.returnedItems ? `／素材の装備${result.returnedItems}個は所持品に戻した` : "") +
      (result.levelUps.length ? "／" + result.levelUps.join("・") : "") +
      (result.ivRaised.length ? `／個体値が上がった: ${result.ivRaised.map((k) => STAT_LABELS[k]).join("・")}` : "") +
      (result.abilityUnlocks.length ? "／" + result.abilityUnlocks.join("・") : "");
    saveGame(); // 素材の消滅は取り消せないため、遅延保存を待たずに確定させる
    renderCharDetail();
  });
  const actionBar = document.getElementById("detailActionBar");
  actionBar.appendChild(footer);
  actionBar.appendChild(btn);
  actionBar.classList.remove("hidden");

  if (fusionMessage) {
    const msg = document.createElement("div");
    msg.className = "sub-ability-row";
    msg.textContent = fusionMessage;
    wrap.appendChild(msg);
  }

  return wrap;
}

// 剣豪だけの試験導線。既存転職・通常ダンジョン・報酬・ショップには影響させない。
function buildSwordmasterTrialPilot(c) {
  const pilot = QPCore.jobTrialSwordmaster;
  const st = pilot.status(S, c, true);
  const box = document.createElement("div");
  box.className = "sub-ability-row";
  const name = document.createElement("strong");
  name.textContent = "剣豪の試練（試験モード）";
  box.appendChild(name);
  const info = document.createElement("div");
  const hit = Math.min(st.progress.warriorHits, pilot.HIT_TARGET);
  const clear = Math.min(st.progress.warriorClears, pilot.CLEAR_TARGET);
  info.textContent = `せんしLv.${st.level}/${pilot.LEVEL_TARGET} ／ 有効打 ${hit}/${pilot.HIT_TARGET} または 成功踏破 ${clear}/${pilot.CLEAR_TARGET}`;
  box.appendChild(info);
  const explanation = document.createElement("div");
  explanation.textContent = st.progress.trialCleared || st.legacy ? "解放条件達成済み。対応する基本職がLv50の仲間は転職可能です。"
    : "Lv50＋実績で試練に挑戦できます。戦闘は完全自動、試練のEXP・戦利品・通常踏破は付与しません。";
  box.appendChild(explanation);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "detail-tab";
  btn.style.marginTop = "10px";
  btn.textContent = "剣豪の試練に挑戦";
  const busy = c.team !== null && isTeamLocked(c.team);
  btn.disabled = !st.trialAvailable || c.job !== "warrior" || c.team === null || busy;
  btn.addEventListener("click", () => {
    if (!pilot.status(S, c, true).trialAvailable || c.team === null || isTeamLocked(c.team)) return;
    if (!teamMembers(c.team).some((member) => member.id === c.id && member.job === "warrior")) {
      flashDetailNotice("試練はせんし本人をチームに編成して挑戦してください");
      renderCharDetail();
      return;
    }
    const trial = pilot.trialDungeon(getDungeon("lava_river"));
    if (!trial) {
      flashDetailNotice("試練の敵データを読み込めませんでした");
      renderCharDetail();
      return;
    }
    btn.disabled = true; // 多重クリックを抑止
    let result;
    try {
      result = Runner.computeOfflineRun(trial, c.team, { maxEnemies: 5 });
    } catch (err) {
      flashDetailNotice("試練の計算に失敗しました。再度お試しください");
      renderCharDetail();
      return;
    }
    if (!result.cleared) {
      flashDetailNotice("剣豪の試練は失敗。装備・スキルを見直して再挑戦できます");
      renderCharDetail();
      return;
    }
    const before = Object.assign({}, S.jobTrialSwordmaster);
    pilot.recordTrialClear(S);
    if (!saveGame()) {
      S.jobTrialSwordmaster = before;
      flashDetailNotice("保存できなかったため、試練の解放を確定しませんでした");
      renderCharDetail();
      return;
    }
    flashDetailNotice("剣豪の試練を突破！ 上級職「けんごう」が解放されました");
    renderCharDetail();
  });
  box.appendChild(btn);
  if (!st.trialAvailable && !st.unlocked) {
    const note = document.createElement("div");
    note.textContent = "必要条件を満たすと挑戦できます";
    box.appendChild(note);
  } else if (st.trialAvailable && c.job !== "warrior") {
    const note = document.createElement("div");
    note.textContent = "試練には、対象の仲間を「せんし」に転職させて参加してください";
    box.appendChild(note);
  } else if (st.trialAvailable && c.team === null) {
    const note = document.createElement("div");
    note.textContent = "この仲間をパーティに編成してください";
    box.appendChild(note);
  }
  return box;
}

function buildJobTab(c) {
  if (c.isMonster) return buildFusionTab(c);
  const wrap = document.createElement("div");

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

  // 購入時と新規作成時に全基本職は自動でLv.99。手動選択は不要。
  if (isFeatureEnabled("shop")) {
    const pass = document.createElement("div");
    pass.className = "sub-ability-row";
    if (Shop.hasUnlock("basicJobMaxPass")) {
      pass.textContent = "基本職育成パス：購入済み（全基本職Lv.99／新しい仲間にも自動適用）";
    } else {
      const text = document.createElement("div");
      text.textContent = "基本職育成パス：未購入（購入時に今いる仲間も全基本職Lv.99）";
      const link = document.createElement("button");
      link.type = "button";
      link.className = "btn small ghost";
      link.textContent = "ショップで確認";
      link.addEventListener("click", () => openShop("screen-chardetail", "basic_job_max_pass"));
      pass.append(text, link);
    }
    wrap.appendChild(pass);
  }

  const advHead = document.createElement("div");
  advHead.className = "detail-section-head";
  const advCaption = isFeatureEnabled("jobTrialSwordmaster")
    ? `上級職（基本職Lv.${JOB_MASTER_LEVEL}。けんごうのみ実績＋専用試練も必要）`
    : `上級職（対応する基本職をLv.${JOB_MASTER_LEVEL}まで極めると転職できる）`;
  advHead.innerHTML = `<span>${advCaption}</span><span class="count">${masteredCount(advIds)}/${advIds.length}</span>`;
  wrap.appendChild(advHead);

  const advGrid = document.createElement("div");
  advGrid.className = "job-card-grid";
  for (const jobId of advIds) advGrid.appendChild(buildJobCard(c, jobId, jobUnlocked(c, jobId)));
  wrap.appendChild(advGrid);
  if (isFeatureEnabled("jobTrialSwordmaster")) wrap.appendChild(buildSwordmasterTrialPilot(c));

  // 特殊職（機能フラグ specialJobs が有効な間だけ。docs/special-job-design.md）
  const specialIds = SPECIAL_JOB_IDS.filter(jobUsable);
  if (specialIds.length) {
    const spHead = document.createElement("div");
    spHead.className = "detail-section-head";
    spHead.innerHTML = `<span>特殊職（テスト中）</span><span class="count">${specialIds.filter((id) => jobUnlocked(c, id)).length}/${specialIds.length}</span>`;
    wrap.appendChild(spHead);
    const spGrid = document.createElement("div");
    spGrid.className = "job-card-grid";
    for (const jobId of specialIds) spGrid.appendChild(buildJobCard(c, jobId, jobUnlocked(c, jobId)));
    wrap.appendChild(spGrid);
    for (const jobId of specialIds) {
      const note = document.createElement("div");
      note.className = "sub-ability-row";
      note.textContent = `${JOBS[jobId].name}: ` + (jobUnlocked(c, jobId) ? "解放済み。" : "未解放。" + specialJobUnlockText(JOBS[jobId]) + "。") +
        "1人だけのチームで強くなる（ひとり旅の加護）";
      wrap.appendChild(note);
    }
  }

  return wrap;
}

// ---------- 詳細: スキルタブ ----------
const ABILITY_KIND_ICONS = { physical: "⚔️", magic: "🔥", heal: "✨", buff: "📯", exploration: "🗝️" };
const FX_STAT_NAMES = { atk: "攻撃", mag: "魔力", def: "防御", spd: "素早さ" };
// 技の名前の横に付ける小さな印（属性・弱体・強化・防御無視）
function abilityTags(a) {
  const tags = [];
  const el = a.element || (a.imbue && a.imbue.element);
  if (el) tags.push([`el-${el}`, `${ELEMENTS[el]}${a.imbue ? "付与" : ""}`]);
  if (a.debuff) tags.push(["fx", `${FX_STAT_NAMES[a.debuff.stat]}↓`]);
  if (a.buff) tags.push(["fx", `${FX_STAT_NAMES[a.buff.stat]}↑`]);
  if (a.pierce) tags.push(["fx", "防御無視"]);
  return tags.map(([cls, text]) => `<span class="skill-tag ${cls}">${text}</span>`).join("");
}

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
  name.insertAdjacentHTML("beforeend", abilityTags(a));
  if (a.desc) name.title = a.desc;
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

let editingTacticId = null;

// 技の実際の習得条件が満たされているものだけを選択候補にする。
// ここに登録するだけで他職の未育成技やツリー未取得技を解放しない。
function gambitAbilityPool(c) {
  const job = jobDef(c);
  const list = (job.abilities || []).filter((a) => c.level >= a.reqLevel);
  if (!c.isMonster) {
    list.push(...subAbilityCandidates(c));
    const tree = getExclusiveTree(c);
    if (tree) {
      const ranks = getTreeState(c).exclusiveRanks;
      for (const node of tree.nodes) {
        if (node.kind === "active" && node.ability && (ranks[node.id] || 0) > 0) list.push(node.ability);
      }
    }
  }
  return [...new Map(list.map((a) => [a.id, a])).values()];
}

function gambitEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
function gambitButton(label, fn, disabled, className) {
  const btn = gambitEl("button", className || "gambit-btn", label);
  btn.type = "button";
  btn.disabled = !!disabled;
  btn.addEventListener("click", fn);
  return btn;
}
function gambitSelect(options, selected, change) {
  const el = gambitEl("select", "gambit-select");
  for (const item of options) {
    const opt = gambitEl("option", "", item.label);
    opt.value = item.value;
    el.appendChild(opt);
  }
  el.value = String(selected);
  el.addEventListener("change", () => change(el.value));
  return el;
}
function gambitRevealEditor() {
  const panel = document.getElementById("gambitRuleEditor");
  if (panel && typeof panel.scrollIntoView === "function") {
    panel.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
}
function gambitOpenEditor(c, rule) {
  editingTacticId = rule.id;
  renderCharDetail();
  // 旧実装は一覧の最下部に編集欄があり、押しても見えなかった。
  // 行の直下に開いた編集欄をその場で見える範囲へ移動する。
  gambitRevealEditor();
}
function gambitConditionText(rule) {
  switch (rule.condition) {
    case "always": return "常に";
    case "allyHpLte": return "味方HP ≤ " + rule.value + "%";
    case "selfHpLte": return "自分HP ≤ " + rule.value + "%";
    case "enemyHpLte": return "敵HP ≤ " + rule.value + "%";
    case "selfMpGte": return "自分MP ≥ " + rule.value + "%";
    case "enemyCountGte": return "敵 " + rule.value + "体以上";
    default: return "状況に応じて";
  }
}
function gambitCommit(c) {
  c.tacticsRules = QPCore.tactics.normalizeRules(c.tacticsRules) || [];
  renderCharDetail();
  if (editingTacticId) gambitRevealEditor();
}
// ガンビットの編集中にスキルの性能を確認するための閲覧専用パネル。
// ツリー/ジョブ側と同じ ability マスターから表示し、効果値を別途複製しない。
function gambitAbilityDetail(c, ability) {
  const box = gambitEl("section", "gambit-ability-detail");
  box.setAttribute("aria-label", "選択中のスキル詳細");
  if (!ability) {
    box.appendChild(gambitEl("div", "gambit-ability-warning", "このスキルは現在習得していないか、使用できません。"));
    return box;
  }
  const kinds = { physical: "物理攻撃", magic: "魔法攻撃", heal: "回復", buff: "補助" };
  const targets = { single: "敵単体", "all-enemy": "敵全体", "single-ally": "味方単体", "all-ally": "味方全体", self: "自分" };
  const elements = {
    fire: "火", water: "水", wind: "風", earth: "土", thunder: "雷", lightning: "雷",
    light: "光", dark: "闇", poison: "毒", ice: "氷", holy: "聖", curse: "呪", void: "虚無"
  };
  const head = gambitEl("div", "gambit-ability-head");
  head.appendChild(gambitEl("strong", "gambit-ability-name", ability.name || "名前未設定"));
  head.appendChild(gambitEl("span", "gambit-ability-kind", kinds[ability.kind] || "スキル"));
  box.appendChild(head);
  box.appendChild(gambitEl("p", "gambit-ability-desc", ability.desc || "スキル説明は未設定です。"));
  const specs = gambitEl("div", "gambit-ability-specs");
  function spec(label, value) {
    const cell = gambitEl("div", "gambit-ability-spec");
    cell.appendChild(gambitEl("span", "gambit-ability-spec-label", label));
    cell.appendChild(gambitEl("strong", "", String(value)));
    specs.appendChild(cell);
  }
  if (Number.isFinite(ability.mpCost)) {
    // 実際のMP消費は種族・ツリー・装備による軽減/増加を考慮する。
    const actual = typeof mpCostFor === "function" ? mpCostFor(c, ability) : ability.mpCost;
    const value = Number.isFinite(actual) ? actual : ability.mpCost;
    spec("消費MP", value === ability.mpCost ? value : value + "（基本" + ability.mpCost + "）");
  }
  if (ability.target) spec("対象", targets[ability.target] || ability.target);
  if (ability.element) spec("属性", elements[ability.element] || ability.element);
  if (Number.isFinite(ability.power) && ability.power > 0) spec("威力係数", "×" + ability.power);
  if (Number.isFinite(ability.hits) && ability.hits > 0) spec("回数", ability.hits + "回");
  if (Number.isFinite(ability.reqLevel) && ability.reqLevel > 0) spec("必要Lv", ability.reqLevel);
  if (specs.children.length) box.appendChild(specs);
  return box;
}
function gambitEditor(c, rule, pool) {
  const panel = gambitEl("section", "gambit-editor");
  panel.id = "gambitRuleEditor";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "ルール編集");
  panel.appendChild(gambitEl("div", "gambit-editor-head", "ルール " + (c.tacticsRules.indexOf(rule) + 1) + " を編集"));
  const addField = (label, control) => {
    const field = gambitEl("label", "gambit-field");
    field.appendChild(gambitEl("span", "gambit-label", label));
    field.appendChild(control);
    panel.appendChild(field);
  };
  addField("使用するスキル", gambitSelect(
    pool.map((a) => ({ label: a.name, value: a.id })), rule.abilityId,
    (id) => { rule.abilityId = id; gambitCommit(c); }
  ));
  // 同じ行で説明と性能を確認できる。技の切替後は既存の再描画で自動更新。
  panel.appendChild(gambitAbilityDetail(c, pool.find((a) => a.id === rule.abilityId)));
  addField("発動条件", gambitSelect(
    QPCore.tactics.CONDITIONS.map((x) => ({ value: x.id, label: x.label })),
    rule.condition, (id) => { rule.condition = id; rule.value = id === "enemyCountGte" ? 3 : 20; gambitCommit(c); }
  ));
  const pct = ["allyHpLte", "selfHpLte", "enemyHpLte", "selfMpGte"].includes(rule.condition);
  const count = rule.condition === "enemyCountGte";
  if (pct || count) {
    const input = gambitEl("input", "gambit-number");
    input.type = "number"; input.min = pct ? "0" : "1"; input.max = pct ? "100" : "5";
    input.step = "1"; input.value = String(rule.value);
    input.addEventListener("change", () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) rule.value = Math.max(Number(input.min), Math.min(Number(input.max), Math.round(n)));
      gambitCommit(c);
    });
    addField(pct ? "判定する割合（%）" : "敵の数（体）", input);
  }
  if (["single", "all-enemy"].includes((pool.find((a) => a.id === rule.abilityId) || {}).target)) {
    addField("攻撃対象の選び方", gambitSelect(
      TARGET_MODES.map((x) => ({ value: x.value, label: x.label })),
      rule.targetMode, (v) => { rule.targetMode = v; gambitCommit(c); }
    ));
  }
  const actions = gambitEl("div", "gambit-editor-actions");
  actions.appendChild(gambitButton("このルールを削除", () => {
    c.tacticsRules = c.tacticsRules.filter((r) => r.id !== rule.id);
    editingTacticId = null;
    gambitCommit(c);
  }, false, "gambit-btn danger"));
  actions.appendChild(gambitButton("閉じる", () => { editingTacticId = null; renderCharDetail(); }));
  panel.appendChild(actions);
  return panel;
}
function gambitRules(c, pool) {
  const wrap = gambitEl("div", "gambit-container");
  const actions = gambitEl("div", "gambit-toolbar");
  actions.appendChild(gambitEl("div", "gambit-count", "設定中 " + c.tacticsRules.length + " / " + QPCore.tactics.MAX_RULES));
  actions.appendChild(gambitButton("＋ ルールを追加", () => {
    const candidates = pool.filter((a) => !c.tacticsRules.some((r) => r.abilityId === a.id));
    const chosen = candidates[0] || pool[0];
    if (!chosen) return;
    let num = 1;
    while (c.tacticsRules.some((r) => r.id === "rule-" + num)) num++;
    const rule = { id: "rule-" + num, abilityId: chosen.id, enabled: true, condition: "auto",
      value: 0, targetMode: TARGET_MODES.some((x) => x.value === c.targetPriority) ? c.targetPriority : "weakest" };
    c.tacticsRules.push(rule);
    gambitOpenEditor(c, rule);
  }, c.tacticsRules.length >= QPCore.tactics.MAX_RULES || pool.length === 0, "gambit-btn primary"));
  wrap.appendChild(actions);

  const list = gambitEl("div", "gambit-rule-list");
  c.tacticsRules.forEach((rule, i) => {
    const ability = pool.find((a) => a.id === rule.abilityId);
    const row = gambitEl("div", "gambit-rule" + (rule.enabled ? "" : " inactive") + (ability ? "" : " unavailable"));
    const number = gambitButton(String(i + 1), () => {
      rule.enabled = !rule.enabled;
      gambitCommit(c);
    }, false, "gambit-index" + (rule.enabled ? " on" : ""));
    number.title = "タップで" + (rule.enabled ? "OFF" : "ON") + "にする";
    number.setAttribute("aria-label", "ルール" + (i + 1) + "を" + (rule.enabled ? "OFF" : "ON") + "にする");
    row.appendChild(number);
    const trigger = gambitButton(gambitConditionText(rule) + " ✎", () => gambitOpenEditor(c, rule), false, "gambit-trigger");
    trigger.title = "発動条件を編集";
    trigger.setAttribute("aria-label", "ルール" + (i + 1) + "の発動条件を編集");
    row.appendChild(trigger);
    row.appendChild(gambitEl("div", "gambit-arrow", "→"));
    const skill = gambitButton((ability ? ability.name : "未習得・使用不可") + " ✎",
      () => gambitOpenEditor(c, rule), false, "gambit-skill");
    skill.title = "使用スキルを編集";
    skill.setAttribute("aria-label", "ルール" + (i + 1) + "の使用スキルを編集");
    row.appendChild(skill);
    const controls = gambitEl("div", "gambit-rule-controls");
    const up = gambitButton("↑", () => {
      [c.tacticsRules[i - 1], c.tacticsRules[i]] = [c.tacticsRules[i], c.tacticsRules[i - 1]];
      gambitCommit(c);
    }, i === 0, "gambit-move");
    up.setAttribute("aria-label", "ルール" + (i + 1) + "を上へ");
    controls.appendChild(up);
    const down = gambitButton("↓", () => {
      [c.tacticsRules[i], c.tacticsRules[i + 1]] = [c.tacticsRules[i + 1], c.tacticsRules[i]];
      gambitCommit(c);
    }, i === c.tacticsRules.length - 1, "gambit-move");
    down.setAttribute("aria-label", "ルール" + (i + 1) + "を下へ");
    controls.appendChild(down);
    row.appendChild(controls);
    list.appendChild(row);
    // タップした既存ルールの直後に編集欄を展開。リストの末尾には追いやらない。
    if (editingTacticId === rule.id) list.appendChild(gambitEditor(c, rule, pool));
  });
  wrap.appendChild(list);
  if (c.tacticsRules.length === 0) wrap.appendChild(gambitEl("p", "gambit-hint", "ルールがありません。通常攻撃のみを使用します。"));
  wrap.appendChild(gambitEl("p", "gambit-hint", "条件・技をタップで編集／番号でON・OFF／↑↓で順序変更。上から順に判定します。"));
  return wrap;
}
function gambitPassives(c) {
  const wrap = gambitEl("div", "gambit-passive-list");
  const passives = typeof learnedTreePassives === "function" ? learnedTreePassives(c) : [];
  const section = (name, items) => {
    const head = gambitEl("div", "detail-section-head");
    head.appendChild(gambitEl("span", "", name));
    head.appendChild(gambitEl("span", "count", items.length + "件"));
    wrap.appendChild(head);
    if (!items.length) wrap.appendChild(gambitEl("p", "gambit-hint", "現在有効な効果はありません"));
    for (const item of items) {
      const row = gambitEl("div", "gambit-passive");
      row.appendChild(gambitEl("strong", "", item.name));
      row.appendChild(gambitEl("div", "gambit-passive-desc", item.desc || "常時有効"));
      if (item.treeName) row.appendChild(gambitEl("span", "gambit-passive-source", item.treeName));
      wrap.appendChild(row);
    }
  };
  section("スキルツリー（習得中・常時有効）", passives);
  const race = RACES[c.race] || RACES.human;
  const racial = Object.keys(race.passive || {}).map((k) => ({ name: PASSIVE_LABELS[k] ? PASSIVE_LABELS[k](race.passive[k]) : k, desc: "種族特性・常時有効" }));
  if (race.expMult !== 1) racial.push({ name: "獲得経験値 " + Math.round((race.expMult - 1) * 100) + "%", desc: "種族特性・常時有効" });
  section("種族特性（常時有効）", racial);
  wrap.appendChild(gambitEl("p", "gambit-hint", "パッシブはON/OFF不要。ツリーをリセットすると表示・能力補正から自動で外れます。"));
  return wrap;
}
function buildSkillTab(c) {
  const wrap = gambitEl("div", "gambit-root");
  const legacyAbilities = availableAbilities(c);
  QPCore.tactics.migrateLegacy(c, legacyAbilities, getAbilityTier);
  const heading = gambitEl("div", "gambit-active-heading", "アクティブスキル");
  wrap.appendChild(heading);
  wrap.appendChild(gambitRules(c, gambitAbilityPool(c)));

  const exploration = (jobDef(c).explorationSkills || []);
  if (exploration.length) {
    const section = gambitEl("section", "gambit-exploration");
    section.appendChild(gambitEl("div", "detail-section-head", "探索スキル（自動発動・枠消費なし）"));
    for (const ability of exploration) {
      const trained = c.level >= ability.reqLevel;
      const text = ability.name + " ― " + (trained ? ability.desc : "Lv." + ability.reqLevel + "で習得");
      section.appendChild(gambitEl("div", "gambit-passive" + (trained ? "" : " unavailable"), text));
    }
    wrap.appendChild(section);
  }
  return wrap;
}

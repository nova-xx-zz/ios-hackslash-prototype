// ---------- 画面: キャラ詳細: 能力値・ジョブ・合成・スキルタブ ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

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
    <div class="job-card-icon">${jobInsignia(jobId)}</div>
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

// ---------- 詳細: 合成タブ（テイムしたモンスター専用） ----------
function buildFusionTab(c) {
  const wrap = document.createElement("div");
  const desc = document.createElement("div");
  desc.className = "sub-ability-row";
  desc.textContent = "控えのモンスターを素材にして合成すると、経験値として還元されます（素材にしたモンスターは消滅します。装備していたアイテムは所持品に戻ります。チームに編成中のモンスターは選べません）";
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
    name.textContent = `${m.name}（${RACES[m.race].name}） Lv.${m.level}`;
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
  const totalExpGain = Inventory.fusionExpGain(selectedMonsters);

  const footer = document.createElement("div");
  footer.className = "fusion-footer";
  footer.innerHTML = `<span>選択中: ${selectedMonsters.length}体</span><span>獲得EXP: +${totalExpGain}</span>`;
  wrap.appendChild(footer);

  const btn = document.createElement("button");
  btn.className = "btn primary";
  btn.textContent = selectedMonsters.length === 0 ? "素材を選んでください"
    : (fusionConfirm ? `本当に${selectedMonsters.length}体を合成する（取り消せません）` : `${selectedMonsters.length}体を合成する`);
  btn.disabled = selectedMonsters.length === 0;
  btn.addEventListener("click", () => {
    if (selectedMonsters.length === 0) return;
    if (!fusionConfirm) { fusionConfirm = true; renderCharDetail(); return; }
    fusionConfirm = false;
    // 素材が装備していたアイテムは消滅させず所持品へ戻し、素材を取り除いてEXPを還元する（js/model/inventory.js）
    const result = Inventory.fuse(c, selectedMonsters);
    fusionSelection = new Set();
    fusionMessage = `${result.consumedNames.join("・")}を合成し、${c.name}はEXP+${result.expGain}を獲得した` +
      (result.returnedItems ? `／素材の装備${result.returnedItems}個は所持品に戻した` : "") +
      (result.levelUps.length ? "／" + result.levelUps.join("・") : "") +
      (result.abilityUnlocks.length ? "／" + result.abilityUnlocks.join("・") : "");
    saveGame(); // 素材の消滅は取り消せないため、遅延保存を待たずに確定させる
    renderCharDetail();
  });
  wrap.appendChild(btn);

  if (fusionMessage) {
    const msg = document.createElement("div");
    msg.className = "sub-ability-row";
    msg.textContent = fusionMessage;
    wrap.appendChild(msg);
  }

  return wrap;
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

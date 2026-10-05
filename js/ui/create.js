// ---------- 画面: キャラ作成（自由ビルド） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

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
  S.roster.push(c);
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

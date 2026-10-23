// ---------- 画面: キャラ作成（自由ビルド） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- キャラ作成（自由ビルド） ----------
let draft = null;
let createReturnScreen = "screen-jobs"; // 「もどる」の戻り先（編成メニューから開いた時は screen-menu）

function openCreateScreen(returnScreen) {
  // 仲間のBOXが満員なら作れない（ショップで拡張できる）
  if (!Shop.canAddToRoster(1)) {
    flashRosterMessage(`仲間のBOXがいっぱいです（${S.roster.length}/${Shop.rosterCapacity()}人）。編成のショップでBOXを拡張できます`);
    renderJobsScreen();
    return;
  }
  createReturnScreen = returnScreen || "screen-jobs";
  const r = rollNewRecruit();
  draft = { name: r.name, race: r.race, job: r.job };
  renderCreateScreen();
  showScreen("screen-create");
  document.getElementById("createBody").scrollTop = 0; // 新規作成時は必ず名前欄から表示
}

function renderCreateScreen() {
  const wrap = document.getElementById("createBody");
  wrap.innerHTML = "";

  // 名前入力は編集可能なまま、装飾枠と羽ペンを独立したUIとして構成する。
  const nameField = document.createElement("div");
  nameField.className = "create-row create-row-name create-ornate";
  const nameHeading = document.createElement("div");
  nameHeading.className = "cr-heading";
  nameHeading.innerHTML = "<span class=\"cr-name-symbol\"><svg viewBox=\"0 0 44 44\" aria-hidden=\"true\"><path d=\"M8 36C18 29 22 24 34 7c-2 15-10 25-24 29l-4 4\" fill=\"#e8d2a1\" stroke=\"#d2ab64\" stroke-width=\"1.2\"/><path d=\"M13 31 29 13M19 26l-6-1M24 21l-1-6\" fill=\"none\" stroke=\"#573b1c\" stroke-width=\"1.5\" stroke-linecap=\"round\"/></svg></span><label class=\"cr-label\" for=\"createName\">なまえ</label>";
  nameField.appendChild(nameHeading);
  const nameRow = document.createElement("div");
  nameRow.className = "name-row";
  const inputShell = document.createElement("div");
  inputShell.className = "create-name-input-shell";
  const input = document.createElement("input");
  input.className = "name-input";
  input.id = "createName";
  input.type = "text";
  input.maxLength = 8;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = draft.name;
  input.addEventListener("input", () => {
    draft.name = input.value;
    updateCreatePreview();
  });
  inputShell.appendChild(input);
  const nameDice = document.createElement("span");
  nameDice.className = "create-name-dice";
  nameDice.setAttribute("aria-hidden", "true");
  nameDice.innerHTML = "<svg viewBox=\"0 0 34 34\" aria-hidden=\"true\"><path d=\"m17 2 13 7v16l-13 7-13-7V9Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"m17 17 13-8M17 17 4 9M17 17v15\" stroke=\"currentColor\" stroke-width=\"1.4\"/><circle cx=\"10\" cy=\"12\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"22\" cy=\"12\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"24\" cy=\"23\" r=\"1.4\" fill=\"currentColor\"/><circle cx=\"11\" cy=\"23\" r=\"1.4\" fill=\"currentColor\"/></svg>";
  inputShell.appendChild(nameDice);
  nameRow.appendChild(inputShell);
  const reroll = document.createElement("button");
  reroll.type = "button";
  reroll.className = "pick-chip create-name-reroll";
  reroll.textContent = "別の名前";
  reroll.addEventListener("click", () => {
    draft.name = rollNewRecruit().name;
    renderCreateScreen();
  });
  nameRow.appendChild(reroll);
  nameField.appendChild(nameRow);
  wrap.appendChild(nameField);

  // 種族・ジョブの情報は変えず、紋章と金縁の選択帯で表現する。
  wrap.appendChild(buildCreatePickRow("しゅぞく", RACES[draft.race].name, RACES[draft.race].desc, () => openCreatePick("race"), "race", draft.race));
  const jobSub = JOBS[draft.job].abilities.map((a) => `${a.name}(Lv.${a.reqLevel})`).join(" / ");
  wrap.appendChild(buildCreatePickRow("ジョブ", JOBS[draft.job].name, jobSub, () => openCreatePick("job"), "job", draft.job));

  const previewShell = document.createElement("div");
  previewShell.className = "create-preview-shell create-ornate";
  const previewLabel = document.createElement("div");
  previewLabel.className = "create-section-label";
  previewLabel.textContent = "プレビュー";
  previewShell.appendChild(previewLabel);
  const box = document.createElement("div");
  box.className = "preview-box";
  box.id = "createPreview";
  box.setAttribute("aria-live", "polite");
  previewShell.appendChild(box);
  wrap.appendChild(previewShell);
  updateCreatePreview();
}


function createRaceInsignia(id) {
  const designs = {
    sylvan:'<path d="M32 53V18m0 29-15 7m15-17 15 13M32 37l-15-9m15 0 13-12M32 22 23 12m9 10L42 9M21 29l-7-11m28 13 9-14M11 55h42"/><path d="M16 53q-5-15 1-26m31 26q6-12 0-26"/>',
    stonekin:'<path d="m11 38 10-20 12-10 17 13 6 17-15 15H22Z"/><path d="m21 18 12 16 17-13M33 34l-11 19m11-19 8 19"/>',
    nocturne:'<path d="M39 9A22 22 0 1 0 53 45 24 24 0 0 1 39 9Z"/><path d="m16 12 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/>',
    beastkin:'<path d="M16 37Q10 26 20 22q7 0 12 10 6-10 13-10 10 5 4 15-7 18-17 18S23 55 16 37Z"/><circle cx="19" cy="16" r="4"/><circle cx="29" cy="11" r="4"/><circle cx="40" cy="12" r="4"/><circle cx="49" cy="17" r="4"/>',
    human:'<path d="M32 8 51 20v20L32 54 13 40V20Z"/><path d="M32 15v31m-11-18 11-9 11 9m-22 0 11 18 11-18"/>',
    artisan:'<path d="M14 47 45 16m-9-7 18 18M11 35l18 18M12 12l40 40"/>',
    spiritkin:'<path d="M32 6C16 21 16 37 32 55 48 37 48 21 32 6Z"/><path d="M10 33h44M32 12v41M19 22l26 24M45 22 19 46"/>',
    giant:'<path d="m6 50 16-34 11 19 8-14 17 29Z"/><path d="M22 16l-3 18 14 1 9 15M41 21l-6 18"/>'
  };
  return '<svg class="create-insignia-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (designs[id] || designs.human) + '</svg>';
}
function createJobInsignia(id) {
  if (id !== "thief") return jobInsignia(id);
  return '<svg class="create-insignia-svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(-43 32 32)"><path d="m29 8 3-6 3 6v30l-3 6-3-6Z"/><path d="M21 38h22M32 44v14M27 58h10"/></g><g transform="rotate(43 32 32)"><path d="m29 8 3-6 3 6v30l-3 6-3-6Z"/><path d="M21 38h22M32 44v14M27 58h10"/></g></svg>';
}

function buildCreatePickRow(label, value, sub, onClick, kind, id) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "create-row create-pick-row create-ornate";
  row.setAttribute("aria-label", `${label}：${value}。変更する`);
  const symbol = document.createElement("span");
  symbol.className = "cr-symbol cr-" + kind;
  symbol.setAttribute("aria-hidden", "true");
  if (kind === "job") symbol.innerHTML = createJobInsignia(id);
  else symbol.innerHTML = createRaceInsignia(id);
  const main = document.createElement("span");
  main.className = "cr-main";
  const head = document.createElement("span");
  head.className = "cr-top";
  const title = document.createElement("span");
  title.className = "cr-label";
  title.textContent = label;
  const select = document.createElement("span");
  select.className = "cr-select-box";
  const valueSpan = document.createElement("span");
  valueSpan.className = "cr-value";
  valueSpan.textContent = value;
  const chev = document.createElement("span");
  chev.className = "cr-chev";
  chev.setAttribute("aria-hidden", "true");
  chev.textContent = "›";
  select.appendChild(valueSpan);
  select.appendChild(chev);
  head.appendChild(title);
  head.appendChild(select);
  const desc = document.createElement("span");
  desc.className = "cr-sub";
  desc.textContent = sub;
  main.appendChild(head);
  main.appendChild(desc);
  row.appendChild(symbol);
  row.appendChild(main);
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
  // 特殊職は上級職と比べる（特殊職だけでは比べる相手がいないため）
  const group = (t) => (t === "special" ? "advanced" : t);
  const peers = Object.values(JOBS).filter((j) => group(j.tier) === group(job.tier));
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

  const pmIcon = document.getElementById("pmIcon");
  if (isJob) pmIcon.innerHTML = jobInsignia(id); else pmIcon.textContent = def.icon || "❓";
  pmIcon.classList.toggle("is-insignia", isJob);
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
    if (isJob) chip.innerHTML = jobInsignia(oid); else chip.textContent = odef.icon || "❓";
    chip.classList.toggle("is-insignia", isJob);
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
  const abilities = availableAbilities(preview).map((a) => a.name);
  const stats = [["HP", s.maxHp], ["MP", s.maxMp], ["ATK", s.atk], ["MAG", s.mag], ["DEF", s.def], ["SPD", Math.round(s.spd * 10) / 10]];
  box.innerHTML = `
    <div class="pv-art" aria-hidden="true"></div>
    <div class="pv-profile">
      <div class="pv-name">${escapeHtml(draft.name || "ななし")} <span class="pv-role">— ${escapeHtml(race.name)}・${escapeHtml(JOBS[draft.job].name)}</span></div>
      <span class="pv-level">Lv.${preview.level}</span>
    </div>
    <div class="pv-stats">${stats.map(([key, value]) => `<div class="pv-stat"><span class="pv-stat-key">${key}</span><strong>${value}</strong></div>`).join("")}</div>
    <div class="pv-details">
      <div class="pv-note"><span class="pv-note-label">種族特性</span><span>${passives.length ? passives.map(escapeHtml).join(" / ") : "なし"}</span></div>
      <div class="pv-note"><span class="pv-note-label">習得済み</span><span>${abilities.length ? abilities.map(escapeHtml).join("、") : "なし"}</span></div>
    </div>`;
}

const PASSIVE_LABELS = {
  critBonus: (v) => `会心率 +${Math.round(v * 100)}%`,
  dmgTakenMult: (v) => `被ダメージ ${Math.round((v - 1) * 100)}%`,
  lifesteal: (v) => `与ダメージの ${Math.round(v * 100)}% を吸収`,
  mpCostMult: (v) => `消費MP ${Math.round((v - 1) * 100)}%`,
  healBonus: (v) => `回復量 +${Math.round(v * 100)}%`,
};

function confirmCreate() {
  if (!Shop.canAddToRoster(1)) { renderJobsScreen(); showScreen("screen-jobs"); return null; }
  const name = (draft.name || "").trim() || "ななし";
  const c = newCharacter(name, draft.job, draft.race, { level: createStartLevel() });
  S.roster.push(c);
  benchExpanded = true;
  // 作った仲間が見えるよう、パーティ編成の画面に移る（編成メニューから来た時は、もどるで編成メニューへ）
  if (createReturnScreen === "screen-menu") jobsReturnScreen = "screen-menu";
  renderJobsScreen();
  showScreen("screen-jobs");
  return c;
}

document.getElementById("btnCreateBack").addEventListener("click", () => {
  if (createReturnScreen === "screen-menu") { openPartyMenu(); return; }
  renderJobsScreen();
  showScreen("screen-jobs");
});
document.getElementById("btnCreateRandom").addEventListener("click", () => {
  const r = rollNewRecruit();
  draft = { name: r.name, race: r.race, job: r.job };
  renderCreateScreen();
});
document.getElementById("btnCreateConfirm").addEventListener("click", () => { confirmCreate(); });

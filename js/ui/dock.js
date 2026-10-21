// ---------- 画面: 探索画面: ドック（パーティ表示・チーム切り替え・自動周回・自動分解） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- Dock ----------
function buildPartyDock() {
  const partyRow = document.getElementById("partyRow");
  partyRow.innerHTML = "";
  partyEls = {};
  for (const c of activeParty()) {
    const card = document.createElement("div");
    card.className = "actor-card";
    card.innerHTML = `
      <div class="actor-insignia">${jobInsignia(c.isMonster ? null : jobDef(c).id)}</div>
      <div class="actor-name">${escapeHtml(c.name)}</div>
      <div class="actor-job">${jobDef(c).name} Lv.${c.level}</div>
      <div class="stat-bar hp"><div class="fill" style="width:100%"></div></div>
      <div class="stat-num hpnum"></div>
      <div class="stat-bar mp"><div class="fill" style="width:100%"></div></div>
      <div class="stat-num mpnum"></div>
      <div class="stat-bar atb"><div class="fill" style="width:0%"></div></div>`;
    partyRow.appendChild(card);
    partyEls[c.id] = card;
  }
  document.getElementById("dockEmptyParty").classList.toggle("hidden", activeParty().length > 0);
  updateBattleDOM();
}

function renderDock() {
  document.getElementById("teamName").textContent = TEAM_NAMES[S.activeTeam];
  document.getElementById("materialLine").textContent = `強化石 ${S.material}`;
  const run = teamRuns[S.activeTeam];
  const running = isTeamRunActive(S.activeTeam);
  const locked = isTeamLocked(S.activeTeam);
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
  document.getElementById("dockDungeon").textContent = d ? `${d.mode ? `【${getDungeonMode(d.mode).name}】` : ""}${d.name}` : "冒険者ギルド";
  renderLogFeed(S.activeTeam);
  document.getElementById("dockStatus").textContent = !d
    ? "出発準備"
    : running ? "探索中…" : (run.wiped ? "失敗" : "踏破");
  const pct = d ? (Math.min(run.battleIndex + (running ? 0 : 1), d.battles) / d.battles) * 100 : 0;
  document.getElementById("dockProgressFill").style.width = clamp(pct, 0, 100) + "%";

  document.getElementById("btnRedeploy").disabled = locked || !d;
  document.getElementById("btnDockMap").disabled = locked;
  updateAutoDisassembleButton();
  renderDisassembleFilter();
  renderAutoRepeatRow();

  const tabs = document.getElementById("teamTabs");
  tabs.innerHTML = "";
  TEAM_LABELS.forEach((label, i) => {
    const btn = document.createElement("button");
    btn.className = "team-tab" + (i === S.activeTeam ? " active" : "") + (isTeamRunActive(i) ? " exploring" : "");
    btn.innerHTML = `${label}<span class="count">${teamMembers(i).length}人</span>`;
    btn.addEventListener("click", () => {
      if (i === S.activeTeam) return;
      S.activeTeam = i;
      buildPartyDock();
      renderDock();
      scheduleSave();
    });
    tabs.appendChild(btn);
  });
}

// renderDock()は表示中チームの操作をきっかけにしか呼ばれないため、他チームの探索状況を示す
// タブのドットが更新されないままになる。毎フレーム軽量にクラスだけ切り替えて追従させる
function updateTeamTabDots() {
  const tabs = document.getElementById("teamTabs");
  if (!tabs) return;
  const buttons = tabs.children;
  for (let i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle("exploring", isTeamRunActive(i));
  }
  // 自動分解のロックも全パーティの状態で決まるため、変わった時だけ描き直す
  if (autoDisassembleLockShown !== null && autoDisassembleLockShown !== isAutoDisassembleLocked()) {
    updateAutoDisassembleButton();
    renderDisassembleFilter();
  }
}

function renderAutoRepeatRow() {
  const row = document.getElementById("autoRepeatRow");
  if (!row) return;
  row.innerHTML = "";
  const i = S.activeTeam;
  const ar = S.autoRepeat[i];
  const run = teamRuns[i];
  const locked = isTeamLocked(i);
  const canStart = !!(run && run.dungeon);

  const label = document.createElement("div");
  label.className = "auto-repeat-label";
  label.textContent = "自動周回";
  row.appendChild(label);

  if (ar.active) {
    const status = document.createElement("div");
    status.className = "auto-repeat-status";
    status.textContent = `${ar.done}/${ar.target} 周`;
    row.appendChild(status);
  } else {
    // 回数はプルダウンで選ぶ（まだ買っていない回数は🔒付きで並べ、選ぶとショップへ案内する）
    const select = document.createElement("select");
    select.className = "auto-repeat-select";
    select.setAttribute("aria-label", "自動周回の回数");
    select.disabled = locked;
    for (const choice of Shop.autoRepeatChoices()) {
      const opt = document.createElement("option");
      opt.value = String(choice.n);
      opt.textContent = choice.locked ? `🔒 x${choice.n}（ショップ）` : `x${choice.n}`;
      if (ar.target === choice.n) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      if (isTeamLocked(i)) return;
      const n = Number(select.value);
      const choice = Shop.autoRepeatChoices().find((c) => c.n === n);
      if (!choice) return;
      if (choice.locked) {
        select.value = String(ar.target); // 選択は元に戻してからショップを開く
        openShop("screen-battle", "auto_repeat_100");
        return;
      }
      ar.target = n;
      store.set(KEYS.autoRepeatTarget, n);
    });
    row.appendChild(select);
  }

  const btn = document.createElement("button");
  btn.className = "btn small " + (ar.active ? "ghost" : "primary");
  btn.textContent = ar.active ? "停止" : "自動周回開始";
  btn.disabled = ar.active ? false : (locked || !canStart);
  if (!ar.active && !canStart) btn.title = "先にダンジョンへ出撃してください";
  btn.addEventListener("click", () => {
    if (ar.active) {
      ar.active = false;
      logLine(i, "自動周回を停止しました", "system");
      renderDock();
      return;
    }
    if (isTeamLocked(i) || !canStart) return;
    // 買っていない回数が選ばれていたら（クラウドから戻したセーブなど）、買える範囲の最大にする
    const choice = Shop.autoRepeatChoices().find((c) => c.n === ar.target);
    if (!choice || choice.locked) ar.target = Math.max(...Shop.autoRepeatChoices().filter((c) => !c.locked).map((c) => c.n));
    ar.active = true;
    ensureNotifyPermission(); // アプリ版: 初めて自動周回を始めた時に、完了通知の許可を求める
    ar.done = 0;
    startDungeon(i, run.dungeon.id, { navigate: true, mode: run.dungeon.mode });
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

// 戦闘の速さ: 持っている速さだけを x1→x2→x3→x5→x1 の順に回る（x3・x5はショップで買うと選べる）
document.getElementById("btnSpeedToggle").addEventListener("click", () => {
  speedMult = Shop.nextBattleSpeed(speedMult);
  document.getElementById("btnSpeedToggle").textContent = `x${speedMult}`;
});
// 自動分解のON/OFF・フィルターは全パーティ共通の設定で、出発のたび（自動周回の各周も）にrunへ
// スナップショットされる。どこかのパーティが探索中・自動周回中の間は、途中で設定が変わらないよう変更できなくする
function isAutoDisassembleLocked() {
  for (let i = 0; i < TEAM_COUNT; i++) if (isTeamLocked(i)) return true;
  return false;
}
let autoDisassembleLockShown = null; // 表示中のロック状態（変わった時だけ描き直すため）
function updateAutoDisassembleButton() {
  autoDisassembleLockShown = isAutoDisassembleLocked();
  const btn = document.getElementById("btnAutoDisassembleToggle");
  const open = isDisassemblePopoverOpen();
  btn.textContent = `自動分解 ${autoDisassemble ? "ON" : "OFF"} ${open ? "▴" : "▾"}`; // 対象のレア度はポップオーバーの中だけで見せる
  btn.classList.toggle("toggle-on", autoDisassemble);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}
function isDisassemblePopoverOpen() {
  return !document.getElementById("disassemblePopover").classList.contains("hidden");
}
function setDisassemblePopover(open) {
  document.getElementById("disassemblePopover").classList.toggle("hidden", !open);
  // 縦の短い画面ではポップオーバーが下のドックまで届くため、開いている間はヘッダー側をドックより手前に出す
  document.getElementById("screen-battle").classList.toggle("dpop-open", open);
  if (!open) disassembleHighConfirm = null; // 閉じたらUR・LRの確認待ちは取り消す
  renderDisassembleFilter();
  updateAutoDisassembleButton();
}
// 探索中でも中身は見られるように、ボタン自体は常に押せる（変更だけをロックする）
document.getElementById("btnAutoDisassembleToggle").addEventListener("click", (e) => {
  e.stopPropagation();
  setDisassemblePopover(!isDisassemblePopoverOpen());
});
// ポップオーバーの外をタップしたら閉じる。中のタップは描き直しで押した要素がDOMから外れ、
// document側では「外」に見えてしまうため、ポップオーバー自身で止めておく
document.getElementById("disassemblePopover").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => {
  if (isDisassemblePopoverOpen()) setDisassemblePopover(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isDisassemblePopoverOpen()) setDisassemblePopover(false);
});
// UR・LR を自動分解の対象に入れる時は2回押し（1回目で注意を出す）
const HIGH_RARITIES = ["ur", "lr"];
let disassembleHighConfirm = null; // 確認待ちのレア度キー
function renderDisassembleFilter() {
  const pop = document.getElementById("disassemblePopover");
  const locked = isAutoDisassembleLocked();
  pop.innerHTML = "";

  // 1行目: 自動分解のON/OFFスイッチ
  const master = document.createElement("button");
  master.className = "dpop-master";
  master.setAttribute("role", "switch");
  master.setAttribute("aria-checked", autoDisassemble ? "true" : "false");
  master.disabled = locked;
  master.innerHTML = `<span>自動分解</span><span class="dpop-switch${autoDisassemble ? " on" : ""}" aria-hidden="true"></span>`;
  master.addEventListener("click", () => {
    if (isAutoDisassembleLocked()) return;
    autoDisassemble = !autoDisassemble;
    store.set(KEYS.autoDisassemble, autoDisassemble ? "1" : "0");
    disassembleHighConfirm = null;
    renderDisassembleFilter();
    updateAutoDisassembleButton();
  });
  pop.appendChild(master);

  // 対象のレア度（☑形式）。OFFの間も選んでおけるが、薄く表示する
  const list = document.createElement("div");
  list.className = "dpop-list" + (autoDisassemble ? "" : " off");
  for (const rarity of RARITIES) {
    const on = autoDisassembleRarities.has(rarity.key);
    const row = document.createElement("button");
    row.className = "dpop-row" + (disassembleHighConfirm === rarity.key ? " confirming" : "");
    row.setAttribute("role", "checkbox");
    row.setAttribute("aria-checked", on ? "true" : "false");
    row.disabled = locked;
    row.innerHTML = `<span class="dpop-check${on ? " on" : ""}" aria-hidden="true">${on ? "✓" : ""}</span>` +
      `<span class="dpop-rarity" style="color:${rarity.color}">${rarity.key.toUpperCase()}</span>`;
    row.setAttribute("aria-label", rarity.name);
    row.addEventListener("click", () => {
      if (isAutoDisassembleLocked()) return;
      const turningOnHigh = !autoDisassembleRarities.has(rarity.key) && HIGH_RARITIES.includes(rarity.key);
      if (turningOnHigh && disassembleHighConfirm !== rarity.key) {
        disassembleHighConfirm = rarity.key;
        armConfirm();
        renderDisassembleFilter();
        return;
      }
      if (turningOnHigh && !confirmReady()) return;
      disassembleHighConfirm = null;
      if (autoDisassembleRarities.has(rarity.key)) autoDisassembleRarities.delete(rarity.key);
      else autoDisassembleRarities.add(rarity.key);
      saveAutoDisassembleFilter();
      renderDisassembleFilter();
      updateAutoDisassembleButton();
    });
    list.appendChild(row);
  }
  pop.appendChild(list);

  if (disassembleHighConfirm) {
    const warn = document.createElement("p");
    warn.className = "dpop-note warn";
    warn.textContent = `${disassembleHighConfirm.toUpperCase()}も自動で分解されます。よければもう一度押してください（名のある装備は分解しません）`;
    pop.appendChild(warn);
  }
  const optionNote = document.createElement("p");
  optionNote.className = "dpop-note";
  optionNote.textContent = "高品質OP・特殊OP付き装備はレア度にかかわらず自動保護（手動分解は別）";
  pop.appendChild(optionNote);
  if (locked) {
    const note = document.createElement("p");
    note.className = "dpop-note lock";
    note.textContent = "探索中・自動周回中は変更できません";
    pop.appendChild(note);
  }
}
renderDisassembleFilter();
updateAutoDisassembleButton();
renderAutoRepeatRow();
document.getElementById("btnRedeploy").addEventListener("click", () => {
  const run = teamRuns[S.activeTeam];
  if (isTeamLocked(S.activeTeam) || !run) return;
  startDungeon(S.activeTeam, run.dungeon.id, { navigate: true, mode: run.dungeon.mode });
});
document.getElementById("btnDockMap").addEventListener("click", () => {
  openMap();
});

// 探索画面のログ欄の下端を、画面下のドックの上端に合わせる。ドックの高さは機種（ホームバーの有無）・
// 画面幅・文字の大きさで変わるため、実際の位置を測って CSS の --dock-offset に入れる
function syncDockOffset() {
  const screen = document.getElementById("screen-battle");
  const dock = document.getElementById("bottomDock");
  if (screen.classList.contains("hidden")) return;
  const offset = Math.max(0, Math.round(screen.getBoundingClientRect().bottom - dock.getBoundingClientRect().top));
  screen.style.setProperty("--dock-offset", offset + "px");
}
if (typeof ResizeObserver === "function") new ResizeObserver(syncDockOffset).observe(document.getElementById("bottomDock"));
window.addEventListener("resize", syncDockOffset);
window.addEventListener("orientationchange", syncDockOffset);

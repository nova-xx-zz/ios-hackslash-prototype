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
  document.getElementById("dockDungeon").textContent = d ? d.name : "冒険者ギルド";
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
    const chips = document.createElement("div");
    chips.className = "auto-repeat-chips";
    for (const n of AUTO_REPEAT_OPTIONS) {
      const chip = document.createElement("button");
      chip.className = "auto-repeat-chip" + (ar.target === n ? " active" : "");
      chip.textContent = `x${n}`;
      chip.disabled = locked;
      chip.addEventListener("click", () => {
        if (isTeamLocked(i)) return;
        ar.target = n;
        store.set(KEYS.autoRepeatTarget, n);
        renderAutoRepeatRow();
      });
      chips.appendChild(chip);
    }
    row.appendChild(chips);
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
    ar.active = true;
    ar.done = 0;
    startDungeon(i, run.dungeon.id, { navigate: true });
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
// 自動分解のON/OFF・フィルターは、出撃時にrunへスナップショットされた値で確定するため、
// 探索中でも自由に変更できる（変更は次に出発する周回から反映される）
function updateAutoDisassembleButton() {
  const btn = document.getElementById("btnAutoDisassembleToggle");
  btn.textContent = autoDisassemble ? "自動分解 ON" : "自動分解 OFF";
  btn.classList.toggle("toggle-on", autoDisassemble);
  document.getElementById("disassembleFilterRow").classList.toggle("hidden", !autoDisassemble);
}
document.getElementById("btnAutoDisassembleToggle").addEventListener("click", () => {
  autoDisassemble = !autoDisassemble;
  store.set(KEYS.autoDisassemble, autoDisassemble ? "1" : "0");
  updateAutoDisassembleButton();
});
function renderDisassembleFilter() {
  const row = document.getElementById("disassembleFilterRow");
  row.innerHTML = `<span class="disassemble-filter-label">対象:</span>`;
  for (const rarity of RARITIES) {
    const chip = document.createElement("button");
    const on = autoDisassembleRarities.has(rarity.key);
    chip.className = "disassemble-chip" + (on ? " active" : "");
    chip.textContent = rarity.key.toUpperCase();
    chip.title = rarity.name;
    if (on) chip.style.background = rarity.color;
    chip.addEventListener("click", () => {
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
  const run = teamRuns[S.activeTeam];
  if (isTeamLocked(S.activeTeam) || !run) return;
  startDungeon(S.activeTeam, run.dungeon.id, { navigate: true });
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

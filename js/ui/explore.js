// ---------- 画面: 探索画面: 戦闘AIの設定・ATBの時間進行・勝利・道中イベント・周回の終了 ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// ---------- Auto-battle AI ----------
function mpCostFor(c, ability) {
  const mult = (racePassive(c, "mpCostMult") || 1) * (treePassive(c, "mpCostMult") || 1) * (gearPassive(c, "mpCostMult") || 1);
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

// 戦闘の計算はjs/core/battle.js（画面に依存しない）。ここではキャラの能力値・技・パッシブを渡し、
// 返ってきたイベントをログの文章にする
function battleEnv() {
  return {
    rng: RNG,
    atbRate: ATB_RATE,
    stats: computeStats,
    abilities: (c) => availableAbilities(c).filter((a) => isSkillActive(c, a.id)),
    mpCost: mpCostFor,
    tier: getAbilityTier,
    // 種族・スキルツリー・装備のセット効果を合わせる
    passives: (c) => ({
      lifesteal: racePassive(c, "lifesteal") + treePassive(c, "lifesteal") + gearPassive(c, "lifesteal"),
      healBonus: racePassive(c, "healBonus") + treePassive(c, "healBonus") + gearPassive(c, "healBonus"),
      critBonus: racePassive(c, "critBonus") + treePassive(c, "critBonus") + gearPassive(c, "critBonus"),
      dmgTakenMult: (racePassive(c, "dmgTakenMult") || 1) * (treePassive(c, "dmgTakenMult") || 1) * (gearPassive(c, "dmgTakenMult") || 1),
      pierce: treePassive(c, "pierce") || 0, // スキルツリーの防御無視
    }),
  };
}

function logBattleEvent(run, battle, ev) {
  const t = run.team;
  switch (ev.type) {
    case "heal":
      logLine(t, `${ev.actor.name} の${ev.ability.name}！ ${ev.target.name}のHPが${ev.amount}かいふく！`, "heal");
      break;
    case "crit":
      logLine(t, "かいしんの一撃！", "");
      break;
    case "damage":
      if (ev.immune) { logLine(t, `${ev.actor.name} の${ev.ability.name}！ ${ev.target.name}には効かない！`, "system"); break; }
      logLine(t, `${ev.actor.name} の${ev.ability.name}！ ` + (ev.weak ? "弱点！ " : ev.resist ? "効きが悪い… " : "")
        + `${ev.target.name}に${ev.dmg}のダメージ！` + (ev.drained > 0 ? `（${ev.drained}吸収）` : ""), "hit");
      break;
    case "status": {
      const names = { atk: "攻撃力", mag: "魔力", def: "防御力", spd: "素早さ" };
      if (ev.kind === "imbue") logLine(t, `${ev.actor.name} の${ev.ability.name}！ ${ev.target.name}の攻撃が${ELEMENTS[ev.element]}属性になった！`, "heal");
      else if (ev.kind === "buff") logLine(t, `${ev.actor.name} の${ev.ability.name}！ ${ev.target.name}の${names[ev.stat]}が上がった！`, "heal");
      else logLine(t, `${ev.target.name}の${names[ev.stat]}が下がった！`, "system");
      break;
    }
    case "enemyDown":
      logLine(t, `${ev.enemy.name} をたおした！`, "system");
      updateCardSubtitle(t, enemyRoster(battle));
      break;
    case "acted":
      ev.actor.actedFlash = 0.35;
      break;
    case "enemyAttack":
      logLine(t, `${ev.enemy.name} のこうげき！ ${ev.target.name}に${ev.dmg}のダメージ！`, "hit");
      break;
    case "memberDown":
      logLine(t, `${ev.member.name} はたおれた！`, "down");
      break;
  }
}

// ---------- Main ATB loop ----------
// 4チーム全てのATBを同時に(x1速度なら等速で)進める。表示中のチームだけDOMを更新する
let lastT = 0;
function loop(t) {
  const dtRaw = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  // 速いほど1フレームで進む時間が長くなるため、0.05秒ずつに分けて進める（x5でも戦闘の判定がx1と同じ細かさになる）
  let left = dtRaw * speedMult;
  while (left > 1e-6) {
    const step = Math.min(0.05, left);
    tick(step);
    left -= step;
  }
  requestAnimationFrame(loop);
}

function tick(dt) {
  for (let i = 0; i < TEAM_COUNT; i++) {
    const battle = teamBattles[i];
    if (battle && battle.active) tickTeam(i, dt);
  }
  updateTeamTabDots();
}

function tickTeam(i, dt) {
  const run = teamRuns[i];
  const battle = teamBattles[i];
  for (const c of teamMembers(i)) if (c.actedFlash > 0) c.actedFlash -= dt;
  const { events, result } = Runner.stepBattle(i, dt); // 決着したら battle.active は false になる
  for (const ev of events) logBattleEvent(run, battle, ev);
  if (result) {
    if (result === "victory") onVictory(run, battle);
    else onDefeat(run);
  }
  if (i === S.activeTeam) updateBattleDOM();
}

requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });

// ---------- Victory / rewards ----------
// EXP・ドロップ（踏破まで保留）・踏破の記録・テイムの判定は js/model/run.js（winBattle）
function onVictory(run, battle) {
  const r = Runner.winBattle(run, battle);
  logLine(run.team, `EXP +${r.expGain}`, "system");
  if (!r.isLast) {
    scheduleNext(run.team, () => {
      rollDungeonEvent(run);
      scheduleNext(run.team, () => startBattle(run), 700);
    }, 900);
  } else {
    scheduleNext(run.team, () => finishRun(run, { cleared: true, tameResult: r.tameResult, unlocked: r.unlocked }), 700);
  }
}

function onDefeat(run) {
  scheduleNext(run.team, () => finishRun(run, { cleared: false }), 700);
}

function scheduleNext(teamIndex, fn, delayMs) {
  clearTimeout(nextBattleTimer[teamIndex]);
  nextBattleTimer[teamIndex] = setTimeout(fn, delayMs / speedMult);
}

// ---------- 道中イベント ----------
// 抽選と反映は js/model/run.js（rollEvent。オフライン精算と共通）。ここはログの文章と画面の更新
function rollDungeonEvent(run) {
  const ev = Runner.rollEvent(run);
  if (!ev) return;
  const t = run.team;
  if (ev.kind === "treasure") {
    if (!ev.item) logEvent(t, "treasure", "宝箱を見つけた！", "しかし、宝箱の中身は空っぽだった・・・");
    else logEvent(t, "treasure", "宝箱を見つけた！", `${itemLabel(ev.item)} を手に入れた`);
  } else if (ev.kind === "trap") {
    logEvent(t, "trap", ev.wide ? "毒ガスが噴き出した！" : "落とし穴に落ちた！", "");
    for (const h of ev.hits) logLine(t, `${h.c.name} は ${h.dmg} のダメージを受けた`, "down");
    if (t === S.activeTeam) updateBattleDOM();
  } else if (ev.kind === "spring") {
    logEvent(t, "blessing", "清らかな泉を見つけた！", "パーティは水を飲んで休息した");
    for (const h of ev.heals) logLine(t, `${h.c.name} のHPが${h.hp}、MPが${h.mp}かいふく`, "heal");
    if (t === S.activeTeam) updateBattleDOM();
  } else if (ev.kind === "shrine") {
    logEvent(t, "blessing", "古びた石碑を見つけた！", `祈りを捧げると ${STAT_LABELS[ev.stat]} が上がった（このダンジョン中のみ）`);
    logLine(t, `${STAT_LABELS[ev.stat]} +${Math.round(ev.total * 100)}%`, "system");
    if (t === S.activeTeam) { renderDock(); updateBattleDOM(); }
  }
}

function finishRun(run, info) {
  // ドロップの確定（出撃時の自動分解設定で振り分け）とチームの回復は js/model/run.js
  Runner.finishRun(run, info.cleared, { tamed: info.tameResult && info.tameResult.success ? info.tameResult.name : null });
  const isViewed = run.team === S.activeTeam;

  logEvent(run.team,
    info.cleared ? "clear" : "wipe",
    info.cleared ? `${run.dungeon.name} を踏破した！` : "パーティは全滅した・・・",
    info.cleared ? `合計 EXP +${run.expTotal}` : `${run.dungeon.name} の ${run.battleIndex + 1}戦目で力尽きた`
  );

  if (run.levelUps.length) logLine(run.team, "LEVEL UP! " + run.levelUps.join(" / "), "system");
  if (run.abilityUnlocks.length) logLine(run.team, run.abilityUnlocks.join(" / "), "heal");

  if (info.tameResult && info.tameResult.full) {
    logLine(run.team, `仲間のBOXがいっぱい（${S.roster.length}/${Shop.rosterCapacity()}人）のため、テイムできなかった（ショップでBOXを拡張できます）`, "");
  } else if (info.tameResult) {
    logLine(run.team,
      info.tameResult.success
        ? `${info.tameResult.name} をテイムした！（編成からなかまに加えられます）`
        : `${info.tameResult.name} のテイムに失敗した…`,
      info.tameResult.success ? "heal" : ""
    );
  }
  if (info.unlocked && info.unlocked.length) {
    logLine(run.team, "新しいダンジョンが解放された: " + info.unlocked.map((x) => x.name).join(" / "), "system");
  }

  if (run.drops.length) {
    logLine(run.team, `獲得アイテム ${run.drops.length}個（編成画面で装備できます）`, "system");
    for (const item of run.drops) logDropLine(run.team, item);
  }
  if (run.disassembleCount > 0) {
    logLine(run.team, `自動分解: ${run.disassembleCount}個（+強化石${run.materialGained}）　所持強化石 ${S.material}`, "system");
  }
  if (run.wiped && run.pendingDrops.length > 0) {
    logLine(run.team, `全滅したため、道中で見つけた${run.pendingDrops.length}個のドロップは持ち帰れなかった`, "down");
  }

  saveGame();

  if (isViewed) {
    buildPartyDock();
    renderDock();
  }

  const ar = S.autoRepeat[run.team];
  const next = Runner.advanceAutoRepeat(run);
  if (next === "stoppedByWipe") {
    logLine(run.team, "パーティが全滅したため自動周回を停止しました", "system");
    if (isViewed) renderDock();
  } else if (next === "completed") {
    logLine(run.team, `自動周回が完了しました（${ar.done}周）`, "system");
    if (isViewed) renderDock();
  } else if (next === "continue") {
    logLine(run.team, `自動周回 ${ar.done}/${ar.target} 周完了。次のダンジョンへ出発します…`, "system");
    if (isViewed) renderAutoRepeatRow();
    const nextId = run.dungeon.id;
    const nextMode = run.dungeon.mode;
    scheduleNext(run.team, () => startDungeon(run.team, nextId, { mode: nextMode }), 1400);
  }
}

function buildDropRow(item) {
  const row = document.createElement("div");
  row.className = "drop-row";
  const dot = document.createElement("div");
  dot.className = "drop-dot";
  dot.style.background = rarityColor(item.rarity);
  row.appendChild(dot);
  const label = document.createElement("div");
  label.textContent = itemLabel(item);
  label.style.color = rarityColor(item.rarity); // レア度は名前の色で表す
  if (item.options && item.options.length) {
    const opt = document.createElement("span");
    opt.className = "item-options";
    opt.textContent = `オプション: ${itemOptionsText(item)}`;
    label.appendChild(opt);
  }
  row.appendChild(label);
  return row;
}

function itemLabel(item) {
  const plusText = item.plus > 0 ? `+${item.plus}` : "";
  const levelText = item.level > 1 ? ` Lv.${item.level}` : ""; // 装備のレベル（拾ったダンジョンの推奨Lv）
  return `${itemMark(item)}${item.name}${plusText}${levelText}（${itemStatsText(item)}）`;
}
// オプション効果（ハード・エクストラで落ちた装備）の一覧「ATK+23・会心率+3%」。無ければ空文字
function itemOptionsText(item) {
  return (item.options || []).map(itemOptionText).filter(Boolean).join("・");
}
// 名のある装備は◆、呪いの装備は☠を名前の前に付ける
function itemMark(item) { return item.cursed ? "☠" : item.unique ? "◆" : ""; }
// 名のある装備の特殊効果（呪いのデメリットを含む）。通常の装備は空文字
function itemEffectText(item) {
  const def = item.unique ? getUniqueItem(item.base) : null;
  return def ? def.effect.desc : "";
}
// 「ATK+5 SPD+2」の形の能力値（強化値込み）
function itemStatsText(item) {
  return Object.entries(itemStats(item)).map(([k, v]) => `${STAT_LABELS[k]}+${v}`).join(" ");
}

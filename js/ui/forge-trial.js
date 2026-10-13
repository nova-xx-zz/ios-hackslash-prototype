// 鍛冶屋 > 試作工房。試遊用データのみ使用し、実プレイの装備・セーブ・課金を変更しない。
"use strict";
const ForgeTrial = QPCore.forgeGearTrial;
const FORGE_TRIAL_KEY = "swordcrest_forge_gear_trial_v2";
const FORGE_TRIAL_LEGACY_KEY = "swordcrest_forge_trial_v1";
let forgeTrialEnemyElement = "earth";
let forgeTrialState = null;
let forgeTrialTarget = "sr";
let forgeTrialEssenceId = null;
let forgeTrialMessage = "強化 → 穴あけ → 天然OP抽出 → 継承の順に操作できます。";
let forgeTrialWarning = false;

function forgeTrialLoad() {
  if (forgeTrialState) return;
  try {
    const raw = localStorage.getItem(FORGE_TRIAL_KEY);
    if (raw && raw.length < 100000) {
      const saved = JSON.parse(raw);
      if (ForgeTrial.isValid(saved)) forgeTrialState = saved;
      else {
        forgeTrialMessage = "新しい試作保存データが不正なため、試作工房だけ初期化しました。";
        forgeTrialWarning = true;
      }
    } else if (!raw) {
      const old = localStorage.getItem(FORGE_TRIAL_LEGACY_KEY);
      if (old && old.length < 100000) {
        forgeTrialState = ForgeTrial.upgradeFromV1(JSON.parse(old));
        if (forgeTrialState) {
          forgeTrialMessage = "以前の試作工房の武器・穴・抽出液・天井を引き継ぎました。";
          forgeTrialWarning = false;
        }
      }
    }
  } catch (_) {
    forgeTrialMessage = "試作データを復元できなかったため、試作工房だけ初期化しました。";
    forgeTrialWarning = true;
  }
  if (!forgeTrialState) forgeTrialState = ForgeTrial.createDemo();
  forgeTrialSave();
}
function forgeTrialSave() {
  try { localStorage.setItem(FORGE_TRIAL_KEY, JSON.stringify(forgeTrialState)); }
  catch (_) { forgeTrialMessage += "（試作データを端末に保存できませんでした）"; }
}
function forgeOptionLabel(o) {
  if (!o || !ForgeTrial.OP_DEFS[o.key]) return "不明なOP";
  if (["atk","crit","guard"].includes(o.key)) {
    const label={atk:"ATK +",crit:"会心率 +",guard:"被ダメージ -"}[o.key];
    return label+(o.value*100).toFixed(o.value*100%1?1:0)+"%";
  }
  return ForgeTrial.OP_DEFS[o.key].label;
}
function forgeSelect(label,selected,onChange) {
  const select=forgeEl("select","forge-trial-select");
  select.setAttribute("aria-label",label);
  Object.entries(ForgeTrial.ELEMENTS).forEach(function(entry){
    const option=forgeEl("option","",entry[1]);option.value=entry[0];
    option.selected=entry[0]===selected;
    select.appendChild(option);
  });
  select.addEventListener("change",function(){onChange(select.value)});
  return select;
}
function forgeEl(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined) el.textContent = String(content);
  return el;
}
function forgeButton(text, action, disabled, className) {
  const button = forgeEl("button", className || "btn small ghost", text);
  button.type = "button";
  button.disabled = !!disabled;
  button.addEventListener("click", action);
  return button;
}
function forgeSection(body, title, subtitle) {
  const section = forgeEl("section", "forge-trial-section");
  section.appendChild(forgeEl("h3", "", title));
  if (subtitle) section.appendChild(forgeEl("p", "forge-trial-note", subtitle));
  body.appendChild(section);
  return section;
}
function forgeApply(action) {
  const result = action();
  forgeTrialMessage = result.message || (result.ok ? "完了しました" : "操作できません");
  forgeTrialWarning = !result.ok;
  if (result.ok) forgeTrialSave();
  forgeTrialRender();
}
function openForgeTrial() {
  forgeTrialLoad();
  forgeTrialRender();
  showScreen("screen-forge-trial");
}
function forgeTrialRender() {
  forgeTrialLoad();
  const body = document.getElementById("forgeTrialBody");
  const previousScroll = body.scrollTop;
  body.replaceChildren();
  const state = forgeTrialState;
  let target = state.targets.find(function (t) { return t.id === forgeTrialTarget; });
  if (!target) { forgeTrialTarget = "sr"; target = state.targets.find(function (t) { return t.id === forgeTrialTarget; }); }
  if (!target) return;

  const intro = forgeEl("p", "forge-trial-note", "検証専用のサンプル武器を使用します。ゲーム本体の所持品・強化石・課金情報には一切反映されません。強化値と穴あけ素材は試作のため省略しています。");
  body.appendChild(intro);
  const msg = forgeEl("p", "forge-trial-message" + (forgeTrialWarning ? " warn" : ""), forgeTrialMessage);
  msg.setAttribute("role", "status");
  body.appendChild(msg);

  const choose = forgeSection(body, "① 継承先を選ぶ", "下位レアリティの天然OP抽出液だけを上位武器に継承できます。");
  const tabs = forgeEl("div", "forge-trial-tabs");
  state.targets.forEach(function (t) {
    tabs.appendChild(forgeButton(t.rarity.toUpperCase(), function () {
      forgeTrialTarget = t.id;
      forgeTrialEssenceId = null;
      forgeTrialMessage = t.name + "を選びました";
      forgeTrialWarning = false;
      forgeTrialRender();
    }, false, "forge-trial-chip" + (target.id === t.id ? " selected" : "")));
  });
  choose.appendChild(tabs);
  choose.appendChild(forgeEl("div", "forge-trial-weapon", target.name + " +" + target.plus));
  const summary=ForgeTrial.inspect(target);
  choose.appendChild(forgeEl("p","forge-trial-note","天然OP "+summary.naturalCount+" / 継承OP "+summary.inheritedCount+" / 合計 "+summary.total+" / 上限 "+summary.maxTotal));
  choose.appendChild(forgeEl("p", "forge-trial-note", "解放した穴 " + target.opened + " / " + ForgeTrial.SLOT_LEVELS[target.rarity].length +
    "　継承可能な空き穴 " + summary.freeInheritedSockets + "（総上限も適用）"));
  const slotRow = forgeEl("div", "forge-trial-slots");
  const allOps=[...target.naturalOptions,...target.options];
  ForgeTrial.SLOT_LEVELS[target.rarity].forEach(function (threshold, idx) {
    const op=allOps[idx];
    const label=op ? (op.origin==="natural"?"天然 ":"継承 ")+forgeOptionLabel(op) :
      idx < target.naturalOptions.length + target.opened ? "空き枠" : "+" + threshold + "で穴あけ";
    slotRow.appendChild(forgeEl("div", "forge-trial-slot" + (op ? " filled" : ""),
      "OP"+(idx + 1)+"　"+label));
  });
  choose.appendChild(slotRow);
  if (target.naturalOptions.length) {
    const natural=target.naturalOptions[0];
    choose.appendChild(forgeButton("天然OPを抽出："+forgeOptionLabel(natural),function(){
      if(!window.confirm("選んだ天然OPは武器から消え、抽出液になります。武器は残ります。実行しますか？"))return;
      forgeApply(function(){return ForgeTrial.extractTarget(state,target.id,0)});
    },false,"btn ghost forge-trial-wide"));
  }

  const growth = forgeSection(body, "② 強化と穴あけ", "強化値だけでは穴は開きません。条件を満たしてから穴あけを実行します。");
  const growthActions = forgeEl("div", "forge-trial-actions");
  ForgeTrial.SLOT_LEVELS[target.rarity].forEach(function (milestone) {
    growthActions.appendChild(forgeButton("試験強化 +" + milestone, function () {
      forgeApply(function () { return ForgeTrial.increasePlus(state, target.id, milestone); });
    }, target.plus >= milestone));
  });
  growth.appendChild(growthActions);
  const nextThreshold = ForgeTrial.SLOT_LEVELS[target.rarity][target.opened];
  growth.appendChild(forgeButton(nextThreshold === undefined ? "穴あけ完了" :
      "枠" + (target.opened + 1) + "を穴あけ（必要 +" + nextThreshold + "）",
    function () { forgeApply(function () { return ForgeTrial.openSocket(state, target.id); }); },
    !summary.canOpenNext, "btn primary forge-trial-wide"));

  const extracts = forgeSection(body, "③ 天然OPを抽出", "武器本体は残り、天然OPだけが消えます。継承済みOPは再抽出できません。");
  const availableSources = state.sources.filter(function (w) { return w.natural && !!ForgeTrial.OP_DEFS[w.optionKey]; });
  const extractedCount = state.sources.length - availableSources.length;
  extracts.appendChild(forgeEl("p", "forge-trial-note", "天然OPあり " + availableSources.length + "本 ／ 抽出済み武器 " + extractedCount + "本（武器本体は試作所持品に残っています）"));
  availableSources.forEach(function (weapon) {
    const div = forgeEl("div", "forge-trial-line");
    const opt = ForgeTrial.OP_DEFS[weapon.optionKey];
    const summary = opt ? weapon.name + "　／　" + forgeOptionLabel({key:weapon.optionKey,value:weapon.optionValue}) + "（OP " + opt.rarity.toUpperCase() + "）"
      : weapon.name + "　／　抽出済み";
    div.appendChild(forgeEl("div", "forge-trial-source-label", summary));
    div.appendChild(forgeButton(opt ? "抽出する" : "抽出済み", function () {
      forgeApply(function () { return ForgeTrial.extractSource(state, weapon.id); });
    }, !opt));
    extracts.appendChild(div);
  });
  extracts.appendChild(forgeButton("試遊用の天然OP武器を再補充", function () {
    forgeApply(function () { return ForgeTrial.addSamples(state); });
  }, state.sources.length + 5 > 55, "btn ghost forge-trial-wide"));

  const liquids = forgeSection(body, "④ 抽出液を選んで継承", "OPのランクで抽出液の個数が変わります。1回の継承で束ごと消費し、分割・複製はできません。");
  if (!state.essences.length) liquids.appendChild(forgeEl("p", "forge-trial-note", "抽出液がありません。先に天然OPを抽出してください。"));
  if (!state.essences.some(function (e) { return e.id === forgeTrialEssenceId; })) {
    const usable = state.essences.find(function (e) { return ForgeTrial.validate(state, target.id, e.id, false).ok; });
    forgeTrialEssenceId = usable ? usable.id : (state.essences[0] ? state.essences[0].id : null);
  }
  state.essences.forEach(function (e) {
    const op = ForgeTrial.OP_DEFS[e.key];
    if (!op) return;
    const btn = forgeButton(forgeOptionLabel(e) + "　×" + e.count + "（元 " + e.sourceRarity.toUpperCase() + "）", function () {
      forgeTrialEssenceId = e.id;
      forgeTrialRender();
    }, false, "forge-trial-essence" + (forgeTrialEssenceId === e.id ? " selected" : ""));
    liquids.appendChild(btn);
  });
  const choice = forgeTrialEssenceId;
  const canTry = choice ? ForgeTrial.validate(state, target.id, choice, false) : { ok: false, message: "抽出液を選んでください" };
  if (choice && !canTry.ok) liquids.appendChild(forgeEl("p", "forge-trial-note forge-trial-error", canTry.message));
  const maxFails = ForgeTrial.PITY_LIMIT[target.rarity];
  const isPity = maxFails !== undefined && target.failures >= maxFails;
  const pct = isPity ? 100 : Math.round(ForgeTrial.RATES[target.rarity] * 100);
  liquids.appendChild(forgeEl("p", "forge-trial-rate", "通常継承成功率 " + pct + "%" +
    (maxFails === undefined ? "（確定）" : "　／　天井 " + target.failures + "/" + maxFails + "回失敗" +
      (isPity ? "・次回確定" : ""))));
  const row = forgeEl("div", "forge-trial-actions");
  row.appendChild(forgeButton("通常継承", function () {
    if (!window.confirm("抽出液が成功・失敗どちらでも消費されます。通常継承を実行しますか？")) return;
    forgeApply(function () { return ForgeTrial.inherit(state, target.id, forgeTrialEssenceId, false); });
  }, !canTry.ok, "btn primary"));
  row.appendChild(forgeButton("確定継承液 ×1", function () {
    if (!window.confirm("試遊用確定液1個と抽出液を消費します。確定継承しますか？")) return;
    forgeApply(function () { return ForgeTrial.inherit(state, target.id, forgeTrialEssenceId, true); });
  }, !canTry.ok || state.trialLiquid < 1 || (target.rarity !== "ur" && target.rarity !== "lr") || isPity, "btn ghost"));
  liquids.appendChild(row);
  liquids.appendChild(forgeEl("p", "forge-trial-note", "テスト用確定継承液 " + state.trialLiquid + "個（実際の購入なし）"));
  liquids.appendChild(forgeEl("p", "forge-trial-message" + (forgeTrialWarning ? " warn" : ""), forgeTrialMessage));
  liquids.appendChild(forgeButton("確定継承液をテスト配布 +1", function () {
    forgeApply(function () {
      if (state.trialLiquid >= 20) return { ok: false, message: "テスト配布は20個までです" };
      state.trialLiquid += 1;
      return { ok: true, message: "テスト用確定継承液を1個配布しました。課金は発生しません" };
    });
  }, state.trialLiquid >= 20, "btn ghost forge-trial-wide"));

  const elementSec=forgeSection(body,"⑤ 属性相性を体感","試遊武器の属性と仮想敵の属性を切り替え、通常/虚無抑制/虚無無効の倍率を比較します。戦闘ダメージには未反映です。");
  const elementRows=forgeEl("div","forge-trial-element-rows");
  const weaponElement=forgeEl("label","forge-trial-note","試作武器の攻撃属性");
  weaponElement.appendChild(forgeSelect("武器の攻撃属性",target.attackElement,function(value){
    forgeApply(function(){return ForgeTrial.setElement(state,target.id,value)});
  }));
  elementRows.appendChild(weaponElement);
  const enemyElement=forgeEl("label","forge-trial-note","仮想敵の属性");
  enemyElement.appendChild(forgeSelect("敵の属性",forgeTrialEnemyElement,function(value){
    forgeTrialEnemyElement=value;
    forgeTrialRender();
  }));
  elementRows.appendChild(enemyElement);
  elementSec.appendChild(elementRows);
  ForgeTrial.compare(state,target.id,forgeTrialEnemyElement).forEach(function(result){
    const text=result.multiplier.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
    elementSec.appendChild(forgeEl("div","forge-trial-slot"+(result.immune?" forge-trial-error":""),
      result.label+"：×"+text+(result.immune?"（完全無効）":result.reversed?"（属性反転）":"")));
  });
  elementSec.appendChild(forgeEl("p","forge-trial-note","属性倍率のみの比較です。OPの攻撃力・会心などの実戦効果はまだ計算に含みません。"));
  const footer = forgeSection(body, "試作を最初からやり直す", "試作工房だけを初期化します。既存ゲームのセーブデータには触れません。");
  footer.appendChild(forgeButton("試作データをリセット", function () {
    if (!window.confirm("試作工房の進行を初期化しますか？（ゲーム本体のデータは残ります）")) return;
    forgeTrialState = ForgeTrial.createDemo();
    forgeTrialTarget = "sr";
    forgeTrialEnemyElement = "earth";
    forgeTrialEssenceId = null;
    forgeTrialMessage = "試作工房を初期化しました";
    forgeTrialWarning = false;
    forgeTrialSave();
    forgeTrialRender();
  }, false, "btn ghost forge-trial-wide"));
  // 画面再描画でiPhoneのスクロール位置が先頭へ飛ばないようにする。
  body.scrollTop = previousScroll;
}
document.getElementById("btnForgeTrialBack").addEventListener("click", openPartyMenu);

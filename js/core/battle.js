// ---------- 戦闘エンジン（battle） ----------
// 速度(SPD)に応じてたまるATBゲージ、オート戦闘AIの行動選択、ダメージ・回復・吸収の計算を行う。
// 画面やログの文章には依存せず、起きたことを「イベント」の配列として返す（文章化はgame.js側）。
// キャラの能力値・使える技・パッシブ効果はenv（下記）から受け取るため、ブラウザの外
// （Node.jsのテストや tools/simulate.js の戦闘シミュレーション、将来のサーバー）でも同じ戦闘を動かせる。
//
// env:
//   rng            乱数（js/core/rng.js）
//   atbRate        ATBゲージの伸び（SPD × atbRate / 秒）
//   stats(c)       キャラの能力値 { maxHp, maxMp, atk, mag, def, spd }
//   abilities(c)   ONにしていて習得済みの技の配列
//   mpCost(c, a)   その技の消費MP（種族・ツリーの軽減込み）
//   tier(c, id)    技の優先度（3=優先 / 2=通常 / 1=温存）
//   passives(c)    { lifesteal, healBonus, critBonus, dmgTakenMult, pierce }（種族＋スキルツリー＋装備）
//
// 敵の特性（js/data.js の makeEnemy が res に入れる。モードで強さが変わる）:
//   res.physical / res.magic  物理・魔法のダメージ倍率（霊体は物理、魔法耐性は魔法が効きにくい。0なら効かない）
//   res.nonHoly               聖属性以外のダメージ倍率（アンデッド）
//   res.el[属性]              属性ごとの倍率（弱点1.5・耐性0.5）
// 技の追加の効果:
//   element  属性（fire/ice/thunder/holy/dark。無ければ無属性。聖属性付与中は無属性の技が聖属性になる）
//   pierce   防御を無視する割合（パッシブの pierce と足す。上限0.8）
//   debuff   { stat: "def"|"atk"|"spd", mult, duration } 当たった敵の能力を duration 秒だけ mult 倍にする
//   kind: "buff" の技  buff { stat: "atk"|"mag"|"def"|"spd", mult, duration } または imbue { element, duration } を味方に掛ける
// 強化・弱体・属性付与は battle.fx に戦闘ごとに持ち、戦闘が終われば消える（battle.time が経過秒数）
//
// イベント（type別）:
//   heal       { actor, ability, target, amount }
//   crit       { actor }（直後のdamageが会心）
//   damage     { actor, ability, target, dmg, drained, immune, weak, resist }（drained: 吸収したHP。immune: 効かない。weak: 弱点。resist: 効きにくい）
//   status     { actor, ability, target, kind: "buff"|"debuff"|"imbue", stat, mult, element }（強化・弱体・属性付与を掛けた）
//   enemyDown  { enemy }
//   acted      { actor }（味方が行動した。画面の点滅用）
//   enemyAttack{ enemy, target, dmg }
//   memberDown { member }
(function (root) {
  "use strict";

  const BASIC_ATTACK = { id: "attack", name: "たたかう", reqLevel: 1, mpCost: 0, kind: "physical", target: "single", power: 1.0, hits: 1 };

  // ---- 技の期待効果（AIの技選び用。乱数は平均値で見積もる） ----
  const AVG_DAMAGE_ROLL = 1.025; // ダメージ乱数 0.9〜1.15 の平均
  const CRIT_MULT = 1.5;

  const MAX_PIERCE = 0.8;
  const STAT_KEYS = { atk: "atk", mag: "mag", def: "def", spd: "spd" };

  // ---- 戦闘中の強化・弱体・属性付与（battle.fx: 対象 → { atk: {mult, until}, ..., imbue: {element, until} }） ----
  function fxOf(battle, who) {
    if (!battle) return null;
    if (!(battle.fx instanceof Map)) battle.fx = new Map();
    return battle.fx.get(who) || null;
  }
  function now(battle) { return (battle && battle.time) || 0; }
  function fxMult(battle, who, stat) {
    const f = fxOf(battle, who);
    const e = f && f[stat];
    return e && e.until > now(battle) ? e.mult : 1;
  }
  function imbueOf(battle, who) {
    const f = fxOf(battle, who);
    return f && f.imbue && f.imbue.until > now(battle) ? f.imbue.element : null;
  }
  function setFx(battle, who, key, value) {
    if (!battle) return;
    if (!(battle.fx instanceof Map)) battle.fx = new Map();
    const f = battle.fx.get(who) || {};
    f[key] = value;
    battle.fx.set(who, f);
  }
  // 強化・弱体を掛ける。同じ能力に掛かっている間は、強い方の倍率を残して時間を延ばす
  function applyStatFx(battle, who, stat, mult, duration) {
    const cur = fxOf(battle, who) && fxOf(battle, who)[stat];
    const active = cur && cur.until > now(battle);
    const stronger = mult < 1 ? Math.min(mult, active ? cur.mult : 1) : Math.max(mult, active ? cur.mult : 1);
    setFx(battle, who, stat, { mult: stronger, until: now(battle) + duration });
  }
  // 味方の能力値（強化を反映）
  function memberStats(c, env, battle) {
    const s = env.stats(c);
    if (!battle || !fxOf(battle, c)) return s;
    const out = Object.assign({}, s);
    for (const k of Object.keys(STAT_KEYS)) out[k] = s[k] * fxMult(battle, c, k);
    return out;
  }
  // 敵の能力値（弱体を反映）
  function enemyStat(e, stat, battle) { return e[stat] * fxMult(battle, e, stat); }

  // 技の属性（無属性の技は、聖属性付与などが掛かっていればその属性になる）
  function abilityElement(c, ability, battle) {
    if (ability.element) return ability.element;
    return imbueOf(battle, c) || null;
  }
  // 敵の特性・属性によるダメージ倍率（0なら効かない）
  function damageMult(ability, element, target) {
    const res = target && target.res;
    if (!res) return 1;
    let m = ability.kind === "magic" ? (res.magic === undefined ? 1 : res.magic) : (res.physical === undefined ? 1 : res.physical);
    if (element !== "holy" && res.nonHoly !== undefined) m *= res.nonHoly;
    if (element && res.el && res.el[element]) m *= res.el[element];
    return m;
  }
  function elementOnlyMult(element, target) {
    const res = target && target.res;
    return element && res && res.el && res.el[element] ? res.el[element] : 1;
  }
  function pierceOf(c, ability, env) {
    return Math.min(MAX_PIERCE, ((env.passives(c).pierce) || 0) + (ability.pierce || 0));
  }
  // 1回のヒットの基本ダメージ（乱数・会心の前）
  function baseHit(c, ability, target, env, battle) {
    const stats = memberStats(c, env, battle);
    const isMagic = ability.kind === "magic";
    const atkStat = isMagic ? stats.mag : stats.atk;
    const mitig = isMagic ? 0.15 : 0.3;
    const def = enemyStat(target, "def", battle) * (1 - pierceOf(c, ability, env));
    return Math.max(1, Math.round(atkStat * ability.power - def * mitig));
  }

  // 1回のヒットで与える見込みダメージ（実際の計算式と同じ。乱数は平均、会心は期待値）
  function expectedHitDamage(c, ability, target, env, battle) {
    const mult = damageMult(ability, abilityElement(c, ability, battle), target);
    if (mult <= 0) return 0;
    const base = baseHit(c, ability, target, env, battle) * AVG_DAMAGE_ROLL * mult;
    const isMagic = ability.kind === "magic";
    const critChance = isMagic ? 0 : 0.1 + env.passives(c).critBonus;
    return base * (1 + critChance * (CRIT_MULT - 1));
  }
  function isDamaging(a) { return a.kind === "physical" || a.kind === "magic"; }
  // そのキャラが1回の行動で target に与えられる見込みダメージ（使える技と通常攻撃のうち最大）
  function bestDamage(c, target, env, battle) {
    let best = expectedHitDamage(c, BASIC_ATTACK, target, env, battle);
    for (const a of env.abilities(c)) {
      if (!isDamaging(a) || c.mp < env.mpCost(c, a)) continue;
      const v = expectedHitDamage(c, a, target, env, battle) * a.hits;
      if (v > best) best = v;
    }
    return best;
  }
  function actionsPerSecond(spd, env) { return Math.max(0.01, spd * env.atbRate / 100); }
  // 一時的に強化・弱体を掛けた状態で fn を計算する（AIの見積もり用。終わったら元に戻す）
  function withFx(battle, who, key, value, fn) {
    if (!(battle.fx instanceof Map)) battle.fx = new Map();
    const had = battle.fx.has(who);
    const f = battle.fx.get(who) || {};
    const prev = f[key];
    f[key] = value;
    battle.fx.set(who, f);
    try { return fn(); } finally {
      if (prev === undefined) delete f[key]; else f[key] = prev;
      if (!had) battle.fx.delete(who);
    }
  }
  // 敵1体が味方1人に与える見込みダメージ（通常攻撃）
  function enemyHitOn(e, member, env, battle) {
    const def = memberStats(member, env, battle).def;
    const dmg = Math.max(1, enemyStat(e, "atk", battle) - def * 0.4) * AVG_DAMAGE_ROLL;
    return dmg * ((env.passives(member).dmgTakenMult) || 1);
  }
  const FX_LOOKAHEAD = 0.8; // 先の効果は少し割り引いて、今すぐのダメージと比べる

  // 敵に弱体を掛けた時の見込み効果（増える与ダメージ、または減る被ダメージ。HP換算）
  function debuffValue(c, debuff, targets, party, env, battle) {
    let total = 0;
    const alive = party.filter((p) => p.alive);
    for (const t of targets) {
      const cur = fxOf(battle, t) && fxOf(battle, t)[debuff.stat];
      if (cur && cur.until > now(battle) + 2 && cur.mult <= debuff.mult) continue; // もう掛かっている
      const until = now(battle) + debuff.duration;
      const hyp = { mult: debuff.mult, until };
      let gain = 0;
      if (debuff.stat === "def") {
        for (const m of alive) {
          const rate = actionsPerSecond(memberStats(m, env, battle).spd, env) * debuff.duration;
          const without = bestDamage(m, t, env, battle);
          const withIt = withFx(battle, t, "def", hyp, () => bestDamage(m, t, env, battle));
          gain += Math.max(0, withIt - without) * rate;
        }
        gain = Math.min(gain, t.hp);
      } else {
        // 攻撃力・素早さを下げる: その敵から受けるダメージが減る
        const perHit = alive.reduce((s, m) => s + enemyHitOn(t, m, env, battle), 0) / Math.max(1, alive.length);
        const rate = actionsPerSecond(enemyStat(t, "spd", battle), env) * debuff.duration;
        if (debuff.stat === "atk") {
          const lower = withFx(battle, t, "atk", hyp, () => alive.reduce((s, m) => s + enemyHitOn(t, m, env, battle), 0) / Math.max(1, alive.length));
          gain = Math.max(0, perHit - lower) * rate;
        } else if (debuff.stat === "spd") {
          gain = perHit * rate * (1 - debuff.mult);
        }
      }
      total += gain;
    }
    return total * FX_LOOKAHEAD;
  }
  // 味方に強化・属性付与を掛けた時の見込み効果
  function buffValue(c, ability, targets, party, enemies, env, battle) {
    const alive = enemies.filter((e) => e.alive);
    if (alive.length === 0) return 0;
    const hpLeft = alive.reduce((s, e) => s + e.hp, 0);
    let total = 0;
    const duration = (ability.buff || ability.imbue).duration;
    for (const m of targets) {
      const f = fxOf(battle, m);
      const rate = actionsPerSecond(memberStats(m, env, battle).spd, env) * duration;
      if (ability.imbue) {
        if (f && f.imbue && f.imbue.until > now(battle) + 2) continue;
        const target = pickEnemyTarget(m, alive, null);
        const without = bestDamage(m, target, env, battle);
        const withIt = withFx(battle, m, "imbue", { element: ability.imbue.element, until: now(battle) + duration }, () => bestDamage(m, target, env, battle));
        total += Math.max(0, withIt - without) * rate;
        continue;
      }
      const b = ability.buff;
      if (f && f[b.stat] && f[b.stat].until > now(battle) + 2 && f[b.stat].mult >= b.mult) continue;
      const hyp = { mult: b.mult, until: now(battle) + duration };
      if (b.stat === "atk" || b.stat === "mag") {
        const target = pickEnemyTarget(m, alive, null);
        const without = bestDamage(m, target, env, battle);
        const withIt = withFx(battle, m, b.stat, hyp, () => bestDamage(m, target, env, battle));
        total += Math.max(0, withIt - without) * rate;
      } else if (b.stat === "def") {
        const share = 1 / Math.max(1, party.filter((p) => p.alive).length);
        for (const e of alive) {
          const eRate = actionsPerSecond(enemyStat(e, "spd", battle), env) * duration * share;
          const without = enemyHitOn(e, m, env, battle);
          const withIt = withFx(battle, m, "def", hyp, () => enemyHitOn(e, m, env, battle));
          total += Math.max(0, without - withIt) * eRate;
        }
      } else if (b.stat === "spd") {
        const target = pickEnemyTarget(m, alive, null);
        total += bestDamage(m, target, env, battle) * rate * (b.mult - 1);
      }
    }
    return Math.min(total, hpLeft) * FX_LOOKAHEAD;
  }

  // その技を今使った時の期待効果（与ダメージ、または回復量。敵の残りHP・味方の減ったHPを超える分は数えない）
  function expectedValue(c, ability, party, enemies, env, battle) {
    battle = battle || { time: 0 };
    const aliveEnemies = enemies.filter((e) => e.alive);
    const onEnemy = (t) => Math.min(t.hp, expectedHitDamage(c, ability, t, env, battle) * ability.hits);
    if (ability.kind === "buff") {
      const targets = ability.target === "self" ? [c] : party.filter((p) => p.alive);
      return buffValue(c, ability, targets, party, enemies, env, battle);
    }
    if (ability.kind === "heal") {
      const amount = env.stats(c).mag * ability.power * (1 + env.passives(c).healBonus) * ability.hits;
      const missing = (p) => Math.max(0, env.stats(p).maxHp - p.hp);
      if (ability.target === "all-ally") return party.filter((p) => p.alive).reduce((s, p) => s + Math.min(missing(p), amount), 0);
      const t = pickAllyTarget(party, env);
      return t ? Math.min(missing(t), amount) : 0;
    }
    if (aliveEnemies.length === 0) return 0;
    const extra = (targets) => (ability.debuff ? debuffValue(c, ability.debuff, targets, party, env, battle) : 0);
    if (ability.target === "all-enemy") return aliveEnemies.reduce((s, t) => s + onEnemy(t), 0) + extra(aliveEnemies);
    // 単体: 実際に狙う敵で見積もる（ランダム狙いなら平均）
    if (c.targetPriority === "random") return aliveEnemies.reduce((s, t) => s + onEnemy(t) + extra([t]), 0) / aliveEnemies.length;
    const t = pickEnemyTarget(c, aliveEnemies, null);
    return onEnemy(t) + extra([t]);
  }

  // 使う技を選ぶ。
  // 1) プレイヤーが設定した優先度（優先 > 通常 > 温存）が最も高い技のグループだけを候補にする
  //    （温存の技は、他に使える技が無い時だけ使う）
  // 2) そのグループの中で、今の敵・味方の状況に対する期待効果が最も大きい技を選ぶ。
  //    通常の優先度のグループでは通常攻撃も比べ、MPを使う技が通常攻撃より弱ければ通常攻撃にする
  // 3) 期待効果が同じなら、消費MPが少ない方を選ぶ
  // 回復技は誰かのHPが減っている時だけ候補にする（単体: 8割未満、全体: 7割未満）
  // （以前は「要求レベルが高い技ほど強い」前提で選んでいたため、後から覚える技が弱い場合や、
  //   多段技が防御の高い敵にほぼ効かない場合に弱い技を使い続けていた）
  function chooseAction(c, party, env, enemies, battle) {
    enemies = enemies || [];
    const abilities = env.abilities(c).filter((a) => c.mp >= env.mpCost(c, a));
    const usable = abilities.filter((a) => {
      if (a.kind !== "heal") return true;
      if (a.target === "single-ally") return party.some((p) => p.alive && p.hp < env.stats(p).maxHp * 0.8);
      if (a.target === "all-ally") return party.filter((p) => p.alive).some((p) => p.hp < env.stats(p).maxHp * 0.7);
      return true;
    });
    if (usable.length === 0) return BASIC_ATTACK;
    const topTier = Math.max(...usable.map((a) => env.tier(c, a.id)));
    const candidates = usable.filter((a) => env.tier(c, a.id) === topTier);
    if (topTier === 2) candidates.push(BASIC_ATTACK);
    let best = null, bestValue = -Infinity, bestCost = Infinity;
    for (const a of candidates) {
      const value = expectedValue(c, a, party, enemies, env, battle);
      const cost = env.mpCost(c, a);
      if (value > bestValue + 1e-9 || (Math.abs(value - bestValue) <= 1e-9 && cost < bestCost)) {
        best = a; bestValue = value; bestCost = cost;
      }
    }
    return best;
  }

  // 攻撃対象: キャラごとの設定（弱い敵から＝既定 / 強い敵から / ランダム）
  function pickEnemyTarget(c, enemies, rng) {
    const alive = enemies.filter((e) => e.alive);
    if (alive.length === 0) return null;
    const mode = (c && c.targetPriority) || "weakest";
    if (mode === "random") return rng.pick(alive);
    if (mode === "strongest") return alive.reduce((hi, e) => (e.hp > hi.hp ? e : hi), alive[0]);
    return alive.reduce((lowest, e) => (e.hp < lowest.hp ? e : lowest), alive[0]);
  }

  // 回復対象: 残りHPの割合が一番低い味方
  function pickAllyTarget(party, env) {
    const alive = party.filter((p) => p.alive);
    if (alive.length === 0) return null;
    return alive.reduce((lowest, p) => {
      const lr = lowest.hp / env.stats(lowest).maxHp;
      const pr = p.hp / env.stats(p).maxHp;
      return pr < lr ? p : lowest;
    }, alive[0]);
  }

  function markEnemyDown(e, events) {
    if (e.alive && e.hp <= 0) {
      e.alive = false;
      e.hp = 0;
      events.push({ type: "enemyDown", enemy: e });
    }
  }

  // 味方1人の行動（ATBが満タンになった時）
  function performCharacterAction(c, party, battle, env, events) {
    const rng = env.rng;
    const ability = chooseAction(c, party, env, battle.enemies, battle);
    c.mp = Math.max(0, c.mp - env.mpCost(c, ability));
    const stats = memberStats(c, env, battle);
    const pas = env.passives(c);
    let targets = [];
    if (ability.target === "single") { const t = pickEnemyTarget(c, battle.enemies, rng); if (t) targets = [t]; }
    else if (ability.target === "single-ally") { const t = pickAllyTarget(party, env); if (t) targets = [t]; }
    else if (ability.target === "all-enemy") targets = battle.enemies.filter((e) => e.alive);
    else if (ability.target === "all-ally") targets = party.filter((p) => p.alive);
    else if (ability.target === "self") targets = [c];

    if (ability.kind === "buff") {
      for (const t of targets) {
        if (ability.imbue) {
          setFx(battle, t, "imbue", { element: ability.imbue.element, until: now(battle) + ability.imbue.duration });
          events.push({ type: "status", actor: c, ability, target: t, kind: "imbue", element: ability.imbue.element });
        } else if (ability.buff) {
          applyStatFx(battle, t, ability.buff.stat, ability.buff.mult, ability.buff.duration);
          events.push({ type: "status", actor: c, ability, target: t, kind: "buff", stat: ability.buff.stat, mult: ability.buff.mult });
        }
      }
      events.push({ type: "acted", actor: c });
      c.atb = 0;
      return;
    }

    const lifesteal = pas.lifesteal + (ability.lifesteal || 0);
    const element = abilityElement(c, ability, battle);
    for (const t of targets) {
      for (let h = 0; h < ability.hits; h++) {
        if (ability.kind === "heal") {
          const s = env.stats(t);
          const healMult = 1 + pas.healBonus;
          const amount = Math.max(1, Math.round(stats.mag * ability.power * healMult * rng.float(0.9, 1.1)));
          t.hp = Math.min(s.maxHp, t.hp + amount);
          events.push({ type: "heal", actor: c, ability, target: t, amount });
        } else {
          if (!t.alive) break;
          const isMagic = ability.kind === "magic";
          const mult = damageMult(ability, element, t);
          let dmg = baseHit(c, ability, t, env, battle);
          dmg = Math.round(dmg * rng.float(0.9, 1.15));
          const critChance = isMagic ? 0 : 0.1 + pas.critBonus;
          if (!isMagic && mult > 0 && rng.chance(critChance)) { dmg = Math.round(dmg * 1.5); events.push({ type: "crit", actor: c }); }
          dmg = mult <= 0 ? 0 : Math.max(1, Math.round(dmg * mult));
          t.hp -= dmg;
          let drained = 0;
          if (lifesteal > 0 && dmg > 0) {
            drained = Math.max(1, Math.round(dmg * lifesteal));
            c.hp = Math.min(env.stats(c).maxHp, c.hp + drained);
          }
          const elMult = elementOnlyMult(element, t);
          events.push({ type: "damage", actor: c, ability, target: t, dmg, drained, element,
            immune: mult <= 0, weak: mult > 0 && elMult > 1, resist: mult > 0 && mult < 1 && elMult <= 1 });
          markEnemyDown(t, events);
        }
      }
      if (ability.debuff && t.alive && ability.kind !== "heal") {
        applyStatFx(battle, t, ability.debuff.stat, ability.debuff.mult, ability.debuff.duration);
        events.push({ type: "status", actor: c, ability, target: t, kind: "debuff", stat: ability.debuff.stat, mult: ability.debuff.mult });
      }
    }
    events.push({ type: "acted", actor: c });
    c.atb = 0;
  }

  // 敵1体の行動（生きている味方からランダムに1人を通常攻撃）
  function performEnemyAction(e, party, env, events, battle) {
    const alive = party.filter((p) => p.alive);
    if (alive.length === 0) return;
    const target = env.rng.pick(alive);
    const stats = memberStats(target, env, battle);
    let dmg = Math.max(1, Math.round(enemyStat(e, "atk", battle) - stats.def * 0.4));
    dmg = Math.round(dmg * env.rng.float(0.9, 1.15));
    dmg = Math.max(1, Math.round(dmg * (env.passives(target).dmgTakenMult || 1)));
    target.hp -= dmg;
    events.push({ type: "enemyAttack", enemy: e, target, dmg });
    if (target.hp <= 0 && target.alive) {
      target.alive = false;
      target.hp = 0;
      events.push({ type: "memberDown", member: target });
    }
    e.atb = 0;
  }

  function battleResult(battle, party) {
    if (battle.enemies.every((e) => !e.alive)) return "victory";
    if (party.every((p) => !p.alive)) return "defeat";
    return null;
  }

  // dt秒ぶん戦闘を進める。味方→敵の順にATBを伸ばし、満タンになった者から行動する。
  // 決着がついた時点でそれ以降の行動は行わない。戻り値: { events, result: null | "victory" | "defeat" }
  function step(battle, party, dt, env) {
    const events = [];
    battle.time = (battle.time || 0) + dt;
    for (const c of party) {
      if (!c.alive) continue;
      c.atb = Math.min(100, c.atb + memberStats(c, env, battle).spd * env.atbRate * dt);
      if (c.atb >= 100) {
        performCharacterAction(c, party, battle, env, events);
        const result = battleResult(battle, party);
        if (result) return { events, result };
      }
    }
    for (const e of battle.enemies) {
      if (!e.alive) continue;
      e.atb = Math.min(100, e.atb + enemyStat(e, "spd", battle) * env.atbRate * dt);
      if (e.atb >= 100) {
        performEnemyAction(e, party, env, events, battle);
        const result = battleResult(battle, party);
        if (result) return { events, result };
      }
    }
    return { events, result: null };
  }

  // 決着がつくまで一気に進める（画面なしのシミュレーション用）。maxSeconds を超えたら "timeout"
  function simulate(battle, party, env, opts) {
    opts = opts || {};
    const dt = opts.dt || 0.05;
    const maxSeconds = opts.maxSeconds || 600;
    let time = 0;
    while (time < maxSeconds) {
      const r = step(battle, party, dt, env);
      time += dt;
      if (r.result) return { result: r.result, seconds: time };
    }
    return { result: "timeout", seconds: time };
  }

  const exported = {
    BASIC_ATTACK, chooseAction, expectedValue, pickEnemyTarget, pickAllyTarget,
    performCharacterAction, performEnemyAction, battleResult, step, simulate,
    damageMult, memberStats, fxMult, imbueOf,
  };
  root.QPCore = root.QPCore || {};
  root.QPCore.battle = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

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
//   passives(c)    { lifesteal, healBonus, critBonus, dmgTakenMult }（種族＋スキルツリー）
//
// イベント（type別）:
//   heal       { actor, ability, target, amount }
//   crit       { actor }（直後のdamageが会心）
//   damage     { actor, ability, target, dmg, drained }（drained: 吸収したHP。無ければ0）
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

  // 1回のヒットで与える見込みダメージ（実際の計算式と同じ。乱数は平均、会心は期待値）
  function expectedHitDamage(c, ability, target, env) {
    const stats = env.stats(c);
    const isMagic = ability.kind === "magic";
    const atkStat = isMagic ? stats.mag : stats.atk;
    const mitig = isMagic ? 0.15 : 0.3;
    const base = Math.max(1, Math.round(atkStat * ability.power - target.def * mitig)) * AVG_DAMAGE_ROLL;
    const critChance = isMagic ? 0 : 0.1 + env.passives(c).critBonus;
    return base * (1 + critChance * (CRIT_MULT - 1));
  }

  // その技を今使った時の期待効果（与ダメージ、または回復量。敵の残りHP・味方の減ったHPを超える分は数えない）
  function expectedValue(c, ability, party, enemies, env) {
    const aliveEnemies = enemies.filter((e) => e.alive);
    const onEnemy = (t) => Math.min(t.hp, expectedHitDamage(c, ability, t, env) * ability.hits);
    if (ability.kind === "heal") {
      const amount = env.stats(c).mag * ability.power * (1 + env.passives(c).healBonus) * ability.hits;
      const missing = (p) => Math.max(0, env.stats(p).maxHp - p.hp);
      if (ability.target === "all-ally") return party.filter((p) => p.alive).reduce((s, p) => s + Math.min(missing(p), amount), 0);
      const t = pickAllyTarget(party, env);
      return t ? Math.min(missing(t), amount) : 0;
    }
    if (aliveEnemies.length === 0) return 0;
    if (ability.target === "all-enemy") return aliveEnemies.reduce((s, t) => s + onEnemy(t), 0);
    // 単体: 実際に狙う敵で見積もる（ランダム狙いなら平均）
    if (c.targetPriority === "random") return aliveEnemies.reduce((s, t) => s + onEnemy(t), 0) / aliveEnemies.length;
    return onEnemy(pickEnemyTarget(c, aliveEnemies, null));
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
  function chooseAction(c, party, env, enemies) {
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
      const value = expectedValue(c, a, party, enemies, env);
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
    const ability = chooseAction(c, party, env, battle.enemies);
    c.mp = Math.max(0, c.mp - env.mpCost(c, ability));
    const stats = env.stats(c);
    const pas = env.passives(c);
    let targets = [];
    if (ability.target === "single") { const t = pickEnemyTarget(c, battle.enemies, rng); if (t) targets = [t]; }
    else if (ability.target === "single-ally") { const t = pickAllyTarget(party, env); if (t) targets = [t]; }
    else if (ability.target === "all-enemy") targets = battle.enemies.filter((e) => e.alive);
    else if (ability.target === "all-ally") targets = party.filter((p) => p.alive);

    const lifesteal = pas.lifesteal + (ability.lifesteal || 0);
    for (const t of targets) {
      for (let h = 0; h < ability.hits; h++) {
        if (ability.kind === "heal") {
          const s = env.stats(t);
          const healMult = 1 + pas.healBonus;
          const amount = Math.max(1, Math.round(stats.mag * ability.power * healMult * rng.float(0.9, 1.1)));
          t.hp = Math.min(s.maxHp, t.hp + amount);
          events.push({ type: "heal", actor: c, ability, target: t, amount });
        } else {
          const isMagic = ability.kind === "magic";
          const atkStat = isMagic ? stats.mag : stats.atk;
          const mitig = isMagic ? 0.15 : 0.3;
          let dmg = Math.max(1, Math.round(atkStat * ability.power - t.def * mitig));
          dmg = Math.round(dmg * rng.float(0.9, 1.15));
          const critChance = isMagic ? 0 : 0.1 + pas.critBonus;
          if (!isMagic && rng.chance(critChance)) { dmg = Math.round(dmg * 1.5); events.push({ type: "crit", actor: c }); }
          t.hp -= dmg;
          let drained = 0;
          if (lifesteal > 0) {
            drained = Math.max(1, Math.round(dmg * lifesteal));
            c.hp = Math.min(env.stats(c).maxHp, c.hp + drained);
          }
          events.push({ type: "damage", actor: c, ability, target: t, dmg, drained });
          markEnemyDown(t, events);
        }
      }
    }
    events.push({ type: "acted", actor: c });
    c.atb = 0;
  }

  // 敵1体の行動（生きている味方からランダムに1人を通常攻撃）
  function performEnemyAction(e, party, env, events) {
    const alive = party.filter((p) => p.alive);
    if (alive.length === 0) return;
    const target = env.rng.pick(alive);
    const stats = env.stats(target);
    let dmg = Math.max(1, Math.round(e.atk - stats.def * 0.4));
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
    for (const c of party) {
      if (!c.alive) continue;
      c.atb = Math.min(100, c.atb + env.stats(c).spd * env.atbRate * dt);
      if (c.atb >= 100) {
        performCharacterAction(c, party, battle, env, events);
        const result = battleResult(battle, party);
        if (result) return { events, result };
      }
    }
    for (const e of battle.enemies) {
      if (!e.alive) continue;
      e.atb = Math.min(100, e.atb + e.spd * env.atbRate * dt);
      if (e.atb >= 100) {
        performEnemyAction(e, party, env, events);
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
  };
  root.QPCore = root.QPCore || {};
  root.QPCore.battle = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

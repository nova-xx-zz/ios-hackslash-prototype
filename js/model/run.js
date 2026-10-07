// ---------- ダンジョン1周の進行（model/run） ----------
// チームごとの探索の状態（teamRuns / teamBattles）と、1周の進め方をまとめる:
// 出発・戦闘の開始と進行・勝利の処理（EXP・ドロップ・テイム・踏破）・道中イベント・周回の終了（ドロップの確定・
// 自動周回の継続判定）・オフライン精算（離れていた間の周回の計算と反映）。画面には依存しない。
// ログの文章・画面の更新・次の処理までの待ち時間（setTimeout）は game.js が受け持ち、ここは「何が起きたか」を返す。
//   createRunner({ data, state, roster, inventory, rng, teamCount, battleEnv, autoDisassemble, markDexSeen, setBestStage, now })
//     data: { DUNGEONS, RACES, REWARD_RULES, getDungeon, buildEncounter, getEnemyTemplate, rollItemDrop, rollSpecialDrop, ITEM_BASES }
//     冒険の記録（ダンジョン別に出会った敵・手に入れた装備・潜った履歴）は state.records に書く（js/model/records.js）
//     roster / inventory: js/model/roster.js・inventory.js の戻り値
//     battleEnv(): 戦闘エンジンに渡す env（game.js の battleEnv）
//     autoDisassemble(): いまの自動分解の設定 { enabled, rarities }
//     markDexSeen(key) / setBestStage(n): 図鑑・最高到達の記録（端末の別キーに保存するもの）
//     now(): 現在時刻（ミリ秒。オフライン精算の経過時間に使う）
//     canAddMonster(): 仲間のBOXに空きがあるか（js/model/shop.js。満員の間はテイムの抽選をしない）
(function (root) {
  "use strict";
  const core = root.QPCore || {};
  const rewards = core.rewards || (typeof require === "function" ? require("../core/rewards.js") : null);
  const battleCore = core.battle || (typeof require === "function" ? require("../core/battle.js") : null);
  const offline = core.offline || (typeof require === "function" ? require("../core/offline.js") : null);
  const statsCore = core.stats || (typeof require === "function" ? require("../core/stats.js") : null);
  const recordsMod = (root.QPModel && root.QPModel.records) || (typeof require === "function" ? require("./records.js") : null);

  // オフライン精算: これを超えた経過時間は切り捨てる
  const OFFLINE_MAX_MS = 8 * 60 * 60 * 1000;
  // 1周の目安秒数（x1速度想定。バックグラウンド復帰時に「1周ぶん経ったか」を判断する目安）
  const OFFLINE_TIMING = {
    perBattle: 5, // 1戦闘あたりの目安秒数
    perGap: 2, // 戦闘間の道中イベント・インターバルの目安
    overhead: 2, // 出発〜踏破演出、周回間の待機の目安
  };
  const OFFLINE_BATTLE_MAX_SECONDS = 300; // これを超えて決着しない戦闘は負け扱い（お互い倒しきれない場合の打ち切り）
  const SHRINE_BUFF = 0.12; // 石碑の加護（このダンジョン中のみ、ATK/DEF/SPDのどれかが上がる）

  function createRunner(deps) {
    const S = deps.state;
    const R = deps.roster;
    const Inv = deps.inventory;
    const rng = deps.rng;
    const teamCount = deps.teamCount || 4;
    const { RACES, REWARD_RULES, getDungeon, buildEncounter, getEnemyTemplate, rollItemDrop, rollSpecialDrop } = deps.data;
    // モード（ノーマル・ハード・エクストラ）を反映したダンジョン（js/data.js の getModeDungeon。無ければノーマルのみ）
    const getModeDungeon = deps.data.getModeDungeon || ((id) => getDungeon(id));
    // 装備はそのダンジョンの推奨Lvを装備のレベルにして抽選する。ハード・エクストラは上がったレベルで抽選し、
    // シリーズ・名のある装備は元の地方のまま、オプション効果を付ける
    const dropOpts = (d) => (d.mode ? { regionLevel: d.baseLevel, mode: d.mode } : undefined);
    const dropFor = (d) => () => rollItemDrop(d.level, undefined, dropOpts(d));
    // レア敵・ボスの追加ドロップ（js/uniques.js の rollSpecialDrop。無ければレア敵だけSR以上の装備）
    const rareDropFor = (d) => (enemy) => (rollSpecialDrop ? rollSpecialDrop(d.level, enemy, dropOpts(d))
      : enemy && enemy.isBoss ? null : rollItemDrop(d.level, "sr", dropOpts(d)));
    // そのモードの踏破済みダンジョンの集合（ノーマルは S.clearedDungeons）
    function clearedSet(mode) {
      if (mode === "hard") return S.clearedHard || (S.clearedHard = new Set());
      if (mode === "extra") return S.clearedExtra || (S.clearedExtra = new Set());
      return S.clearedDungeons;
    }
    // オプション効果「パーティの獲得EXP」「パーティの強化石」の倍率
    const partyMult = (teamIndex, key) => 1 + (R.partyBonus ? R.partyBonus(teamIndex, key) : 0);
    const markDexSeen = deps.markDexSeen || (() => {});
    const setBestStage = deps.setBestStage || (() => {});
    const now = deps.now || (() => Date.now());
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const ITEM_BASES = deps.data.ITEM_BASES || [];
    function records() { return S.records || (S.records = recordsMod.createRecords()); }

    // チームごとの進行状態(run)・戦闘状態(battle)。4チームがそれぞれ独立にダンジョンへ出撃できる
    const teamRuns = new Array(teamCount).fill(null);
    const teamBattles = new Array(teamCount).fill(null);

    function isTeamRunActive(i) { const r = teamRuns[i]; return !!(r && !r.finished); }
    // そのチームが探索中で、編成・装備・スキル・転職・合成などの変更を受け付けられない状態か
    function isTeamLocked(i) { return isTeamRunActive(i) || S.autoRepeat[i].active; }
    // 石碑の加護は、そのチームが挑戦中のダンジョンの間だけ乗る
    function runBuffs(team) { const r = teamRuns[team]; return r && !r.finished ? r.buffs : null; }

    // ダンジョンを終えたチームのメンバーだけHP/MPを全回復する（他チームの戦闘中の状態には触れない）
    function restoreTeamParty(teamIndex) {
      for (const c of R.teamMembers(teamIndex)) {
        c.hp = R.computeStats(c).maxHp;
        c.mp = R.computeStats(c).maxMp;
        c.alive = true;
      }
    }

    // ---------- 出発・戦闘 ----------
    // mode: "normal"（省略時）| "hard" | "extra"
    function startRun(teamIndex, dungeonId, mode) {
      const d = getModeDungeon(dungeonId, mode);
      const filter = deps.autoDisassemble ? deps.autoDisassemble() : { enabled: false, rarities: new Set() };
      const run = {
        team: teamIndex, dungeon: d, battleIndex: 0, finished: false,
        buffs: { atk: 0, mag: 0, def: 0, spd: 0 },
        expTotal: 0, drops: [], pendingDrops: [], levelUps: [], abilityUnlocks: [], defeatedTamable: [],
        disassembleCount: 0, materialGained: 0,
        // 出撃時点の自動分解設定をスナップショットしておく（この周回中に設定画面で変更しても
        // 途中から挙動が変わらないようにするため。おかげで自動分解の設定はロック不要になる）
        autoDisassemble: filter.enabled, autoDisassembleRarities: new Set(filter.rarities),
      };
      teamRuns[teamIndex] = run;
      for (const c of R.teamMembers(teamIndex)) {
        const s = R.computeStats(c);
        c.hp = s.maxHp; c.mp = s.maxMp; c.alive = true;
      }
      return run;
    }

    // run.battleIndex 戦目を始める。結果: { battle, isBoss }
    function startBattle(run) {
      const d = run.dungeon;
      const isBoss = run.battleIndex === d.battles - 1;
      const enemies = buildEncounter(d, run.battleIndex);
      const battle = {
        enemies: enemies.map((e, i) => ({ ...e, id: "e" + i, alive: true })),
        active: true,
      };
      teamBattles[run.team] = battle;
      for (const e of battle.enemies) { markDexSeen(e.key); recordsMod.recordEncounter(records(), d.id, e.key); }
      for (const c of R.teamMembers(run.team)) { c.atb = rng.float(0, 25); c.defending = false; c.actedFlash = 0; }
      return { battle, isBoss };
    }

    // 戦闘をdt秒進める（js/core/battle.js）。決着したら battle.active を false にする。結果: { events, result }
    function stepBattle(teamIndex, dt) {
      const battle = teamBattles[teamIndex];
      const out = battleCore.step(battle, R.teamMembers(teamIndex), dt, deps.battleEnv());
      if (out.result) battle.active = false;
      return out;
    }

    // 戦闘に勝った時の処理: 生存者にEXP、テイム候補の記録、ドロップ（踏破まで保留）。
    // 最後の戦闘なら踏破を記録し、テイムを判定する。それ以外は次の戦闘へ進める。
    // 結果: { expGain, isLast, firstClear, unlocked（初踏破で解放されたダンジョン）, tameResult }
    function winBattle(run, battle) {
      const expGain = rewards.battleExp(battle.enemies);
      run.expTotal += expGain;
      for (const e of battle.enemies) {
        const tpl = getEnemyTemplate(e.key);
        if (tpl && tpl.tamable) run.defeatedTamable.push(e.key);
      }
      const expMult = partyMult(run.team, "expBonus");
      for (const c of R.teamMembers(run.team)) {
        if (!c.alive) continue;
        const result = R.gainExp(c, Math.round(rewards.expForMember(expGain, RACES[c.race].expMult) * expMult));
        run.levelUps.push(...result.levelUps);
        run.abilityUnlocks.push(...result.abilityUnlocks);
      }
      // ドロップは即座に所持品化・分解せず、ダンジョンを踏破した時だけ確定させる（全滅した場合は持ち帰れない）
      run.pendingDrops.push(...rewards.rollBattleDrops(REWARD_RULES, dropFor(run.dungeon), rng));
      run.pendingDrops.push(...rewards.rollRareDrops(battle.enemies, rareDropFor(run.dungeon)));

      const isLast = run.battleIndex + 1 >= run.dungeon.battles;
      if (!isLast) {
        run.battleIndex += 1;
        return { expGain, isLast: false, firstClear: false, unlocked: [], tameResult: null };
      }
      const cleared = clearedSet(run.dungeon.mode);
      const firstClear = !cleared.has(run.dungeon.id);
      cleared.add(run.dungeon.id);
      setBestStage(S.clearedDungeons.size);
      // 次のダンジョンが開くのはノーマルの初踏破だけ（ハード・エクストラの初踏破は、次のモードが開く）
      const unlocked = firstClear && !run.dungeon.mode ? run.dungeon.unlocks.map((id) => getDungeon(id)).filter(Boolean) : [];
      return { expGain, isLast: true, firstClear, unlocked, tameResult: attemptTame(run) };
    }

    // ---------- テイム（ダンジョンクリア時に判定） ----------
    // 結果: null（候補なし）／{ success: false, name }／{ success: true, name, char }
    const canAddMonster = deps.canAddMonster || (() => true);
    // 結果: null（テイムできる敵を倒していない）／{ full: true }（仲間のBOXが満員で抽選しない）／{ success, name, char? }
    function attemptTame(run) {
      if (run.defeatedTamable.length === 0) return null;
      if (!canAddMonster()) return { success: false, full: true };
      const result = rewards.rollTame(run.defeatedTamable, (key) => getEnemyTemplate(key).tameChance, rng);
      if (!result) return null;
      const tpl = getEnemyTemplate(result.key);
      if (!result.success) return { success: false, name: tpl.name };
      return { success: true, name: tpl.name, char: addTamedMonster(result.key) };
    }

    // テイムに成功したモンスターをロスターに加える（通常プレイ・オフライン精算で共通）。
    // どのダンジョンでテイムしてもLv1から（育成は戦闘のEXPかモンスター合成で行う）
    function addTamedMonster(key) {
      const tpl = getEnemyTemplate(key);
      const mon = R.newCharacter(tpl.name, null, key, { level: 1, isMonster: true });
      // 個体値（能力値ごとの個体差）はテイムした時に1回だけ決まる
      if (deps.data.MONSTER_IV_RANGE) {
        mon.ivs = statsCore.rollIvs(rng, deps.data.MONSTER_IV_RANGE);
        const s = R.computeStats(mon);
        mon.hp = s.maxHp; mon.mp = s.maxMp;
      }
      S.roster.push(mon);
      return mon;
    }

    // ---------- 道中イベント ----------
    // 罠: 45%で全体（最大HPの10%）、それ以外は1人（18%）。罠では戦闘不能にならない。結果: { wide, hits: [{ c, dmg }] }
    function applyTrap(alive) {
      const wide = rng.chance(0.45);
      const targets = wide ? alive : [rng.pick(alive)];
      const ratio = wide ? 0.1 : 0.18;
      const hits = targets.map((c) => {
        const dmg = Math.max(1, Math.round(R.computeStats(c).maxHp * ratio * rng.float(0.85, 1.15)));
        c.hp = Math.max(1, c.hp - dmg);
        return { c, dmg };
      });
      return { wide, hits };
    }
    // 泉: 生存者のHPを最大の30%、MPを25%回復する。結果: { heals: [{ c, hp, mp }] }
    function applySpring(alive) {
      const heals = alive.map((c) => {
        const s = R.computeStats(c);
        const hp = Math.round(s.maxHp * 0.3);
        const mp = Math.round(s.maxMp * 0.25);
        c.hp = Math.min(s.maxHp, c.hp + hp);
        c.mp = Math.min(s.maxMp, c.mp + mp);
        return { c, hp, mp };
      });
      return { heals };
    }

    // 戦闘の合間の道中イベントを抽選して反映する（確率と重みは REWARD_RULES。オフライン精算と共通）。
    // 結果: null（何も起きない・対象がいない）または
    //   { kind: "treasure", item（空ならnull） } / { kind: "trap", wide, hits } / { kind: "spring", heals } /
    //   { kind: "shrine", stat, total（このダンジョン中の合計の上昇率） }
    function rollEvent(run) {
      const kind = rewards.rollEventKind(REWARD_RULES, rng);
      if (!kind) return null;
      if (kind === "treasure") {
        const item = rewards.rollTreasure(REWARD_RULES, dropFor(run.dungeon), rng);
        if (item) run.pendingDrops.push(item);
        return { kind, item: item || null };
      }
      if (kind === "shrine") {
        const stat = rng.pick(["atk", "def", "spd"]);
        run.buffs[stat] = (run.buffs[stat] || 0) + SHRINE_BUFF;
        return { kind, stat, total: run.buffs[stat] };
      }
      const alive = R.teamMembers(run.team).filter((p) => p.alive);
      if (alive.length === 0) return null;
      if (kind === "trap") return Object.assign({ kind }, applyTrap(alive));
      return Object.assign({ kind }, applySpring(alive));
    }

    // ---------- 周回の終了 ----------
    // 踏破なら保留していたドロップを確定し（出撃時の自動分解設定で振り分け）、チームを回復する。
    // 全滅・クリアで回復するのは「このチームのメンバー」だけ（他チームの戦闘状態を壊さない）
    // extra: { tamed（テイムしたモンスターの名前。冒険の記録に残す） }
    function finishRun(run, cleared, extra) {
      run.finished = true;
      run.wiped = !cleared;
      if (cleared) {
        recordsMod.recordItemsFound(records(), run.pendingDrops, ITEM_BASES); // 自動分解する物も「手に入れた」に数える
        const settled = Inv.receiveDrops(run.pendingDrops, { enabled: run.autoDisassemble, rarities: run.autoDisassembleRarities },
          partyMult(run.team, "materialBonus"));
        run.disassembleCount += settled.disassembled;
        run.materialGained += settled.materialGained;
        run.drops.push(...settled.kept);
      }
      recordsMod.addRunHistory(records(), {
        at: now(), team: run.team, dungeonId: run.dungeon.id, mode: run.dungeon.mode || "normal", cleared,
        battlesWon: cleared ? run.dungeon.battles : run.battleIndex, battles: run.dungeon.battles,
        exp: run.expTotal, items: run.drops.length, disassembled: run.disassembleCount, material: run.materialGained,
        tamed: (extra && extra.tamed) || null,
      });
      restoreTeamParty(run.team);
    }

    // 終わった周回を自動周回の進行に反映し、続けるかを決める（finishRun の後に呼ぶ）。
    // 結果: null（自動周回中でない）| "stoppedByWipe" | "completed" | "continue"
    function advanceAutoRepeat(run) {
      const ar = S.autoRepeat[run.team];
      if (!ar.active) return null;
      if (run.wiped) { ar.active = false; return "stoppedByWipe"; }
      ar.done += 1;
      if (ar.done >= ar.target) { ar.active = false; return "completed"; }
      return "continue";
    }

    // 進行中の周回を打ち切る（バックグラウンド復帰時の精算用。この周の未確定ドロップは持ち帰れない）。
    // 結果: 打ち切った周回があれば true
    function interruptRun(teamIndex) {
      const run = teamRuns[teamIndex];
      let interrupted = false;
      if (run && !run.finished) {
        run.finished = true;
        if (teamBattles[teamIndex]) teamBattles[teamIndex].active = false;
        interrupted = true;
      }
      restoreTeamParty(teamIndex);
      return interrupted;
    }

    // ---------- オフライン精算 ----------
    function estimateOfflineRunSeconds(dungeon) {
      return offline.estimateRunSeconds(dungeon.battles, OFFLINE_TIMING);
    }

    // 1周ぶんの結果をjs/core/offline.jsで計算する（ゲームの状態はまだ変えない）。
    // 戦闘は通常プレイと同じ戦闘エンジンで、そのチームのキャラの「写し」を実際に戦わせる。写しは装備・スキルツリー・
    // 技の設定を本体と共有するので強さはそのまま反映され、HP/MP・戦闘不能は写し側だけで変化する（周回の間で持ち越す）
    function computeOfflineRun(dungeon, teamIndex) {
      const party = R.teamMembers(teamIndex).map((c) => {
        const s = R.computeStats(c);
        return Object.assign({}, c, { hp: s.maxHp, mp: s.maxMp, atb: 0, alive: true, actedFlash: 0 });
      });
      const env = deps.battleEnv();
      return offline.simulateRun({
        battles: dungeon.battles,
        rng,
        rules: REWARD_RULES,
        timing: OFFLINE_TIMING,
        buildEncounter: (i) => buildEncounter(dungeon, i),
        fight: (enemies) => {
          if (party.length === 0) return { won: false, seconds: 0 };
          const battle = { enemies: enemies.map((e, i) => ({ ...e, id: "e" + i, alive: true })) };
          for (const c of party) { c.atb = rng.float(0, 25); c.defending = false; }
          const r = battleCore.simulate(battle, party, env, { maxSeconds: OFFLINE_BATTLE_MAX_SECONDS });
          return { won: r.result === "victory", seconds: r.seconds };
        },
        // 泉と罠は戦闘に影響するので写しに反映する（石碑の加護は省略。実際のプレイよりわずかに厳しめになる）
        onEvent: (kind) => {
          const alive = party.filter((c) => c.alive);
          if (alive.length === 0) return;
          if (kind === "spring") applySpring(alive);
          else if (kind === "trap") applyTrap(alive);
        },
        isTamable: (key) => { const tpl = getEnemyTemplate(key); return !!(tpl && tpl.tamable); },
        tameChanceOf: (key) => getEnemyTemplate(key).tameChance,
        rollOne: dropFor(dungeon),
        rollRareOne: rareDropFor(dungeon),
      });
    }

    // computeOfflineRunの結果をゲームの状態に反映する。通常プレイと同じ扱い:
    // - EXPは勝利した戦闘ごとに即時付与（全滅した周でも、それまでに勝った戦闘のEXPは残る）
    // - ドロップ（戦闘・道中の宝箱）とテイムは踏破した周だけ持ち帰れる
    // - 遭遇した敵は図鑑に登録する
    // 戦闘中に倒れたメンバーも含め、EXPはパーティ全員に付与する（通常プレイでは生存者のみ）
    function applyOfflineRun(outcome, dungeon, teamIndex) {
      const party = R.teamMembers(teamIndex);
      for (const key of outcome.encountered) { markDexSeen(key); recordsMod.recordEncounter(records(), dungeon.id, key); }
      let expTotal = 0;
      const expMult = partyMult(teamIndex, "expBonus");
      for (const exp of outcome.expByBattle) {
        expTotal += exp;
        for (const c of party) R.gainExp(c, Math.round(rewards.expForMember(exp, RACES[c.race].expMult) * expMult));
      }
      if (!outcome.cleared) return { cleared: false, expTotal };

      const filter = deps.autoDisassemble ? deps.autoDisassemble() : { enabled: false, rarities: new Set() };
      recordsMod.recordItemsFound(records(), outcome.drops, ITEM_BASES);
      const settled = Inv.receiveDrops(outcome.drops, filter, partyMult(teamIndex, "materialBonus"));
      let tamedName = null, tameBlocked = false;
      if (outcome.tame) {
        // 仲間のBOXが満員なら、テイムの抽選は無かったことにする（通常プレイと同じ）
        if (!canAddMonster()) tameBlocked = true;
        else if (outcome.tame.success) tamedName = addTamedMonster(outcome.tame.key).name;
      }
      clearedSet(dungeon.mode).add(dungeon.id);
      setBestStage(S.clearedDungeons.size);
      return { cleared: true, expTotal, itemsGained: settled.kept.length, tamedName, tameBlocked };
    }

    // 保存されていたそのチームの自動周回状態と経過時間から、離れていた間の周回をまとめて計算する
    function runOfflineProgressForTeam(teamIndex, autoRepeatInfo, savedAt) {
      if (!autoRepeatInfo || !autoRepeatInfo.active || !autoRepeatInfo.dungeonId || !savedAt) return null;
      const dungeon = getModeDungeon(autoRepeatInfo.dungeonId, autoRepeatInfo.mode);
      if (!dungeon) return null;
      // 離れていた時間（最大8時間。端末の時計が戻っていても負にしない）を、実際に戦った時間で使い切るまで周回する。
      // 時間内に終わらなかった周は数えない（その周の結果は反映しない）
      let budgetSeconds = clamp(now() - savedAt, 0, OFFLINE_MAX_MS) / 1000;
      const remainingTarget = Math.max(0, autoRepeatInfo.target - autoRepeatInfo.done);

      let cleared = 0, expGained = 0, itemsGained = 0, runsDone = 0;
      const tamedNames = [];
      let wipedOut = false, tameBlocked = 0;
      for (let i = 0; i < remainingTarget; i++) {
        const outcome = computeOfflineRun(dungeon, teamIndex);
        if (outcome.seconds > budgetSeconds) break;
        budgetSeconds -= outcome.seconds;
        runsDone += 1;
        const result = applyOfflineRun(outcome, dungeon, teamIndex);
        expGained += result.expTotal;
        if (!result.cleared) { wipedOut = true; break; }
        cleared += 1;
        itemsGained += result.itemsGained;
        if (result.tamedName) tamedNames.push(result.tamedName);
        if (result.tameBlocked) tameBlocked += 1;
      }

      // 自動周回はここで一旦停止し、プレイヤーが結果を確認してから再開できるようにする
      S.autoRepeat[teamIndex].active = false;
      S.autoRepeat[teamIndex].target = autoRepeatInfo.target;
      S.autoRepeat[teamIndex].done = autoRepeatInfo.done + cleared; // 通常プレイと同じく、全滅しても完了周回数は戻さない

      // 離れていた間の周回は、まとめて1件の履歴にする
      if (runsDone > 0) {
        recordsMod.addRunHistory(records(), {
          at: now(), team: teamIndex, dungeonId: dungeon.id, mode: dungeon.mode || "normal", cleared: !wipedOut, offline: true,
          runs: runsDone, clears: cleared, exp: expGained, items: itemsGained,
          tamed: tamedNames.length ? tamedNames.join("、") : null,
        });
      }

      // 1周ぶんの時間も経っていなかった場合も、自動周回が止まった理由をモーダルで伝えるため結果を返す
      const tooShort = runsDone === 0;
      const modeName = { hard: "ハード", extra: "エクストラ" }[dungeon.mode];
      return { team: teamIndex, dungeonName: modeName ? `${dungeon.name}（${modeName}）` : dungeon.name, cleared, expGained, itemsGained, tamedNames, tameBlocked, wipedOut, tooShort };
    }

    // チームごとに独立して計算するため、複数チームが同時にオフライン進行することもある
    function runOfflineProgress(savedAutoRepeatArray, savedAt) {
      const summaries = [];
      for (let i = 0; i < teamCount; i++) {
        const summary = runOfflineProgressForTeam(i, savedAutoRepeatArray[i], savedAt);
        if (summary) summaries.push(summary);
      }
      return summaries.length > 0 ? summaries : null;
    }

    return {
      teamRuns, teamBattles,
      isTeamRunActive, isTeamLocked, runBuffs, restoreTeamParty,
      startRun, startBattle, stepBattle, winBattle, attemptTame, addTamedMonster,
      rollEvent, finishRun, advanceAutoRepeat, interruptRun,
      estimateOfflineRunSeconds, computeOfflineRun, applyOfflineRun, runOfflineProgressForTeam, runOfflineProgress,
    };
  }

  const exported = { createRunner, OFFLINE_MAX_MS, OFFLINE_TIMING, OFFLINE_BATTLE_MAX_SECONDS, SHRINE_BUFF };
  root.QPModel = root.QPModel || {};
  root.QPModel.run = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

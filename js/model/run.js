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
  const rngMod = core.rng || (typeof require === "function" ? require("../core/rng.js") : null);
  const dungeonTrial = core.dungeonTrial || (typeof require === "function" ? require("../core/dungeon-trial.js") : null);
  const dungeonCheckpoint = core.dungeonCheckpoint || (typeof require === "function" ? require("../core/dungeon-checkpoint.js") : null);

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
    // 乱数はチームの周回ごとに分ける（課金設計書§4.2）。出発時に基の乱数（deps.rng）から周回のシードを1つ引き、
    // その周回の抽選（遭遇・戦闘・ドロップ・道中イベント・テイム）はすべてそのシードの並びから引く。
    // 他のチームがいつ乱数を使ったか・どのチームを表示しているかで、別のチームの勝敗やドロップが変わらないようにするため。
    // rng は「いま処理している周回」の並びから引く（周回の外では基の乱数）。inStream の間は共有の乱数（js/data.js の
    // 抽選が使う RNG）も同じ並びに切り替える
    const baseRng = deps.rng;
    let activeSource = null;
    const rng = rngMod.fromSource(() => (activeSource ? activeSource() : baseRng.next()));
    function newStream() { return rngMod.seededSource(baseRng.int(4294967296)); }
    function inStream(source, fn) {
      const prev = activeSource;
      activeSource = source;
      try { return rngMod.withSharedSource(source, fn); } finally { activeSource = prev; }
    }
    const inRun = (run, fn) => inStream(run.rngSource, fn);
    const teamCount = deps.teamCount || 4;
    const { RACES, REWARD_RULES, getDungeon, buildEncounter, getEnemyTemplate, makeEnemy, rollItemDrop, rollSpecialDrop } = deps.data;
    // ?dungeonPilot=1 を付けたプレビューで、序盤3ダンジョンだけ実戦に接続する。
    const pilotEnabled = !!deps.enableFloorPilot && !!dungeonTrial && typeof makeEnemy === "function";
    const pilotIds = new Set(["plains", "forest", "cave"]);
    const isPilotDungeon = (d) => pilotEnabled && !!d && pilotIds.has(d.id);
    function createPilotSchedule(d) {
      const floorPlans = dungeonTrial.createFloorPlan(d, rng);
      const schedule = [];
      for (const plan of floorPlans) {
        for (let i = 0; i < plan.regularBattles; i++) schedule.push({ floor: plan.floor, boss: null, regularIndex: i + 1 });
        if (plan.boss) schedule.push({ floor: plan.floor, boss: plan.boss, regularIndex: null });
      }
      return { floorPlans, schedule };
    }
    function buildPilotEncounter(d, entry) {
      const planned = dungeonTrial.createEncounterPlan(d, entry.floor, rng, entry.boss);
      const roles = planned.enemyRoles.map((x) => Object.assign({}, x, { isRare: false }));
      if (!entry.boss && Array.isArray(d.rares) && d.rares.length && rng.chance(0.04)) {
        const chosen = rng.int(roles.length);
        roles[chosen].key = rng.pick(d.rares);
        roles[chosen].isRare = true;
      }
      return roles.map((role) => {
        const tpl = getEnemyTemplate(role.key);
        if (!tpl) throw new RangeError("Unknown enemy: " + role.key);
        // 旧battleIndex×6%を全戦闘数へ掛けない。階層による緩やかな伸びだけ適用。
        // 深層の通常敵だけの強さを後から校正可能にする。
        // 中ボス・最終ボスには適用しない。通常設定が無ければ旧値1.0。
        const lateNormalFactor = d.id === "cave" && entry.floor >= 4 && !role.isBoss
          ? (d.pilotLateNormalFactor === undefined ? 1 : d.pilotLateNormalFactor) : 1;
        if (!Number.isFinite(lateNormalFactor) || lateNormalFactor <= 0 || lateNormalFactor > 1) {
          throw new RangeError("invalid pilot late-floor normal multiplier");
        }
        const mult = (1 + (d.level - 1) * 0.12) * (1 + (entry.floor - 1) * 0.045)
          * (role.isBoss ? 1.55 : 1) * lateNormalFactor;
        const enemy = makeEnemy(tpl, mult, role.isBoss, d.power, role.isRare, d.mode);
        enemy.pilotBoss = role.isBoss && d.id === "cave";
        enemy.pilotPhase = 1;
        return enemy;
      });
    }
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
      const originalDungeon = getModeDungeon(dungeonId, mode);
      // 装備×編成試験では洞窟の20%弱化を打ち消し、元の敵強さを使う。
      // ダンジョン本体の静的データは変更しない。
      const d = core.storage && core.storage.isGearTrialMode && core.storage.isGearTrialMode() &&
        originalDungeon.id === "cave"
          ? Object.assign({}, originalDungeon, { pilotLateNormalFactor: 1 })
          : originalDungeon;
      const filter = deps.autoDisassemble ? deps.autoDisassemble() : { enabled: false, rarities: new Set() };
      const run = {
        team: teamIndex, dungeon: d, battleIndex: 0, finished: false,
        buffs: { atk: 0, mag: 0, def: 0, spd: 0 },
        expTotal: 0, drops: [], pendingDrops: [], levelUps: [], abilityUnlocks: [], defeatedTamable: [],
        disassembleCount: 0, materialGained: 0,
        // 出撃時点の自動分解設定をスナップショットしておく（この周回中に設定画面で変更しても
        // 途中から挙動が変わらないようにするため。おかげで自動分解の設定はロック不要になる）
        autoDisassemble: filter.enabled, autoDisassembleRarities: new Set(filter.rarities),
        rngSource: newStream(), // この周回の乱数の並び
      };
      if (isPilotDungeon(d)) {
        const plan = inRun(run, () => createPilotSchedule(d));
        run.pilotFloorPlans = plan.floorPlans;
        run.pilotSchedule = plan.schedule;
        run.dungeon = Object.assign({}, d, { battles: plan.schedule.length, dungeonFloorPilot: true });
        run.pilotCheckpointPhase = "ready";
      }
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
      const entry = run.pilotSchedule && run.pilotSchedule[run.battleIndex];
      const isBoss = entry ? !!entry.boss : run.battleIndex === d.battles - 1;
      const enemies = entry ? buildPilotEncounter(d, entry) : buildEncounter(d, run.battleIndex);
      const battle = {
        enemies: enemies.map((e, i) => ({ ...e, id: "e" + i, alive: true })),
        active: true,
      };
      teamBattles[run.team] = battle;
      if (entry) run.pilotCheckpointPhase = "battle";
      for (const e of battle.enemies) { markDexSeen(e.key); recordsMod.recordEncounter(records(), d.id, e.key); }
      for (const c of R.teamMembers(run.team)) { c.atb = rng.float(0, 25); c.defending = false; c.actedFlash = 0; }
      return { battle, isBoss };
    }

    // 戦闘をdt秒進める（js/core/battle.js）。決着したら battle.active を false にする。
    // 結果: { events, result: null | "victory" | "defeat" | "timeout"（決着がつかず撤退） }
    function stepBattle(teamIndex, dt) {
      const battle = teamBattles[teamIndex];
      const env = Object.assign({}, deps.battleEnv(), { rng });
      const out = battleCore.step(battle, R.teamMembers(teamIndex), dt, env);
      // オフライン精算と同じく、決着がつかないまま OFFLINE_BATTLE_MAX_SECONDS を超えたら打ち切る（撤退。全滅と同じ扱い）
      if (!out.result && battle.time >= OFFLINE_BATTLE_MAX_SECONDS) out.result = "timeout";
      if (out.result) battle.active = false;
      if (out.result && out.result !== "victory" && teamRuns[teamIndex].pilotSchedule) {
        teamRuns[teamIndex].pilotCheckpointPhase = "failPending";
      }
      return out;
    }

    // 戦闘に勝った時の処理: 生存者にEXP、テイム候補の記録、ドロップ（踏破まで保留）。
    // 最後の戦闘なら踏破を記録し、テイムを判定する。それ以外は次の戦闘へ進める。
    // 結果: { expGain, isLast, firstClear, unlocked（初踏破で解放されたダンジョン）, tameResult }
    function winBattle(run, battle) {
      if (run.pilotSchedule) {
        if (teamBattles[run.team] !== battle || battle._pilotResolved) throw new Error("Pilot battle already resolved or mismatched");
        if (battle.enemies.some((e) => e.alive)) throw new Error("Pilot battle still has living enemies");
        battle._pilotResolved = true;
      }
      const expGain = rewards.battleExp(battle.enemies);
      run.expTotal += expGain;
      for (const e of battle.enemies) {
        const tpl = getEnemyTemplate(e.key);
        if (tpl && tpl.tamable && !e.isBoss) run.defeatedTamable.push(e.key);
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
        if (run.pilotSchedule) run.pilotCheckpointPhase = "between";
        return { expGain, isLast: false, firstClear: false, unlocked: [], tameResult: null };
      }
      if (run.pilotSchedule) { run.pilotCleared = true; run.pilotCheckpointPhase = "clearPending"; }
      const cleared = clearedSet(run.dungeon.mode);
      const firstClear = !cleared.has(run.dungeon.id);
      cleared.add(run.dungeon.id);
      setBestStage(S.clearedDungeons.size);
      // 次のダンジョンが開くのはノーマルの初踏破だけ（ハード・エクストラの初踏破は、次のモードが開く）
      const unlocked = firstClear && !run.dungeon.mode ? run.dungeon.unlocks.map((id) => getDungeon(id)).filter(Boolean) : [];
      const tameResult = attemptTame(run);
      if (run.pilotSchedule) run.pilotClearOutcome = { tameResult, unlockedIds: unlocked.map((d) => d.id) };
      return { expGain, isLast: true, firstClear, unlocked, tameResult };
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
    // 盗賊Lv5／忍者Lv1の探索専用スキル。「パーティ中で生存している仲間」
    // のうち最も高い成功率を1回だけ使う。人数で複数回抽選しない。
    function lockpickChance(members) {
      if (typeof R.explorationSkillChance !== "function") return 0;
      return members.reduce((best, c) => c && c.alive && c.hp > 0
        ? Math.max(best, R.explorationSkillChance(c, "thief_lockpick"))
        : best, 0);
    }
    function rollEvent(run) {
      if (run.pilotSchedule) {
        const ev = dungeonTrial.rollPilotEvent(rng, lockpickChance(R.teamMembers(run.team)), dropFor(run.dungeon));
        if (!ev) { run.pilotCheckpointPhase = "ready"; return null; }
        if (ev.item) run.pendingDrops.push(ev.item);
        if (ev.kind === "springAura") {
          run.buffs.def = clamp((run.buffs.def || 0) + ev.defensePercent, -0.24, 0.24);
          ev.total = run.buffs.def;
        }
        run.pilotCheckpointPhase = "ready";
        return ev;
      }
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
      if (run.finished) return; // 同一runの二重報酬付与を防止
      if (run.pilotSchedule && cleared && !run.pilotCleared) throw new Error("Final boss has not been defeated");
      run.finished = true;
      if (run.pilotSchedule) run.pilotCheckpointPhase = "finished";
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
      if (isPilotDungeon(dungeon)) {
        // 最低通常戦闘数+ボス。実際の秒数精算では必ず1周をsimulateして確認する。
        const count = dungeonTrial.FLOOR_COUNTS[dungeon.id];
        const mins = Array.from({ length: count }, (_, i) => dungeonTrial.floorRange(i + 1)[0]);
        return offline.estimateRunSeconds(mins.reduce((a, b) => a + b, 1), OFFLINE_TIMING);
      }
      return offline.estimateRunSeconds(dungeon.battles, OFFLINE_TIMING);
    }

    // 1周ぶんの結果をjs/core/offline.jsで計算する（ゲームの状態はまだ変えない）。
    // 戦闘は通常プレイと同じ戦闘エンジンで、そのチームのキャラの「写し」を実際に戦わせる。写しは装備・スキルツリー・
    // 技の設定を本体と共有するので強さはそのまま反映され、HP/MP・戦闘不能は写し側だけで変化する（周回の間で持ち越す）
    function computeOfflineRun(dungeon, teamIndex, observers) {
      const party = R.teamMembers(teamIndex).map((c) => {
        const s = R.computeStats(c);
        return Object.assign({}, c, { hp: s.maxHp, mp: s.maxMp, atb: 0, alive: true, actedFlash: 0 });
      });
      const env = Object.assign({}, deps.battleEnv(), { rng });
      const pilot = isPilotDungeon(dungeon) ? createPilotSchedule(dungeon) : null;
      const observeBattle = observers && typeof observers.onBattleFinish === "function" ? observers.onBattleFinish : null;
      let offlineAuraDef = 0;
      if (pilot) {
        const originalStats = env.stats;
        env.stats = (member) => {
          const base = originalStats(member);
          return Object.assign({}, base, { def: Math.max(0, Math.round(base.def * (1 + offlineAuraDef))) });
        };
      }
      return offline.simulateRun({
        battles: pilot ? pilot.schedule.length : dungeon.battles,
        rng,
        rules: REWARD_RULES,
        timing: OFFLINE_TIMING,
        buildEncounter: (i) => pilot ? buildPilotEncounter(dungeon, pilot.schedule[i]) : buildEncounter(dungeon, i),
        onBattleFinish: observeBattle ? (result) => observeBattle({
          ...result, floor: pilot ? pilot.schedule[result.index].floor : null,
          boss: pilot ? !!pilot.schedule[result.index].boss : result.index === dungeon.battles - 1,
          alive: party.filter(c => c.alive).length,
          hp: party.reduce((s,c) => s + Math.max(0,c.hp), 0),
          mp: party.reduce((s,c) => s + Math.max(0,c.mp), 0),
        }) : null,
        fight: (enemies) => {
          if (party.length === 0) return { won: false, seconds: 0 };
          const battle = { enemies: enemies.map((e, i) => ({ ...e, id: "e" + i, alive: true })) };
          for (const c of party) { c.atb = rng.float(0, 25); c.defending = false; }
          const r = battleCore.simulate(battle, party, env, {
            maxSeconds: OFFLINE_BATTLE_MAX_SECONDS,
            onStep: observers && typeof observers.onBattleStep === "function"
              ? (step) => observers.onBattleStep(step) : undefined,
          });
          return { won: r.result === "victory", seconds: r.seconds,
            eligibleIds: party.filter((c) => c.alive).map((c) => c.id) };
        },
        // 階層版は通常プレイと同じイベント抽選。旧ルールは従来処理を維持。
        rollEvent: pilot ? () => dungeonTrial.rollPilotEvent(rng, lockpickChance(party), dropFor(dungeon)) : undefined,
        // 泉と罠は戦闘に影響するので写しに反映する（旧石碑は省略）。
        onEvent: (kind, ev) => {
          if (pilot && kind === "springAura") {
            offlineAuraDef = clamp(offlineAuraDef + ev.defensePercent, -0.24, 0.24);
            return;
          }
          const alive = party.filter((c) => c.alive);
          if (alive.length === 0) return;
          if (kind === "spring") applySpring(alive);
          else if (kind === "trap") applyTrap(alive);
        },
        isTamable: (key, enemy) => { const tpl = getEnemyTemplate(key); return !!(tpl && tpl.tamable && !(enemy && enemy.isBoss)); },
        tameChanceOf: (key) => getEnemyTemplate(key).tameChance,
        rollOne: dropFor(dungeon),
        rollRareOne: rareDropFor(dungeon),
      });
    }

    // computeOfflineRunの結果をゲームの状態に反映する。通常プレイと同じ扱い:
    // - EXPは勝利した戦闘ごとに即時付与（全滅した周でも、それまでに勝った戦闘のEXPは残る）
    // - ドロップ（戦闘・道中の宝箱）とテイムは踏破した周だけ持ち帰れる
    // - 遭遇した敵は図鑑に登録する
    // 通常プレイと同じく、勝利した戦闘ごとの生存者にだけEXPを付与する。
    // 旧形式の手動生成結果にeligibleIdsByBattleが無い場合は互換のため全員扱い。
    function applyOfflineRun(outcome, dungeon, teamIndex, disassembleFilter) {
      const party = R.teamMembers(teamIndex);
      for (const key of outcome.encountered) { markDexSeen(key); recordsMod.recordEncounter(records(), dungeon.id, key); }
      let expTotal = 0;
      const expMult = partyMult(teamIndex, "expBonus");
      for (const [index, exp] of outcome.expByBattle.entries()) {
        expTotal += exp;
        const ids = outcome.eligibleIdsByBattle && outcome.eligibleIdsByBattle[index];
        const eligible = Array.isArray(ids) ? new Set(ids) : null;
        for (const c of party) {
          if (eligible && !eligible.has(c.id)) continue;
          R.gainExp(c, Math.round(rewards.expForMember(exp, RACES[c.race].expMult) * expMult));
        }
      }
      if (!outcome.cleared) return { cleared: false, expTotal };

      const filter = disassembleFilter || (deps.autoDisassemble ? deps.autoDisassemble() : { enabled: false, rarities: new Set() });
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
      // 旧セーブに保存された設定が無ければ、開始時の現設定を一度だけ読み取り固定する。
      const storedFilter = autoRepeatInfo.disassembleFilter;
      const validRarities = new Set((deps.data.RARITIES || []).map((r) => r.key));
      const filter = storedFilter && typeof storedFilter === "object" && typeof storedFilter.enabled === "boolean" && Array.isArray(storedFilter.rarities)
        ? { enabled: storedFilter.enabled,
          rarities: new Set(storedFilter.rarities.filter((key) => validRarities.has(key))) }
        : (() => { const current = deps.autoDisassemble ? deps.autoDisassemble() : { enabled: false, rarities: new Set() };
          return { enabled: !!current.enabled, rarities: new Set(current.rarities) }; })();
      const stream = newStream(); // 離れていた間の周回は、このチームだけの乱数の並びで計算する
      for (let i = 0; i < remainingTarget; i++) {
        const outcome = inStream(stream, () => computeOfflineRun(dungeon, teamIndex));
        if (outcome.seconds > budgetSeconds) break;
        budgetSeconds -= outcome.seconds;
        runsDone += 1;
        const result = inStream(stream, () => applyOfflineRun(outcome, dungeon, teamIndex, filter));
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

    // 試験モードに限り、進行中の周回と戦闘状態をセーブ内の任意フィールドとして保持する。
    function capturePilotRuns() {
      if (!pilotEnabled || !dungeonCheckpoint) return null;
      return teamRuns.map((run, team) => run && run.pilotSchedule && !run.finished
        ? dungeonCheckpoint.capture(run, teamBattles[team], R.teamMembers(team)) : null);
    }

    // 壊れたチェックポイントは個別に無視し、残りのセーブ内容は復元する。
    function restorePilotRuns(raw) {
      const restored = [];
      if (!pilotEnabled || !dungeonCheckpoint || !Array.isArray(raw)) return restored;
      for (let team = 0; team < teamCount; team++) {
        const saved = raw[team];
        if (!saved || teamRuns[team] || typeof saved.dungeonId !== "string") continue;
        let d;
        try { d = getModeDungeon(saved.dungeonId, saved.mode); } catch (_) { continue; }
        if (!isPilotDungeon(d)) continue;
        const floors = dungeonTrial.FLOOR_COUNTS[d.id];
        if (!dungeonCheckpoint.validate(saved, d, team, floors)) continue;
        const members = R.teamMembers(team);
        if (saved.members.length !== members.length || saved.members.some((p) => !members.some((m) => m.id === p.id))) continue;
        const schedule = [];
        for (const plan of saved.floorPlans) {
          for (let i = 0; i < plan.regularBattles; i++) schedule.push({ floor: plan.floor, boss: null, regularIndex: i + 1 });
          if (plan.boss) schedule.push({ floor: plan.floor, boss: plan.boss, regularIndex: null });
        }
        const source = rngMod.seededSource(0);
        source.setState(saved.rngState);
        const run = {
          team, dungeon: Object.assign({}, d, { battles: schedule.length, dungeonFloorPilot: true }),
          battleIndex: saved.battleIndex, finished: false, rngSource: source,
          buffs: saved.buffs, expTotal: saved.expTotal,
          pendingDrops: saved.pendingDrops, drops: [],
          levelUps: saved.levelUps, abilityUnlocks: saved.abilityUnlocks,
          defeatedTamable: saved.defeatedTamable, disassembleCount: saved.disassembleCount,
          materialGained: saved.materialGained, autoDisassemble: !!saved.autoDisassemble,
          autoDisassembleRarities: new Set(saved.autoDisassembleRarities),
          pilotFloorPlans: saved.floorPlans, pilotSchedule: schedule,
          pilotCleared: !!saved.pilotCleared,
          pilotCheckpointPhase: saved.phase, pilotClearOutcome: saved.pilotClearOutcome || null,
        };
        for (const p of saved.members) {
          const c = members.find((m) => m.id === p.id);
          const max = R.computeStats(c);
          c.hp = clamp(p.hp, 0, max.maxHp); c.mp = clamp(p.mp, 0, max.maxMp);
          c.alive = !!p.alive && c.hp > 0; c.atb = clamp(p.atb, 0, 100);
          c.defending = !!p.defending; c.actedFlash = p.actedFlash || 0;
        }
        teamRuns[team] = run;
        if (saved.phase === "battle") teamBattles[team] = dungeonCheckpoint.restoreBattle(saved.battle, members);
        restored.push(team);
      }
      return restored;
    }

    // 周回の中で乱数を使う処理は、その周回の乱数の並びで実行する（周回のないチームは基の乱数）
    const inTeam = (teamIndex, fn) => (teamRuns[teamIndex] ? inRun(teamRuns[teamIndex], fn) : fn());
    return {
      teamRuns, teamBattles, capturePilotRuns, restorePilotRuns,
      isTeamRunActive, isTeamLocked, runBuffs, restoreTeamParty,
      startRun,
      startBattle: (run) => inRun(run, () => startBattle(run)),
      stepBattle: (teamIndex, dt) => inTeam(teamIndex, () => stepBattle(teamIndex, dt)),
      winBattle: (run, battle) => inRun(run, () => winBattle(run, battle)),
      attemptTame: (run) => inRun(run, () => attemptTame(run)),
      addTamedMonster,
      rollEvent: (run) => inRun(run, () => rollEvent(run)),
      finishRun, advanceAutoRepeat, interruptRun,
      estimateOfflineRunSeconds,
      computeOfflineRun: (dungeon, teamIndex, observers) => inStream(
        observers && Number.isSafeInteger(observers.seed) && observers.seed >= 0 && observers.seed <= 0xffffffff
          ? rngMod.seededSource(observers.seed) : newStream(),
        () => computeOfflineRun(dungeon, teamIndex, observers)),
      applyOfflineRun, runOfflineProgressForTeam, runOfflineProgress,
    };
  }

  const exported = { createRunner, OFFLINE_MAX_MS, OFFLINE_TIMING, OFFLINE_BATTLE_MAX_SECONDS, SHRINE_BUFF };
  root.QPModel = root.QPModel || {};
  root.QPModel.run = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

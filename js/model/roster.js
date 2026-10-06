// ---------- キャラまわり（model/roster） ----------
// キャラの作成・EXPとレベルアップ・転職・上級職の解放・スキルツリー（SP・ノード取得・汎用枠の交換・
// パッシブ効果）・能力値の計算・使える技など、キャラに関するルールをまとめる。画面には依存しない。
// ゲームのデータ（js/data.js）と状態（js/model/save.js の createState）は引数で受け取る:
//   createRoster({ data, state, runBuffs(team) → 挑戦中ダンジョンの石碑の加護 or null, isTeamLocked(team) → 探索中か })
(function (root) {
  "use strict";
  const stats = (root.QPCore && root.QPCore.stats) || (typeof require === "function" ? require("../core/stats.js") : null);

  function createRoster(deps) {
    const S = deps.state;
    const runBuffs = deps.runBuffs || (() => null);
    const isTeamLocked = deps.isTeamLocked || (() => false);
    const {
      JOBS, MONSTER_JOBS, RACES, SLOTS, GENERAL_SLOTS, expForLevel, isFeatureEnabled, jobTag,
      getExclusiveTreeByTag, getGeneralTree, getGeneralSlotDef, getAbilityById, itemEffectiveValue,
    } = deps.data;

    // EXPを加算し、レベルアップ・アビリティ習得をまとめて処理する（戦闘勝利時・モンスター合成時で共用）
    function gainExp(c, amount) {
      const levelUps = [];
      const abilityUnlocks = [];
      c.exp += amount;
      while (c.exp >= c.expToNext) {
        c.exp -= c.expToNext;
        c.level += 1;
        c.expToNext = expForLevel(c.level);
        const s = computeStats(c);
        c.hp = s.maxHp; c.mp = s.maxMp;
        levelUps.push(c.name + " Lv." + c.level);
        for (const a of jobDef(c).abilities) {
          if (a.reqLevel === c.level) abilityUnlocks.push(`${c.name}が「${a.name}」を習得！`);
        }
      }
      // 転職してもレベルを保持できるよう、現在のジョブの進行を都度書き戻す。
      // スキルツリーの取得ノード等(skillTree)は丸ごと置換せずマージして保持する
      if (!c.isMonster) c.jobLevels[c.job] = Object.assign({}, c.jobLevels[c.job], { level: c.level, exp: c.exp, expToNext: c.expToNext });
      return { levelUps, abilityUnlocks };
    }

    // キャラがLv.1からここまで積み上げたおおよそのEXP総量（モンスター合成の還元量計算に使用）
    function totalExpInvested(c) {
      let total = c.exp;
      for (let n = 1; n < c.level; n++) total += expForLevel(n);
      return total;
    }

    function newCharacter(name, job, race, opts) {
      opts = opts || {};
      const c = {
        id: "c" + S.nextCharSeq++, name, job, race: race || "human",
        subAbilityIds: [null, null],
        jobLevels: {}, // ジョブID -> {level, exp, expToNext}（転職してもレベルを保持するため）
        skillActive: {}, // abilityId -> bool (default true when unlocked)
        abilityPriority: {}, // abilityId -> 1(温存)/2(通常)/3(優先)、既定2
        targetPriority: "weakest", // weakest / strongest / random
        level: opts.level || 1, exp: 0, expToNext: expForLevel(opts.level || 1),
        equip: { weapon: null, armor: null, accessory: null },
        atb: 0, defending: false, alive: true,
        team: opts.team !== undefined ? opts.team : null, // 0..3 所属チーム / null は控え
        isMonster: opts.isMonster || false,
      };
      c.expToNext = expForLevel(c.level);
      if (!c.isMonster && job) c.jobLevels[job] = Object.assign({}, c.jobLevels[job], { level: c.level, exp: c.exp, expToNext: c.expToNext });
      const s = computeStats(c);
      c.hp = s.maxHp; c.mp = s.maxMp;
      return c;
    }

    // 転職: 直前のジョブの進行を保存し、切り替え先のジョブの保持レベルを復元する（無ければLv1から）
    function switchJob(c, jobId) {
      if (c.isMonster || c.job === jobId) return;
      c.jobLevels[c.job] = Object.assign({}, c.jobLevels[c.job], { level: c.level, exp: c.exp, expToNext: c.expToNext });
      c.job = jobId;
      const saved = c.jobLevels[jobId] || { level: 1, exp: 0, expToNext: expForLevel(1) };
      c.jobLevels[jobId] = saved;
      c.level = saved.level; c.exp = saved.exp; c.expToNext = saved.expToNext;
      c.subAbilityIds = c.subAbilityIds.map((id) => {
        if (!id) return null;
        const sub = getAbilityById(id);
        return sub && JOBS[jobId].abilities.find((a) => a.id === sub.id) ? null : id;
      });
    }

    // 上級職は対応する基本職を規定レベルまで極めると解放される
    function jobUnlocked(c, jobId) {
      const job = JOBS[jobId];
      if (job.tier !== "advanced") return true;
      const req = job.requires;
      const lvl = (c.jobLevels[req.job] && c.jobLevels[req.job].level) || 0;
      return lvl >= req.level;
    }

    // テイムしたモンスターは人間のジョブではなく種族専用ジョブを使う
    function jobDef(c) {
      return c.isMonster ? MONSTER_JOBS[c.race] : JOBS[c.job];
    }

    // ---------- スキルツリー ----------
    // 1キャラは「固有ツリー(系統タグ単位、交換不可)」＋「汎用ツリー3枠(枠ごとに2択、交換可能)」の
    // 計4本を同時に持つ。内容は系統タグ／枠の候補で共有するが、進行(ノードのランク)はジョブごとに
    // 独立してjobLevels[jobId].skillTreeに保持する（転職しても内容は変わらないが進み具合は別管理）。
    function getExclusiveTree(c) {
      if (c.isMonster || !isFeatureEnabled("skillTree")) return null;
      const tag = jobTag(c.job);
      return tag ? getExclusiveTreeByTag(tag) : null;
    }
    // ジョブ別のツリー進行データを取得・初期化する。Stage1(固有ツリー1本のみ)の旧セーブは
    // { nodeRanks: {} } という平らな形だったため、そのまま固有ツリーの進行として引き継ぐ
    function getTreeState(c) {
      if (c.isMonster) return null;
      if (!c.jobLevels[c.job]) c.jobLevels[c.job] = { level: c.level, exp: c.exp, expToNext: c.expToNext };
      const rec = c.jobLevels[c.job];
      if (!rec.skillTree) rec.skillTree = {};
      const st = rec.skillTree;
      if (st.nodeRanks && !st.exclusiveRanks) {
        st.exclusiveRanks = st.nodeRanks;
        delete st.nodeRanks;
      }
      if (!st.exclusiveRanks) st.exclusiveRanks = {};
      if (!st.general) st.general = {};
      for (const slot of GENERAL_SLOTS) {
        if (!st.general[slot.key]) st.general[slot.key] = { treeId: slot.defaultTreeId, ranks: {} };
        if (!st.general[slot.key].treeId) st.general[slot.key].treeId = slot.defaultTreeId;
        if (!st.general[slot.key].ranks) st.general[slot.key].ranks = {};
      }
      return st;
    }
    function generalSlotTreeDef(c, slotKey) {
      const st = getTreeState(c);
      if (!st || !st.general[slotKey]) return null;
      return getGeneralTree(st.general[slotKey].treeId);
    }
    // SPは保存せず、そのジョブの現在レベルから都度算出する（獲得量と消費量の二重管理を避けるため）。
    // 固有ツリー＋汎用3枠の消費SPを合算した1つのプールを共有する
    function totalSp(c) { return Math.max(0, c.level - 1); }
    function spentSpFor(treeDef, ranks) {
      if (!treeDef) return 0;
      let spent = 0;
      for (const node of treeDef.nodes) {
        const rank = ranks[node.id] || 0;
        for (let r = 0; r < rank; r++) spent += node.costByRank[r];
      }
      return spent;
    }
    function totalSpentSp(c) {
      const st = getTreeState(c);
      if (!st) return 0;
      let spent = spentSpFor(getExclusiveTree(c), st.exclusiveRanks);
      for (const slot of GENERAL_SLOTS) {
        const slotState = st.general[slot.key];
        spent += spentSpFor(getGeneralTree(slotState.treeId), slotState.ranks);
      }
      return spent;
    }
    function availableSp(c) {
      if (!getExclusiveTree(c)) return 0;
      return totalSp(c) - totalSpentSp(c);
    }
    function canAcquireNode(c, treeDef, ranks, node) {
      if (c.team !== null && isTeamLocked(c.team)) return false;
      if (!treeDef) return false;
      const rank = ranks[node.id] || 0;
      if (rank >= node.maxRank) return false;
      if (availableSp(c) < node.costByRank[rank]) return false;
      for (const pre of node.prerequisites) {
        if ((ranks[pre.nodeId] || 0) < pre.minRank) return false;
      }
      if (node.exclusiveGroup) {
        for (const other of treeDef.nodes) {
          if (other.id !== node.id && other.exclusiveGroup === node.exclusiveGroup && (ranks[other.id] || 0) > 0) return false;
        }
      }
      return true;
    }
    function acquireNode(c, treeDef, ranks, node) {
      if (!canAcquireNode(c, treeDef, ranks, node)) return false;
      ranks[node.id] = (ranks[node.id] || 0) + 1;
      return true;
    }
    function canSwapGeneralSlot(c) {
      return c.team === null || !isTeamLocked(c.team);
    }
    // 汎用枠の交換候補2種を入れ替える。まだブック経済（ドロップ・鑑定・所持品消費）は実装していない
    // ための簡易版で、条件を満たせば無償・即時に切り替えられる。交換した枠のSP配分はリセットされる
    // （レベルアップで得たSPが別のノードへ再配分できなくなる事態を防ぐための既定仕様）
    function swapGeneralSlot(c, slotKey) {
      if (!canSwapGeneralSlot(c)) return false;
      const st = getTreeState(c);
      if (!st) return false;
      const slotDef = getGeneralSlotDef(slotKey);
      const slotState = st.general[slotKey];
      if (!slotDef || !slotState) return false;
      const nextId = slotDef.candidates.find((id) => id !== slotState.treeId) || slotDef.candidates[0];
      slotState.treeId = nextId;
      slotState.ranks = {};
      return true;
    }
    // 取得済みパッシブノードの効果を、固有＋汎用3枠ぶん合算する。加算系(能力値/会心率等)は0、
    // 乗算系(被ダメ/消費MP)は1を既定値にする
    function treePassiveTotals(c) {
      const totals = { atk: 0, def: 0, mag: 0, spd: 0, hp: 0, mp: 0, critBonus: 0, lifesteal: 0, healBonus: 0, dmgTakenMult: 1, mpCostMult: 1 };
      const st = getTreeState(c);
      if (!st) return totals;
      const applyTree = (treeDef, ranks) => {
        if (!treeDef) return;
        for (const node of treeDef.nodes) {
          if (node.kind !== "passive") continue;
          const rank = ranks[node.id] || 0;
          if (rank <= 0) continue;
          for (const eff of node.effects) {
            if (eff.type === "statAdd") totals[eff.stat] += eff.value * rank;
            else if (eff.type === "passiveAdd") totals[eff.key] += eff.value * rank;
            else if (eff.type === "passiveMult") totals[eff.key] *= eff.value;
          }
        }
      };
      applyTree(getExclusiveTree(c), st.exclusiveRanks);
      for (const slot of GENERAL_SLOTS) {
        const slotState = st.general[slot.key];
        applyTree(getGeneralTree(slotState.treeId), slotState.ranks);
      }
      return totals;
    }
    function treePassive(c, key) { return treePassiveTotals(c)[key]; }

    function computeStats(c) {
      const s = stats.baseStats(jobDef(c), RACES[c.race] || RACES.human, c.level);
      for (const slot of SLOTS) {
        const item = c.equip[slot.key];
        // HP・MPの装備は最大HP・最大MPに足す（能力値の hp/mp は maxHp/maxMp という名前で持っているため）
        if (item) s[item.stat === "hp" ? "maxHp" : item.stat === "mp" ? "maxMp" : item.stat] += itemEffectiveValue(item);
      }
      const tp = treePassiveTotals(c);
      s.maxHp += tp.hp; s.maxMp += tp.mp; s.atk += tp.atk; s.mag += tp.mag; s.def += tp.def; s.spd += tp.spd;
      // 石碑の加護はそのチームが挑戦中のダンジョンの間だけ乗る（HP/MPは除く）
      const buffs = c.team !== null ? runBuffs(c.team) : null;
      if (buffs) stats.applyBuffs(s, buffs);
      return s;
    }

    // ジョブの基礎値を重みにして、そのキャラにとっての装備の価値を測る
    function itemScore(c, item) {
      const base = jobDef(c).base;
      const weights = {
        hp: base.hp / 30, mp: base.mp / 20,
        atk: base.atk / 10, mag: base.mag / 10,
        def: base.def / 8, spd: base.spd / 7,
      };
      return itemEffectiveValue(item) * (weights[item.stat] || 0.5);
    }

    function racePassive(c, key) {
      const race = RACES[c.race] || RACES.human;
      return race.passive[key] || 0;
    }

    function availableAbilities(c) {
      const job = jobDef(c);
      const list = job.abilities.filter((a) => c.level >= a.reqLevel);
      if (!c.isMonster) {
        for (const id of c.subAbilityIds) {
          if (!id) continue;
          const sub = getAbilityById(id);
          if (sub && !list.find((a) => a.id === sub.id)) list.push(sub);
        }
        const tree = getExclusiveTree(c);
        if (tree) {
          const st = getTreeState(c);
          for (const node of tree.nodes) {
            if (node.kind !== "active" || !node.ability) continue;
            if ((st.exclusiveRanks[node.id] || 0) > 0 && !list.find((a) => a.id === node.ability.id)) list.push(node.ability);
          }
        }
      }
      return list;
    }

    function isSkillActive(c, abilityId) {
      return c.skillActive[abilityId] !== false; // default ON
    }

    // サブアビリティ候補: 実際にそのジョブでレベルを上げたことがある（jobLevelsに記録がある）技のみ
    function subAbilityCandidates(c) {
      const list = [];
      if (c.isMonster) return list; // モンスターは人間の技を覚えない
      for (const jobId in JOBS) {
        if (jobId === c.job) continue;
        const trained = c.jobLevels[jobId];
        if (!trained) continue;
        for (const a of JOBS[jobId].abilities) {
          if (trained.level >= a.reqLevel) list.push(a);
        }
      }
      return list;
    }

    function teamMembers(i) { return S.roster.filter((c) => c.team === i); }
    function activeParty() { return teamMembers(S.activeTeam); }
    function currentMaxLevel() { return S.roster.reduce((m, c) => Math.max(m, c.level), 1); }

    return {
      gainExp, totalExpInvested, newCharacter, switchJob, jobUnlocked, jobDef, getExclusiveTree, getTreeState, generalSlotTreeDef, totalSp, spentSpFor, totalSpentSp, availableSp, canAcquireNode, acquireNode, canSwapGeneralSlot, swapGeneralSlot, treePassiveTotals, treePassive, computeStats, itemScore, racePassive, availableAbilities, isSkillActive, subAbilityCandidates, teamMembers, activeParty, currentMaxLevel,
    };
  }

  const exported = { createRoster };
  root.QPModel = root.QPModel || {};
  root.QPModel.roster = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

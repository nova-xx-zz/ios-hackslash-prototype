(() => {
  "use strict";

  const AUTO_REPEAT_OPTIONS = [1, 3, 5, 10, 20, 50];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const MAX_ACTIVE = 5;
  const TEAM_COUNT = 4;

  // 端末への保存はすべてjs/core/storage.jsを通す（本番化でbackendを差し替えられるようにするため）。
  // 書き込みは容量超過などで失敗し得るが、例外を出さずにfalseを返すのでゲーム進行は止まらない。
  // 失敗したら画面上部に警告を出す（次にメインセーブが成功した時点で警告は消える）
  const KEYS = QPCore.storage.KEYS;
  const store = QPCore.storage.createStorage(QPCore.storage.defaultBackend(), { onWriteError: showSaveFailureBanner });
  // 保存対象のゲームの状態（ロスター・所持品・強化石・踏破済みダンジョン・自動周回など）は、
  // すべてこの1つのオブジェクトに持つ（js/model/save.js。セーブの書き出し・読み込みもそちら）
  const S = QPModel.save.createState({ teamCount: TEAM_COUNT });
  // 容量不足の間は書き込みのたびに失敗するため、警告帯が画面上部のボタンを覆い続けないよう
  // 8秒で自動的に隠し、タップで閉じた後は5分間は出し直さない
  const SAVE_BANNER_AUTO_HIDE_MS = 8000;
  const SAVE_BANNER_SNOOZE_MS = 5 * 60 * 1000;
  let saveBannerSnoozeUntil = 0;
  let saveBannerTimer = null;
  function showSaveFailureBanner() {
    if (Date.now() < saveBannerSnoozeUntil) return;
    let el = document.getElementById("saveErrorBanner");
    if (!el) {
      el = document.createElement("div");
      el.id = "saveErrorBanner";
      el.className = "save-error-banner";
      el.textContent = "端末への保存に失敗しました。保存容量が不足している可能性があります（自動分解の対象レア度を増やすと所持品を減らせます）。タップで閉じる";
      el.addEventListener("click", () => {
        el.classList.add("hidden");
        saveBannerSnoozeUntil = Date.now() + SAVE_BANNER_SNOOZE_MS;
      });
      document.body.appendChild(el);
    }
    el.classList.remove("hidden");
    clearTimeout(saveBannerTimer);
    saveBannerTimer = setTimeout(() => el.classList.add("hidden"), SAVE_BANNER_AUTO_HIDE_MS);
  }
  function hideSaveFailureBanner() {
    const el = document.getElementById("saveErrorBanner");
    if (el) el.classList.add("hidden");
    saveBannerSnoozeUntil = 0; // 保存できるようになったら、次に失敗した時はすぐ知らせる
  }

  function getBestStage() { return store.getInt(KEYS.bestCleared, 0); }
  function setBestStage(n) { if (n > getBestStage()) store.set(KEYS.bestCleared, n); }

  S.material = store.getInt(KEYS.material, 0);
  let autoDisassemble = store.getString(KEYS.autoDisassemble) === "1";

  // 自動分解の対象レア度（プレイヤーがフィルターで選択、端末に保存）
  let autoDisassembleRarities = new Set(DEFAULT_AUTO_DISASSEMBLE_RARITIES);
  {
    const saved = store.getJSON(KEYS.autoDisassembleFilter, null); // 壊れていたら既定値のまま
    if (Array.isArray(saved)) autoDisassembleRarities = new Set(saved);
  }
  function saveAutoDisassembleFilter() {
    store.setJSON(KEYS.autoDisassembleFilter, [...autoDisassembleRarities]);
  }

  // モンスター図鑑（遭遇したモンスターのキーを端末に保存）
  let dexSeen = new Set();
  {
    const savedDex = store.getJSON(KEYS.dexSeen, null); // 壊れていたら空のまま
    if (Array.isArray(savedDex)) dexSeen = new Set(savedDex);
  }
  function markDexSeen(key) {
    if (dexSeen.has(key)) return;
    dexSeen.add(key);
    store.setJSON(KEYS.dexSeen, [...dexSeen]);
  }

  // ---------- 冒険者ギルドからのお知らせ ----------
  // 既読は { [告知id]: 既読済みrevision } で保存し、announcement.revision以上なら既読とみなす
  // （本文を重要な改訂をした場合はrevisionを上げれば自動的に未読へ戻る）
  let readAnnouncements = {};
  {
    const savedRead = store.getJSON(KEYS.readAnnouncements, null); // 壊れていたら空のまま
    if (savedRead && typeof savedRead === "object") readAnnouncements = savedRead;
  }
  function saveReadAnnouncements() {
    store.setJSON(KEYS.readAnnouncements, readAnnouncements);
  }
  function isAnnouncementRead(a) { return (readAnnouncements[a.id] || 0) >= a.revision; }
  function markAnnouncementRead(a) {
    readAnnouncements[a.id] = a.revision;
    saveReadAnnouncements();
  }

  const ANNOUNCE_CATEGORY_LABELS = { notice: "📢お知らせ", update: "✨アップデート", balance: "🔧調整", preview: "🔮予告" };
  const ROADMAP_STATUS_LABELS = { released: "公開済み", development: "開発中", planned: "公開予定" };

  function formatAnnounceDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
    } catch (e) { return ""; }
  }

  // 公開期間内(visible/publishedAt/expiresAt)の告知だけを対象にする
  function visibleAnnouncements() {
    const now = Date.now();
    return ANNOUNCEMENTS.filter((a) => {
      if (!a.visible) return false;
      if (a.publishedAt && new Date(a.publishedAt).getTime() > now) return false;
      if (a.expiresAt && new Date(a.expiresAt).getTime() <= now) return false;
      return true;
    });
  }

  // 起動時に自動表示する告知を1件だけ選ぶ。強制再表示(important+forceDisplay)があればそれを優先し、
  // なければ未読のうち公開日時が新しいものを選ぶ（同日時はidで安定ソート）
  function pickStartupAnnouncement() {
    const candidates = visibleAnnouncements().filter((a) => a.showOnStartup);
    const forced = candidates.filter((a) => a.priority === "important" && a.forceDisplay);
    const pool = forced.length > 0 ? forced : candidates.filter((a) => !isAnnouncementRead(a));
    if (pool.length === 0) return null;
    return pool.slice().sort((a, b) => {
      const diff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      return diff !== 0 ? diff : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    })[0];
  }

  function updateAnnounceBadge() {
    const hasUnread = isFeatureEnabled("announcements") && visibleAnnouncements().some((a) => !isAnnouncementRead(a));
    document.getElementById("titleAnnounceBadge").classList.toggle("hidden", !hasUnread);
  }

  // 起動時のモーダル表示キュー（お知らせ→オフライン結果の順で、重ねずに1つずつ開く）
  let modalQueue = [];
  function enqueueModal(renderFn) { modalQueue.push(renderFn); }
  function processModalQueue() {
    if (modalQueue.length === 0) return;
    if (document.querySelector(".modal-overlay:not(.hidden)")) return;
    const next = modalQueue.shift();
    next();
  }

  function openAnnouncementModal(a) {
    document.getElementById("announceModalTitle").textContent = a.title;
    document.getElementById("announceModalMeta").textContent =
      `${formatAnnounceDate(a.publishedAt)}　${ANNOUNCE_CATEGORY_LABELS[a.category] || a.category}`;
    const bodyEl = document.getElementById("announceModalBody");
    bodyEl.innerHTML = "";
    for (const line of a.body) {
      const p = document.createElement("p");
      p.textContent = line; // 告知本文は必ずtextContentで描画する（innerHTMLへ直接挿入しない）
      bodyEl.appendChild(p);
    }
    // 詳細を実際に描画した時だけ既読にする（一覧を開いただけでは既読にしない）
    markAnnouncementRead(a);
    updateAnnounceBadge();
    document.getElementById("announcementModal").classList.remove("hidden");
  }
  document.getElementById("btnAnnounceModalClose").addEventListener("click", () => {
    document.getElementById("announcementModal").classList.add("hidden");
    processModalQueue();
  });

  let announceTab = "notice"; // "notice" | "roadmap"
  let announceReturnScreen = "screen-title";

  function openAnnouncementsScreen(returnScreen) {
    announceReturnScreen = returnScreen;
    announceTab = "notice";
    renderAnnouncementsScreen();
    showScreen("screen-announcements");
  }

  function renderAnnouncementsScreen() {
    const tabs = document.getElementById("announceTabs");
    tabs.innerHTML = "";
    const tabDefs = [{ key: "notice", label: "お知らせ" }, { key: "roadmap", label: "今後の予定" }];
    for (const t of tabDefs) {
      const btn = document.createElement("button");
      btn.className = "detail-tab" + (announceTab === t.key ? " active" : "");
      btn.textContent = t.label;
      btn.addEventListener("click", () => { announceTab = t.key; renderAnnouncementsScreen(); });
      tabs.appendChild(btn);
    }

    const body = document.getElementById("announceBody");
    body.innerHTML = "";
    if (announceTab === "notice") {
      const list = visibleAnnouncements().slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      if (list.length === 0) {
        const none = document.createElement("div");
        none.className = "sub-ability-row";
        none.textContent = "お知らせはまだありません";
        body.appendChild(none);
      }
      for (const a of list) {
        const row = document.createElement("button");
        row.className = "announce-row" + (isAnnouncementRead(a) ? "" : " unread");
        const meta = document.createElement("div");
        meta.className = "announce-row-meta";
        meta.textContent = `${formatAnnounceDate(a.publishedAt)}　${ANNOUNCE_CATEGORY_LABELS[a.category] || a.category}`;
        row.appendChild(meta);
        const title = document.createElement("div");
        title.className = "announce-row-title";
        title.textContent = a.title;
        row.appendChild(title);
        row.addEventListener("click", () => openAnnouncementModal(a));
        body.appendChild(row);
      }
    } else {
      for (const r of ROADMAP) {
        const row = document.createElement("div");
        row.className = "roadmap-row";
        const status = document.createElement("span");
        status.className = "roadmap-status " + r.status;
        status.textContent = ROADMAP_STATUS_LABELS[r.status] || r.status;
        row.appendChild(status);
        const title = document.createElement("div");
        title.className = "roadmap-title";
        title.textContent = r.title;
        row.appendChild(title);
        const summary = document.createElement("div");
        summary.className = "roadmap-summary";
        summary.textContent = r.summary;
        row.appendChild(summary);
        const timing = document.createElement("div");
        timing.className = "roadmap-timing";
        timing.textContent = r.timingLabel;
        row.appendChild(timing);
        body.appendChild(row);
      }
    }
  }

  document.getElementById("btnTitleAnnounce").addEventListener("click", () => openAnnouncementsScreen("screen-title"));
  document.getElementById("btnSettingsAnnounce").addEventListener("click", () => openAnnouncementsScreen("screen-settings"));
  document.getElementById("btnAnnounceBack").addEventListener("click", () => {
    if (announceReturnScreen === "screen-settings") showScreen("screen-settings");
    else { renderTitle(); showScreen("screen-title"); }
  });

  // ---------- セーブ/ロード ----------
  // ゲームの状態(S)を端末に保存する。セーブデータの形と旧形式からの移行は js/model/save.js。
  // 旧jobquest_materialキーは互換ミラーとして更新するのみ（正本はメインセーブのmaterial）
  let lastSavedAt = null; // 端末に保存できた最新セーブのsavedAt（バックグラウンド復帰時の精算に使う）
  function saveGame() {
    let json;
    const now = Date.now();
    try {
      const data = QPModel.save.serialize(S, {
        now,
        runDungeonIds: teamRuns.map((r) => (r && r.dungeon) ? r.dungeon.id : null),
        enabledFeatures: Object.keys(FEATURE_FLAGS).filter((k) => FEATURE_FLAGS[k]),
      });
      json = JSON.stringify(data);
    } catch (e) { return false; }
    // 容量超過などで失敗した場合はstoreが警告を出す。成功したら以前の警告は消す
    if (!store.set(KEYS.save, json)) return false;
    lastSavedAt = now;
    store.set(KEYS.material, S.material); // 旧キーは互換ミラー
    hideSaveFailureBanner();
    return true;
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveGame, 400);
  }

  // 起動時に保存データがあれば復元する。無ければ既定のスターターロスターのまま。
  // 自動周回が稼働中のまま離れていたチームがあれば、離れていた時間分の周回をまとめて計算する
  // （チームごとに独立して計算するため、複数チームが同時にオフライン進行することもある）
  let pendingOfflineSummaries = null;
  let offlineSettleFailed = false;
  // 精算前に「このsavedAtは精算済み」と記録する。記録できない（容量不足など）なら精算しない
  function claimOfflineSettlement(savedAt) {
    return store.set(KEYS.offlineSettled, savedAt);
  }
  function loadGame() {
    try {
      const raw = store.getString(KEYS.save);
      if (!raw) return false;
      const loaded = QPModel.save.deserialize(JSON.parse(raw), {
        legacyMaterial: store.getInt(KEYS.material, 0),
        syncExpToNext,
      });
      if (!loaded) return false;
      Object.assign(S, loaded.state);
      store.set(KEYS.material, S.material);
      // 保存時に戦闘中だった場合に備え、HP/MP/行動ゲージは全員リセットしておく
      for (const c of S.roster) {
        const s = computeStats(c);
        c.hp = s.maxHp; c.mp = s.maxMp;
        c.alive = true; c.atb = 0; c.defending = false; c.actedFlash = 0;
      }
      const savedAutoRepeat = loaded.savedAutoRepeat;
      const savedAt = loaded.savedAt;
      lastSavedAt = typeof savedAt === "number" ? savedAt : null;
      if (savedAutoRepeat.some((ar) => ar && ar.active)) {
        if (store.getString(KEYS.offlineSettled) === String(savedAt)) {
          // このセーブの離脱期間は精算済み（精算後の保存に失敗していた）。二重付与を避けて自動周回を止めたまま再開する
        } else if (claimOfflineSettlement(savedAt)) {
          pendingOfflineSummaries = runOfflineProgress(savedAutoRepeat, savedAt);
        } else {
          offlineSettleFailed = true; // 保存できない状態で付与すると失われる/二重になるため、精算を見送る
        }
      }
      // 旧形式からの移行はその場で保存し直し、schemaVersion付きの内容が次回起動を待たず反映されるようにする
      if (pendingOfflineSummaries || loaded.isLegacy) saveGame();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- Roster ----------
  // 必要EXPの曲線(expForLevel)とセーブ読み込み時の再計算(syncExpToNext)は data.js で定義

  // キャラまわりのルール（作成・EXP・転職・スキルツリー・能力値など）は js/model/roster.js
  const Roster = QPModel.roster.createRoster({
    data: {
      JOBS, MONSTER_JOBS, RACES, SLOTS, GENERAL_SLOTS, expForLevel, isFeatureEnabled, jobTag,
      getExclusiveTreeByTag, getGeneralTree, getGeneralSlotDef, getAbilityById, itemEffectiveValue,
    },
    state: S,
    runBuffs: (team) => Runner.runBuffs(team), // 石碑の加護（js/model/run.js）
    isTeamLocked: (team) => isTeamLocked(team),
  });
  const {
    gainExp, totalExpInvested, newCharacter, switchJob, jobUnlocked, jobDef, getExclusiveTree, getTreeState, generalSlotTreeDef, totalSp, spentSpFor, totalSpentSp, availableSp, canAcquireNode, acquireNode, canSwapGeneralSlot, swapGeneralSlot, treePassiveTotals, treePassive, computeStats, itemScore, racePassive, availableAbilities, isSkillActive, subAbilityCandidates, teamMembers, activeParty, currentMaxLevel,
  } = Roster;

  const TEAM_NAMES = ["第一のパーティ", "第二のパーティ", "第三のパーティ", "第四のパーティ"];
  const TEAM_LABELS = ["I", "II", "III", "IV"];


  // ---------- Inventory ----------
  // 所持品まわりのルール（装備・強化石・装備強化・ドロップの受け取り・モンスター合成）は js/model/inventory.js
  const Inventory = QPModel.inventory.createInventory({
    data: { SLOTS, ENHANCE_RULES, ENHANCE_MAX_PLUS },
    state: S,
    roster: Roster,
    rng: RNG,
    isFeatureEnabled,
    onMaterialChange: (material) => store.set(KEYS.material, material), // 旧キーは互換ミラー
  });
  const {
    clampVitals, equipItem, unequipSlot, autoEquip, guaranteedStoneTotal, isPityReady,
  } = Inventory;

  // ---------- ダンジョン1周の進行 ----------
  // チームごとの探索の状態(teamRuns / teamBattles)と、出発・戦闘・勝利・道中イベント・周回の終了・オフライン精算は
  // js/model/run.js。ここではログの文章・画面の更新・次の処理までの待ち時間を受け持つ。
  // computeStats が石碑の加護(teamRuns[].buffs)を参照するため、roster を組み立てる前に用意しておく
  const Runner = QPModel.run.createRunner({
    data: { DUNGEONS, RACES, REWARD_RULES, getDungeon, buildEncounter, getEnemyTemplate, rollItemDrop },
    state: S,
    roster: Roster,
    inventory: Inventory,
    rng: RNG,
    teamCount: TEAM_COUNT,
    battleEnv: () => battleEnv(),
    autoDisassemble: () => ({ enabled: autoDisassemble, rarities: autoDisassembleRarities }),
    markDexSeen,
    setBestStage,
  });
  const { teamRuns, teamBattles, isTeamRunActive, isTeamLocked, runOfflineProgress } = Runner;
  // 4チームがそれぞれ独立にダンジョンへ出撃できるよう、進行状態(run)・戦闘状態(battle)・
  // 自動周回状態はすべてチームごとの配列で管理し、全チームが常に並行して進行する
  let selectedDungeonId = null;
  let jobsReturnScreen = "screen-battle"; // タイトルは常設ナビを持たないスプラッシュのため、既定の戻り先は探索画面にする
  let speedMult = 1;

  // 自動周回（チームごとに独立して設定・進行する）
  const defaultAutoRepeatTarget = clampAutoRepeatTarget(store.getInt(KEYS.autoRepeatTarget, 5));
  for (const ar of S.autoRepeat) ar.target = defaultAutoRepeatTarget;
  function clampAutoRepeatTarget(n) { return AUTO_REPEAT_OPTIONS.includes(n) ? n : 5; }

  // ---------- 自動周回のオフライン進行 ----------
  // 離れていた間の周回の計算と反映は js/model/run.js（runOfflineProgress）。ここは結果の表示
  function showOfflineModal(summaries) {
    const blocks = summaries.map((summary) => {
      if (summary.tooShort) {
        return `【${TEAM_LABELS[summary.team]}】「${summary.dungeonName}」: 離れていた時間が1周ぶんに満たなかったため、オフライン中の周回はありませんでした`;
      }
      const lines = [`【${TEAM_LABELS[summary.team]}】「${summary.dungeonName}」を ${summary.cleared}周 クリアしました`];
      if (summary.cleared > 0 || summary.expGained > 0) {
        lines.push(`獲得EXP: +${summary.expGained}　獲得アイテム: ${summary.itemsGained}個`);
      }
      if (summary.tamedNames.length) lines.push(`テイム: ${summary.tamedNames.join("・")}`);
      if (summary.wipedOut) lines.push("パーティが全滅したため、途中で自動周回が停止しました");
      return lines.join("<br>");
    });
    blocks.push("自動周回は停止中です。続けるには各チームで「自動周回開始」を押してください");
    document.getElementById("offlineDesc").innerHTML = blocks.join("<br><br>");
    document.getElementById("offlineModal").classList.remove("hidden");
  }
  function showOfflineSettleFailedModal() {
    document.getElementById("offlineDesc").innerHTML =
      "端末の保存容量が不足しているため、離れていた間の自動周回を精算できませんでした。<br><br>" +
      "保存できるようになると、次回起動時に精算されます（自動分解の対象レア度を増やすと所持品を減らせます）。自動周回は停止中です";
    document.getElementById("offlineModal").classList.remove("hidden");
  }
  document.getElementById("btnOfflineClose").addEventListener("click", () => {
    document.getElementById("offlineModal").classList.add("hidden");
    processModalQueue();
  });

  S.roster = [
    newCharacter("アレン", "warrior", "human", { team: 0 }),
    newCharacter("ガイ", "warrior", "beastkin", { team: 0 }),
    newCharacter("ミナ", "mage", "sylvan", { team: 0 }),
    newCharacter("ノア", "mage", "nocturne", { team: 0 }),
    newCharacter("ルカ", "priest", "stonekin", { team: 0 }),
  ];

  function isDungeonOpen(d) {
    if (S.clearedDungeons.has(d.id)) return true;
    if (d.id === DUNGEONS[0].id) return true;
    return DUNGEONS.some((src) => S.clearedDungeons.has(src.id) && src.unlocks.includes(d.id));
  }

  // ---------- Screen management ----------
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
    document.getElementById(id).classList.remove("hidden");
  }

  // ---------- Title screen ----------
  // タイトル画面は「はじめる」ボタンのみのシンプルな入口とし、常設ナビ（編成／探索／図鑑／設定）は
  // 実質的なホーム画面である探索画面（screen-battle）側に置く（hub-nav-row、btnHub*のリスナーを参照）
  function renderTitle() {
    const best = getBestStage();
    const bits = [];
    if (best > 0) bits.push(`クリア済みダンジョン: ${best}`);
    bits.push(`所持なかま: ${S.roster.length}人`);
    bits.push(`強化石: ${S.material}`);
    document.getElementById("bestClearText").textContent = bits.join("　/　");
    document.getElementById("btnTitleAnnounce").classList.toggle("hidden", !isFeatureEnabled("announcements"));
    updateAnnounceBadge();
  }

  document.getElementById("btnGoBattle").addEventListener("click", () => {
    openExploreHub();
  });
  document.getElementById("btnHubJobs").addEventListener("click", () => {
    jobsReturnScreen = "screen-battle";
    renderJobsScreen();
    showScreen("screen-jobs");
  });
  document.getElementById("btnHubExplore").addEventListener("click", () => {
    openExploreHub();
  });
  document.getElementById("btnHubDex").addEventListener("click", () => {
    renderDexScreen();
    showScreen("screen-dex");
  });
  document.getElementById("btnHubSettings").addEventListener("click", () => {
    showScreen("screen-settings");
  });
  document.getElementById("btnSettingsBack").addEventListener("click", () => {
    openExploreHub();
  });
  document.getElementById("btnDexBack").addEventListener("click", () => {
    openExploreHub();
  });

  function renderDexScreen() {
    document.getElementById("dexCount").textContent =
      `発見済み ${dexSeen.size} / ${ENEMY_TEMPLATES.length} 体`;
    const body = document.getElementById("dexBody");
    body.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "dex-card-grid";
    for (const t of ENEMY_TEMPLATES) {
      const seen = dexSeen.has(t.key);
      const card = document.createElement("button");
      card.className = "dex-card" + (seen ? "" : " locked");
      card.innerHTML = seen
        ? `<div class="dex-card-icon">${t.icon || "❓"}</div>
           <div class="dex-card-name">${t.name}</div>
           <div class="dex-card-element">${t.element}</div>`
        : `<div class="dex-card-icon">❓</div>
           <div class="dex-card-name">？？？</div>
           <div class="dex-card-element">&nbsp;</div>`;
      if (seen) card.addEventListener("click", () => openDexDetail(t.key));
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  function openDexDetail(key) {
    const t = getEnemyTemplate(key);
    document.getElementById("dexIcon").textContent = t.icon || "❓";
    document.getElementById("dexName").textContent = t.name;
    document.getElementById("dexElement").textContent =
      `属性: ${t.element}　${t.tamable ? "テイム可能" : "テイム不可"}`;
    document.getElementById("dexDesc").textContent = t.desc || "";
    const statsBox = document.getElementById("dexStats");
    const rows = [
      ["HP", t.hp], ["ATK", t.atk], ["DEF", t.def], ["SPD", t.spd], ["EXP", t.exp],
    ];
    statsBox.innerHTML = rows.map(([label, value]) => `
      <div class="pm-stat-row">
        <span class="pm-stat-label">${label}</span>
        <span class="dex-stat-value">${value}</span>
      </div>`).join("");
    document.getElementById("dexModal").classList.remove("hidden");
  }
  function closeDexModal() {
    document.getElementById("dexModal").classList.add("hidden");
  }
  document.getElementById("btnDexModalClose").addEventListener("click", closeDexModal);
  document.getElementById("dexModal").addEventListener("click", (e) => {
    if (e.target.id === "dexModal") closeDexModal();
  });

  function openExploreHub() {
    buildPartyDock();
    renderDock();
    showScreen("screen-battle");
  }

  // ---------- Map screen ----------
  function openMap() {
    renderMap();
    showScreen("screen-map");
  }

  function renderMap() {
    const nodes = document.getElementById("mapNodes");
    const svg = document.getElementById("mapLines");
    nodes.innerHTML = "";
    svg.innerHTML = "";

    for (const d of DUNGEONS) {
      for (const nextId of d.unlocks) {
        const next = getDungeon(nextId);
        if (!next) continue;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", d.x);
        line.setAttribute("y1", d.y);
        line.setAttribute("x2", next.x);
        line.setAttribute("y2", next.y);
        if (S.clearedDungeons.has(d.id)) line.classList.add("open");
        svg.appendChild(line);
      }
    }

    for (const d of DUNGEONS) {
      const cleared = S.clearedDungeons.has(d.id);
      const open = isDungeonOpen(d);
      const btn = document.createElement("button");
      btn.className = "map-node " + (cleared ? "cleared" : open ? "open" : "locked") +
        (selectedDungeonId === d.id ? " selected" : "");
      btn.style.left = d.x + "%";
      btn.style.top = d.y + "%";
      btn.innerHTML = `<div class="dot">${cleared ? "✓" : open ? "▶" : "—"}</div>
        <div class="label">${d.name}</div>`;
      if (open) btn.addEventListener("click", () => selectDungeon(d));
      nodes.appendChild(btn);
    }
  }

  function selectDungeon(d) {
    selectedDungeonId = d.id;
    renderMap();
    renderDungeonInfo(d);
  }

  function renderDungeonInfo(d) {
    const el = document.getElementById("dungeonInfo");
    const party = activeParty();
    el.innerHTML = `
      <div class="dname">${d.name}${S.clearedDungeons.has(d.id) ? "　クリア済み" : ""}</div>
      <div class="dmeta">
        ${d.desc}<br>
        戦闘数: ${d.battles}回（最後はボス戦）
      </div>`;
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.id = "btnEnterDungeon";
    if (party.length === 0) {
      btn.textContent = `${TEAM_NAMES[S.activeTeam]}が空です（編成してください）`;
      btn.disabled = true;
    } else {
      btn.textContent = `${TEAM_NAMES[S.activeTeam]}で出発する`;
      btn.addEventListener("click", () => startDungeon(S.activeTeam, d.id, { navigate: true }));
    }
    el.appendChild(btn);
  }

  document.getElementById("btnMapBack").addEventListener("click", () => {
    openExploreHub();
  });

  // ---------- パーティ一覧（編成画面） ----------
  const expandedTeams = new Set([0]);
  let benchExpanded = true;
  let detailCharId = null;
  let detailTab = "stats";
  let fusionSelection = new Set(); // モンスター合成: 選択中の素材モンスターのid
  let fusionMessage = "";
  let fusionConfirm = false; // 合成ボタンを1回押して確認待ちか（素材の消滅は取り消せないため2回押しで確定）
  let treeSelectedNode = null; // ツリータブ: 選択中ノード { scope: "exclusive"|スロットkey, nodeId }
  let treeSwapConfirm = null; // ツリータブ: 交換ボタンを1回押して確認待ちの枠key

  function renderJobsScreen() {
    scheduleSave();
    const wrap = document.getElementById("rosterBody");
    wrap.innerHTML = "";

    wrap.appendChild(sectionLabel("パーティ"));
    for (let i = 0; i < TEAM_LABELS.length; i++) {
      const members = teamMembers(i);
      wrap.appendChild(buildPartyRow({
        key: "t" + i,
        name: `${TEAM_NAMES[i]}（${TEAM_LABELS[i]}）`,
        meta: `${members.length}/${MAX_ACTIVE}人`,
        viewed: i === S.activeTeam,
        exploring: isTeamRunActive(i),
        locked: isTeamLocked(i),
        expanded: expandedTeams.has(i),
        onToggle: () => {
          if (expandedTeams.has(i)) expandedTeams.delete(i); else expandedTeams.add(i);
          renderJobsScreen();
        },
        onView: () => {
          S.activeTeam = i;
          scheduleSave();
          renderJobsScreen();
        },
        members,
        dropKey: String(i),
        emptyTile: null,
      }));
    }

    wrap.appendChild(sectionLabel("未編成"));
    const bench = S.roster.filter((c) => c.team === null);
    wrap.appendChild(buildPartyRow({
      key: "bench",
      name: "控え",
      meta: `${bench.length}人`,
      expanded: benchExpanded,
      onToggle: () => { benchExpanded = !benchExpanded; renderJobsScreen(); },
      members: bench,
      dropKey: "bench",
      emptyTile: () => openCreateScreen(),
    }));

    document.getElementById("rosterCount").textContent = rosterMessage ||
      `所持なかま ${S.roster.length}人　/　所持品 ${S.inventory.length}個　（カードを長押しでドラッグ移動）`;
  }

  let rosterMessage = "";
  let rosterMessageTimer = null;
  function flashRosterMessage(text) {
    rosterMessage = text;
    clearTimeout(rosterMessageTimer);
    rosterMessageTimer = setTimeout(() => { rosterMessage = ""; renderJobsScreen(); }, 1800);
  }

  function sectionLabel(text) {
    const el = document.createElement("div");
    el.className = "roster-section";
    el.textContent = text;
    return el;
  }

  function buildPartyRow(opts) {
    const frag = document.createDocumentFragment();

    const head = document.createElement("button");
    head.className = "party-row-head";
    head.dataset.drop = opts.dropKey;
    head.innerHTML = `<span class="chev">${opts.expanded ? "∨" : "＞"}</span>
      <span class="pname">${opts.name}</span>`;
    if (opts.viewed) {
      const tag = document.createElement("span");
      tag.className = "deployed";
      tag.textContent = "表示中";
      head.appendChild(tag);
    }
    if (opts.exploring) {
      const tag = document.createElement("span");
      tag.className = "exploring-badge";
      tag.textContent = "探索中";
      head.appendChild(tag);
    }
    const meta = document.createElement("span");
    meta.className = "pmeta";
    meta.textContent = opts.meta;
    head.appendChild(meta);
    head.addEventListener("click", opts.onToggle);
    frag.appendChild(head);

    if (!opts.expanded) return frag;

    const strip = document.createElement("div");
    strip.className = "member-strip" + (opts.locked ? " locked" : "");
    strip.dataset.drop = opts.dropKey;
    for (const c of opts.members) strip.appendChild(buildMemberCard(c));
    if (opts.emptyTile) {
      const add = document.createElement("button");
      add.className = "member-card empty";
      add.textContent = "＋";
      add.title = "仲間を探す";
      add.addEventListener("click", opts.emptyTile);
      strip.appendChild(add);
    }
    if (opts.members.length === 0 && !opts.emptyTile) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.style.padding = "2px 4px 8px";
      none.textContent = "（このパーティは空です）";
      frag.appendChild(none);
    }
    frag.appendChild(strip);

    if (opts.onView && !opts.viewed && opts.members.length > 0) {
      const btn = document.createElement("button");
      btn.className = "equip-choice";
      btn.style.margin = "0 2px 10px";
      btn.textContent = "このパーティを表示する";
      btn.addEventListener("click", opts.onView);
      frag.appendChild(btn);
    }
    return frag;
  }

  function buildMemberCard(c) {
    const stats = computeStats(c);
    const btn = document.createElement("button");
    btn.className = "member-card" + (c.isMonster ? " monster" : "");
    btn.innerHTML = `
      <div class="mtitle">${RACES[c.race].name}・${jobDef(c).name}</div>
      <div class="mname">${c.name}</div>
      <div class="mstats"><span>Lv.${c.level}</span><span>HP${stats.maxHp}</span></div>`;
    attachMemberDrag(btn, c);
    return btn;
  }

  // ---------- メンバーカードのドラッグ移動 ----------
  // iOS Safari では HTML5 drag&drop が使えないので Pointer Events で実装する。
  // 長押しでドラッグ開始、それ以前の指の移動は横スクロールとして扱う。
  const DRAG_HOLD_MS = 260;
  const DRAG_SLOP = 10;
  let dragState = null;

  function attachMemberDrag(card, c) {
    card.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const start = { x: e.clientX, y: e.clientY };
      let dragging = false;
      let canceled = false;

      const holdTimer = setTimeout(() => {
        if (canceled) return;
        // 探索中のチームに所属するキャラは、途中で編成が変わらないようドラッグ移動できない
        if (c.team !== null && isTeamLocked(c.team)) {
          canceled = true;
          flashRosterMessage(`${TEAM_NAMES[c.team]}は探索中のため編成を変更できません`);
          return;
        }
        dragging = true;
        startMemberDrag(c, card, start);
      }, DRAG_HOLD_MS);

      const onMove = (ev) => {
        if (dragging) {
          ev.preventDefault();
          moveMemberDrag(ev);
          return;
        }
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > DRAG_SLOP) {
          canceled = true;
          clearTimeout(holdTimer);
          detach();
        }
      };
      const onUp = (ev) => {
        clearTimeout(holdTimer);
        detach();
        if (dragging) dropMemberDrag(ev);
        else if (!canceled) openCharDetail(c);
      };
      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    // キーボード操作など、ポインタを伴わない click のためのフォールバック
    card.addEventListener("click", (e) => {
      if (e.detail === 0) openCharDetail(c);
    });
  }

  function startMemberDrag(c, card, pos) {
    const ghost = card.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = card.offsetWidth + "px";
    ghost.style.left = pos.x + "px";
    ghost.style.top = pos.y + "px";
    document.body.appendChild(ghost);
    card.classList.add("dragging");
    document.body.classList.add("dragging-member");
    dragState = { char: c, card, ghost, zone: null };
  }

  function moveMemberDrag(ev) {
    if (!dragState) return;
    dragState.ghost.style.left = ev.clientX + "px";
    dragState.ghost.style.top = ev.clientY + "px";
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const zone = el ? el.closest("[data-drop]") : null;
    if (zone === dragState.zone) return;
    if (dragState.zone) dragState.zone.classList.remove("drop-target", "full");
    if (zone) {
      zone.classList.add("drop-target");
      if (!canDropOn(zone.dataset.drop, dragState.char)) zone.classList.add("full");
    }
    dragState.zone = zone;
  }

  function canDropOn(key, c) {
    if (key === "bench") return true;
    const i = parseInt(key, 10);
    if (isTeamLocked(i)) return false;
    if (c.team === i) return true;
    return teamMembers(i).length < MAX_ACTIVE;
  }

  function dropMemberDrag() {
    if (!dragState) return;
    const { char, card, ghost, zone } = dragState;
    ghost.remove();
    card.classList.remove("dragging");
    document.body.classList.remove("dragging-member");
    if (zone) zone.classList.remove("drop-target", "full");
    dragState = null;

    if (zone) {
      const key = zone.dataset.drop;
      if (key === "bench") {
        char.team = null;
        benchExpanded = true;
      } else {
        const i = parseInt(key, 10);
        if (char.team !== i) {
          if (isTeamLocked(i)) {
            flashRosterMessage(`${TEAM_NAMES[i]}は探索中のため編成できません`);
            renderJobsScreen();
            return;
          }
          if (!canDropOn(key, char)) {
            flashRosterMessage(`${TEAM_NAMES[i]}は満員です（最大${MAX_ACTIVE}人）`);
            renderJobsScreen();
            return;
          }
          char.team = i;
          clampVitals(char);
          expandedTeams.add(i);
        }
      }
    }
    renderJobsScreen();
  }

  // ---------- キャラ作成（自由ビルド） ----------
  let draft = null;

  function openCreateScreen() {
    const r = rollNewRecruit();
    draft = { name: r.name, race: r.race, job: r.job };
    renderCreateScreen();
    showScreen("screen-create");
  }

  function renderCreateScreen() {
    const wrap = document.getElementById("createBody");
    wrap.innerHTML = "";

    // 名前
    const nameField = document.createElement("div");
    nameField.className = "create-row create-row-name";
    nameField.innerHTML = `<div class="cr-label">なまえ</div>`;
    const nameRow = document.createElement("div");
    nameRow.className = "name-row";
    const input = document.createElement("input");
    input.className = "name-input";
    input.id = "createName";
    input.type = "text";
    input.maxLength = 8;
    input.value = draft.name;
    input.addEventListener("input", () => {
      draft.name = input.value;
      updateCreatePreview();
    });
    nameRow.appendChild(input);
    const dice = document.createElement("button");
    dice.className = "pick-chip";
    dice.textContent = "別の名前";
    dice.addEventListener("click", () => {
      draft.name = rollNewRecruit().name;
      renderCreateScreen();
    });
    nameRow.appendChild(dice);
    nameField.appendChild(nameRow);
    wrap.appendChild(nameField);

    // 種族
    wrap.appendChild(buildCreatePickRow("しゅぞく", RACES[draft.race].name, RACES[draft.race].desc, () => openCreatePick("race")));

    // ジョブ
    const jobSub = JOBS[draft.job].abilities.map((a) => `${a.name}(Lv.${a.reqLevel})`).join(" / ");
    wrap.appendChild(buildCreatePickRow("ジョブ", JOBS[draft.job].name, jobSub, () => openCreatePick("job")));

    // プレビュー
    const previewLabel = document.createElement("div");
    previewLabel.className = "create-section-label";
    previewLabel.textContent = "プレビュー";
    wrap.appendChild(previewLabel);
    const box = document.createElement("div");
    box.className = "preview-box";
    box.id = "createPreview";
    wrap.appendChild(box);
    updateCreatePreview();
  }

  function buildCreatePickRow(label, value, sub, onClick) {
    const row = document.createElement("button");
    row.className = "create-row";
    row.innerHTML = `
      <div class="cr-main">
        <div class="cr-label">${label}</div>
        <div class="cr-value">${value}</div>
        <div class="cr-sub">${sub}</div>
      </div>
      <div class="cr-chev">›</div>`;
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
    const peers = Object.values(JOBS).filter((j) => j.tier === job.tier);
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

    document.getElementById("pmIcon").textContent = def.icon || "❓";
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
      chip.textContent = odef.icon || "❓";
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
    box.innerHTML = `
      <div class="pv-name">${draft.name || "ななし"} — ${race.name}・${JOBS[draft.job].name} Lv.${preview.level}</div>
      <div class="pv-stats">HP ${s.maxHp}　MP ${s.maxMp}　ATK ${s.atk}　MAG ${s.mag}　DEF ${s.def}　SPD ${Math.round(s.spd * 10) / 10}</div>
      <div class="pv-note">${passives.length ? "種族特性: " + passives.join(" / ") : "種族特性: なし"}</div>
      <div class="pv-note">習得済み: ${availableAbilities(preview).map((a) => a.name).join("、") || "なし"}</div>`;
  }

  const PASSIVE_LABELS = {
    critBonus: (v) => `会心率 +${Math.round(v * 100)}%`,
    dmgTakenMult: (v) => `被ダメージ ${Math.round((v - 1) * 100)}%`,
    lifesteal: (v) => `与ダメージの ${Math.round(v * 100)}% を吸収`,
    mpCostMult: (v) => `消費MP ${Math.round((v - 1) * 100)}%`,
    healBonus: (v) => `回復量 +${Math.round(v * 100)}%`,
  };

  function confirmCreate() {
    const name = (draft.name || "").trim() || "ななし";
    const c = newCharacter(name, draft.job, draft.race, { level: createStartLevel() });
    S.roster.push(c);
    benchExpanded = true;
    renderJobsScreen();
    showScreen("screen-jobs");
    return c;
  }

  document.getElementById("btnCreateBack").addEventListener("click", () => {
    renderJobsScreen();
    showScreen("screen-jobs");
  });
  document.getElementById("btnCreateRandom").addEventListener("click", () => {
    const r = rollNewRecruit();
    draft = { name: r.name, race: r.race, job: r.job };
    renderCreateScreen();
  });
  document.getElementById("btnCreateConfirm").addEventListener("click", () => { confirmCreate(); });

  // ---------- キャラ詳細 ----------
  function openCharDetail(c) {
    detailCharId = c.id;
    detailTab = "stats";
    fusionSelection = new Set();
    fusionConfirm = false;
    fusionMessage = "";
    treeSelectedNode = null;
    treeSwapConfirm = null;
    renderCharDetail();
    showScreen("screen-chardetail");
  }

  const DETAIL_TABS = [
    { key: "stats", label: "能力値" },
    { key: "equip", label: "装備" },
    { key: "skill", label: "スキル" },
    { key: "tree", label: "ツリー" },
    { key: "job", label: "ジョブ" },
  ];

  function renderCharDetail() {
    scheduleSave();
    const c = S.roster.find((x) => x.id === detailCharId);
    if (!c) { showScreen("screen-jobs"); return; }
    document.getElementById("detailName").textContent =
      `${c.name}${c.isMonster ? "（テイム）" : ""}`;

    renderDetailTabs();

    const wrap = document.getElementById("detailBody");
    wrap.innerHTML = "";

    // 探索中のチームに所属するキャラは、装備・スキル・転職・合成などを変更すると
    // 戦闘中の状態が不整合になるため、表示のみ（操作不可）にする
    const locked = c.team !== null && isTeamLocked(c.team);
    if (locked) {
      const notice = document.createElement("div");
      notice.className = "sub-ability-row locked-notice";
      notice.textContent = `${TEAM_NAMES[c.team]}は探索中のため、この画面では変更できません（表示のみ）`;
      wrap.appendChild(notice);
    }

    if (detailTab === "tree" && !getExclusiveTree(c)) detailTab = "stats"; // モンスター等、ツリーの無いキャラでは表示しない
    const card = document.createElement("div");
    card.className = "job-char-card" + (locked ? " readonly" : "");
    if (detailTab === "equip") card.appendChild(buildEquipSection(c));
    else if (detailTab === "skill") card.appendChild(buildSkillTab(c));
    else if (detailTab === "tree") card.appendChild(buildTreeTab(c));
    else if (detailTab === "job") card.appendChild(buildJobTab(c));
    else card.appendChild(buildStatsTab(c));
    wrap.appendChild(card);
  }

  function renderDetailTabs() {
    const c = S.roster.find((x) => x.id === detailCharId);
    const tabs = document.getElementById("detailTabs");
    tabs.innerHTML = "";
    for (const t of DETAIL_TABS) {
      if (t.key === "tree" && !getExclusiveTree(c)) continue; // モンスターやツリー未対応ジョブでは非表示
      const btn = document.createElement("button");
      btn.className = "detail-tab" + (detailTab === t.key ? " active" : "");
      btn.textContent = t.key === "job" && c && c.isMonster ? "合成" : t.label;
      btn.addEventListener("click", () => { detailTab = t.key; renderCharDetail(); });
      tabs.appendChild(btn);
    }
  }

  // ---------- 詳細: ツリータブ（固有ツリー1本＋汎用ツリー3枠を分岐図で表示） ----------
  function buildTreeTab(c) {
    const wrap = document.createElement("div");
    const exclusiveTree = getExclusiveTree(c);
    if (!exclusiveTree) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.textContent = "このジョブに対応するスキルツリーがありません";
      wrap.appendChild(none);
      return wrap;
    }
    const st = getTreeState(c);
    const total = totalSp(c);
    const spent = totalSpentSp(c);

    const head = document.createElement("div");
    head.className = "detail-section-head";
    head.innerHTML = `<span>スキルツリー</span><span class="count">SP ${total - spent}/${total}</span>`;
    wrap.appendChild(head);

    wrap.appendChild(buildTreeSection(c, {
      scopeKey: "exclusive",
      title: `${exclusiveTree.name}（固有）`,
      treeDef: exclusiveTree,
      ranks: st.exclusiveRanks,
      slotDef: null,
    }));

    for (const slot of GENERAL_SLOTS) {
      const slotState = st.general[slot.key];
      const treeDef = getGeneralTree(slotState.treeId);
      wrap.appendChild(buildTreeSection(c, {
        scopeKey: slot.key,
        title: `${slot.label}: ${treeDef.name}`,
        treeDef,
        ranks: slotState.ranks,
        slotDef: slot,
      }));
    }
    return wrap;
  }

  // 1本ぶんのツリーを「見出し(＋交換ボタン)／分岐図／選択中ノードの詳細パネル」として組み立てる
  function buildTreeSection(c, opts) {
    const { scopeKey, title, treeDef, ranks, slotDef } = opts;
    const locked = c.team !== null && isTeamLocked(c.team);
    const section = document.createElement("div");
    section.className = "tree-section";

    const headRow = document.createElement("div");
    headRow.className = "tree-section-head";
    const titleEl = document.createElement("span");
    titleEl.className = "tree-section-title";
    titleEl.textContent = title;
    headRow.appendChild(titleEl);

    if (slotDef) {
      const otherId = slotDef.candidates.find((id) => id !== treeDef.id) || slotDef.candidates[0];
      const otherName = getGeneralTree(otherId).name;
      const confirming = treeSwapConfirm === slotDef.key;
      const swapBtn = document.createElement("button");
      swapBtn.className = "tree-swap-btn" + (confirming ? " confirming" : "");
      swapBtn.textContent = confirming ? "本当に交換する？(SPリセット)" : `⇄ ${otherName}に交換`;
      swapBtn.disabled = locked;
      swapBtn.addEventListener("click", () => {
        if (confirming) {
          swapGeneralSlot(c, slotDef.key);
          treeSwapConfirm = null;
          treeSelectedNode = null;
        } else {
          treeSwapConfirm = slotDef.key;
        }
        scheduleSave();
        renderCharDetail();
      });
      headRow.appendChild(swapBtn);
    }
    section.appendChild(headRow);

    section.appendChild(buildTreeGraph(c, scopeKey, treeDef, ranks));

    if (treeSelectedNode && treeSelectedNode.scope === scopeKey) {
      const selNode = treeDef.nodes.find((n) => n.id === treeSelectedNode.nodeId);
      if (selNode) section.appendChild(buildTreeNodeDetail(c, treeDef, ranks, selNode));
      else treeSelectedNode = null;
    }
    return section;
  }

  // ノードをx/y座標で配置し、前提関係をSVGの線で結ぶ「本当の分岐図」を描画する
  function buildTreeGraph(c, scopeKey, treeDef, ranks) {
    const graph = document.createElement("div");
    graph.className = "tree-graph " + (treeDef.nodes.length >= 5 ? "tree-graph-tall" : "tree-graph-short");

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.add("tree-graph-lines");
    const byId = {};
    for (const node of treeDef.nodes) byId[node.id] = node;
    for (const node of treeDef.nodes) {
      for (const pre of node.prerequisites) {
        const from = byId[pre.nodeId];
        if (!from) continue;
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", from.x);
        line.setAttribute("y1", from.y);
        line.setAttribute("x2", node.x);
        line.setAttribute("y2", node.y);
        const acquired = (ranks[node.id] || 0) > 0 && (ranks[from.id] || 0) > 0;
        line.setAttribute("class", acquired ? "tree-edge acquired" : "tree-edge");
        svg.appendChild(line);
      }
    }
    graph.appendChild(svg);

    for (const node of treeDef.nodes) {
      const acquired = (ranks[node.id] || 0) > 0;
      const canGet = canAcquireNode(c, treeDef, ranks, node);
      const btn = document.createElement("button");
      btn.className = "tree-node" + (node.kind === "active" ? " active-kind" : " passive-kind")
        + (acquired ? " acquired" : canGet ? " available" : " locked")
        + (treeSelectedNode && treeSelectedNode.scope === scopeKey && treeSelectedNode.nodeId === node.id ? " selected" : "");
      btn.style.left = node.x + "%";
      btn.style.top = node.y + "%";
      btn.textContent = node.kind === "active" ? "⚔️" : "🔹";
      btn.setAttribute("aria-label", node.name);
      btn.addEventListener("click", () => {
        treeSelectedNode = { scope: scopeKey, nodeId: node.id };
        treeSwapConfirm = null;
        renderCharDetail();
      });
      graph.appendChild(btn);

      const label = document.createElement("div");
      label.className = "tree-node-label";
      label.style.left = node.x + "%";
      label.style.top = node.y + "%";
      label.textContent = node.name;
      graph.appendChild(label);
    }
    return graph;
  }

  // 選択中ノードの詳細（説明・コスト・習得状況・習得ボタン）を分岐図の下に表示する
  function buildTreeNodeDetail(c, treeDef, ranks, node) {
    const panel = document.createElement("div");
    panel.className = "tree-node-detail";
    const rank = ranks[node.id] || 0;
    const acquired = rank > 0;

    const name = document.createElement("div");
    name.className = "tree-node-detail-name";
    name.textContent = node.name;
    panel.appendChild(name);

    const desc = document.createElement("div");
    desc.className = "tree-node-detail-desc";
    desc.textContent = node.desc || "";
    panel.appendChild(desc);

    if (acquired) {
      const state = document.createElement("div");
      state.className = "tree-node-detail-state";
      state.textContent = "習得済み";
      panel.appendChild(state);
    } else {
      const canGet = canAcquireNode(c, treeDef, ranks, node);
      const btn = document.createElement("button");
      btn.className = "btn primary small";
      btn.textContent = `習得する (SP${node.costByRank[rank]})`;
      btn.disabled = !canGet;
      btn.addEventListener("click", () => {
        acquireNode(c, treeDef, ranks, node);
        scheduleSave();
        renderCharDetail();
      });
      panel.appendChild(btn);
    }
    return panel;
  }

  // ---------- 詳細: 能力値タブ ----------
  function buildStatsTab(c) {
    const wrap = document.createElement("div");
    const race = RACES[c.race];
    const stats = computeStats(c);

    wrap.innerHTML = `<div class="cname">${c.name}${c.isMonster ? "（テイム）" : ""} — ${race.name}・${jobDef(c).name} Lv.${c.level}</div>
      <div class="sub-ability-row">${race.desc}</div>`;

    const partyLabel = document.createElement("div");
    partyLabel.className = "sub-ability-row";
    partyLabel.textContent = "所属パーティ";
    wrap.appendChild(partyLabel);

    const activeRow = document.createElement("div");
    activeRow.className = "job-pick-row";
    const benchLocked = c.team !== null && isTeamLocked(c.team);
    const benchBtn = document.createElement("button");
    benchBtn.className = "job-pick" + (c.team === null ? " active" : "") + (benchLocked ? " disabled" : "");
    benchBtn.textContent = "控え";
    benchBtn.addEventListener("click", () => {
      if (benchLocked) return;
      c.team = null; renderCharDetail();
    });
    activeRow.appendChild(benchBtn);
    for (let i = 0; i < TEAM_LABELS.length; i++) {
      const btn = document.createElement("button");
      const atCap = c.team !== i && teamMembers(i).length >= MAX_ACTIVE;
      const destLocked = c.team !== i && isTeamLocked(i);
      const srcLocked = c.team !== null && c.team !== i && isTeamLocked(c.team);
      const disabled = atCap || destLocked || srcLocked;
      btn.className = "job-pick" + (c.team === i ? " active" : "") + (disabled ? " disabled" : "");
      btn.textContent = TEAM_LABELS[i];
      btn.addEventListener("click", () => {
        if (disabled) return;
        c.team = i;
        clampVitals(c);
        renderCharDetail();
      });
      activeRow.appendChild(btn);
    }
    wrap.appendChild(activeRow);

    const statLabel = document.createElement("div");
    statLabel.className = "sub-ability-row";
    statLabel.textContent = "能力値";
    wrap.appendChild(statLabel);

    const statBox = document.createElement("div");
    statBox.className = "detail-stat-box";
    const rows = [
      ["HP", stats.maxHp], ["MP", stats.maxMp],
      ["ATK", stats.atk], ["MAG", stats.mag],
      ["DEF", stats.def], ["SPD", Math.round(stats.spd * 10) / 10],
    ];
    statBox.innerHTML = rows.map(([k, v]) => `<div class="detail-stat-row"><span>${k}</span><span>${v}</span></div>`).join("");
    wrap.appendChild(statBox);

    return wrap;
  }

  // ---------- 詳細: ジョブタブ ----------
  function buildJobCard(c, jobId, unlocked) {
    const job = JOBS[jobId];
    const trained = c.jobLevels[jobId];
    const lvl = trained ? trained.level : 0;
    const mastered = lvl >= JOB_MASTER_LEVEL;
    const pct = trained ? clamp((trained.exp / trained.expToNext) * 100, 0, 100) : 0;

    const card = document.createElement("button");
    card.className = "job-card" + (c.job === jobId ? " active" : "") + (unlocked ? "" : " locked");
    card.innerHTML = `
      <div class="job-card-icon">${job.icon || "❓"}</div>
      <div class="job-card-level">${trained ? `Lv.${lvl}${mastered ? '<span class="star">★</span>' : ""}` : "未経験"}</div>
      <div class="job-card-name">${job.name}</div>
      <div class="job-card-exp-bar"><div class="fill" style="width:${pct}%"></div></div>`;
    if (!unlocked) card.title = `${JOBS[job.requires.job].name} Lv.${job.requires.level}で解放`;
    card.addEventListener("click", () => {
      if (!unlocked) return;
      switchJob(c, jobId);
      clampVitals(c);
      renderCharDetail();
    });
    return card;
  }

  // ---------- 詳細: 合成タブ（テイムしたモンスター専用） ----------
  function buildFusionTab(c) {
    const wrap = document.createElement("div");
    const desc = document.createElement("div");
    desc.className = "sub-ability-row";
    desc.textContent = "控えのモンスターを素材にして合成すると、経験値として還元されます（素材にしたモンスターは消滅します。装備していたアイテムは所持品に戻ります。チームに編成中のモンスターは選べません）";
    wrap.appendChild(desc);

    const candidates = Inventory.fusionCandidates(c);
    for (const id of [...fusionSelection]) {
      if (!candidates.some((m) => m.id === id)) fusionSelection.delete(id);
    }

    if (candidates.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sub-ability-row";
      empty.textContent = "合成できる控えのモンスターがいません";
      wrap.appendChild(empty);
      if (fusionMessage) {
        const msg = document.createElement("div");
        msg.className = "sub-ability-row";
        msg.textContent = fusionMessage;
        wrap.appendChild(msg);
      }
      return wrap;
    }

    const list = document.createElement("div");
    list.className = "skill-row-list";
    for (const m of candidates) {
      const tpl = getEnemyTemplate(m.race);
      const row = document.createElement("div");
      row.className = "skill-row";
      const icon = document.createElement("div");
      icon.className = "skill-row-icon";
      icon.textContent = (tpl && tpl.icon) || "❓";
      row.appendChild(icon);
      const name = document.createElement("div");
      name.className = "skill-row-name";
      name.textContent = `${m.name}（${RACES[m.race].name}） Lv.${m.level}`;
      row.appendChild(name);
      const selected = fusionSelection.has(m.id);
      const toggle = document.createElement("button");
      toggle.className = "skill-toggle-circle" + (selected ? " on" : "");
      toggle.title = selected ? "タップで選択解除" : "タップで選択";
      toggle.addEventListener("click", () => {
        if (fusionSelection.has(m.id)) fusionSelection.delete(m.id);
        else fusionSelection.add(m.id);
        fusionMessage = "";
        fusionConfirm = false;
        renderCharDetail();
      });
      row.appendChild(toggle);
      list.appendChild(row);
    }
    wrap.appendChild(list);

    const selectedMonsters = candidates.filter((m) => fusionSelection.has(m.id));
    const totalExpGain = Inventory.fusionExpGain(selectedMonsters);

    const footer = document.createElement("div");
    footer.className = "fusion-footer";
    footer.innerHTML = `<span>選択中: ${selectedMonsters.length}体</span><span>獲得EXP: +${totalExpGain}</span>`;
    wrap.appendChild(footer);

    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = selectedMonsters.length === 0 ? "素材を選んでください"
      : (fusionConfirm ? `本当に${selectedMonsters.length}体を合成する（取り消せません）` : `${selectedMonsters.length}体を合成する`);
    btn.disabled = selectedMonsters.length === 0;
    btn.addEventListener("click", () => {
      if (selectedMonsters.length === 0) return;
      if (!fusionConfirm) { fusionConfirm = true; renderCharDetail(); return; }
      fusionConfirm = false;
      // 素材が装備していたアイテムは消滅させず所持品へ戻し、素材を取り除いてEXPを還元する（js/model/inventory.js）
      const result = Inventory.fuse(c, selectedMonsters);
      fusionSelection = new Set();
      fusionMessage = `${result.consumedNames.join("・")}を合成し、${c.name}はEXP+${result.expGain}を獲得した` +
        (result.returnedItems ? `／素材の装備${result.returnedItems}個は所持品に戻した` : "") +
        (result.levelUps.length ? "／" + result.levelUps.join("・") : "") +
        (result.abilityUnlocks.length ? "／" + result.abilityUnlocks.join("・") : "");
      saveGame(); // 素材の消滅は取り消せないため、遅延保存を待たずに確定させる
      renderCharDetail();
    });
    wrap.appendChild(btn);

    if (fusionMessage) {
      const msg = document.createElement("div");
      msg.className = "sub-ability-row";
      msg.textContent = fusionMessage;
      wrap.appendChild(msg);
    }

    return wrap;
  }

  function buildJobTab(c) {
    if (c.isMonster) return buildFusionTab(c);
    const wrap = document.createElement("div");

    const advIds = Object.keys(JOBS).filter((id) => JOBS[id].tier === "advanced");
    const masteredCount = (ids) => ids.filter((id) => (c.jobLevels[id] && c.jobLevels[id].level) >= JOB_MASTER_LEVEL).length;

    const basicHead = document.createElement("div");
    basicHead.className = "detail-section-head";
    basicHead.innerHTML = `<span>基本職</span><span class="count">${masteredCount(BASIC_JOB_IDS)}/${BASIC_JOB_IDS.length}</span>`;
    wrap.appendChild(basicHead);

    const basicGrid = document.createElement("div");
    basicGrid.className = "job-card-grid";
    for (const jobId of BASIC_JOB_IDS) basicGrid.appendChild(buildJobCard(c, jobId, true));
    wrap.appendChild(basicGrid);

    const advHead = document.createElement("div");
    advHead.className = "detail-section-head";
    advHead.innerHTML = `<span>上級職（対応する基本職をLv.${JOB_MASTER_LEVEL}まで極めると転職できる）</span><span class="count">${masteredCount(advIds)}/${advIds.length}</span>`;
    wrap.appendChild(advHead);

    const advGrid = document.createElement("div");
    advGrid.className = "job-card-grid";
    for (const jobId of advIds) advGrid.appendChild(buildJobCard(c, jobId, jobUnlocked(c, jobId)));
    wrap.appendChild(advGrid);

    return wrap;
  }

  // ---------- 詳細: スキルタブ ----------
  const ABILITY_KIND_ICONS = { physical: "⚔️", magic: "🔥", heal: "✨" };

  function buildSkillRow(c, a, opts) {
    opts = opts || {};
    const row = document.createElement("div");
    row.className = "skill-row" + (opts.locked ? " locked" : "");

    const icon = document.createElement("div");
    icon.className = "skill-row-icon";
    icon.textContent = ABILITY_KIND_ICONS[a.kind] || "◆";
    row.appendChild(icon);

    const name = document.createElement("div");
    name.className = "skill-row-name";
    name.textContent = a.name;
    row.appendChild(name);

    if (opts.locked) {
      const lockedLabel = document.createElement("div");
      lockedLabel.className = "skill-row-locked-label";
      lockedLabel.textContent = `Lv.${a.reqLevel}で習得`;
      row.appendChild(lockedLabel);
      return row;
    }

    if (opts.staticOn) {
      const staticToggle = document.createElement("div");
      staticToggle.className = "skill-toggle-circle on static";
      row.appendChild(staticToggle);
      return row;
    }

    const on = isSkillActive(c, a.id);
    const tier = getAbilityTier(c, a.id);
    const tierInfo = ABILITY_TIERS.find((t) => t.value === tier);
    const tierBtn = document.createElement("button");
    tierBtn.className = "priority-chip tier-" + tier + (on ? "" : " dim");
    tierBtn.textContent = tierInfo.label;
    tierBtn.title = "タップで優先度を切り替え（優先→通常→温存）";
    tierBtn.addEventListener("click", () => { cycleAbilityTier(c, a.id); renderCharDetail(); });
    row.appendChild(tierBtn);

    const toggle = document.createElement("button");
    toggle.className = "skill-toggle-circle" + (on ? " on" : "");
    toggle.title = on ? "タップでOFFにする" : "タップでONにする";
    toggle.addEventListener("click", () => {
      c.skillActive[a.id] = !isSkillActive(c, a.id);
      renderCharDetail();
    });
    row.appendChild(toggle);

    return row;
  }

  function buildSkillTab(c) {
    const wrap = document.createElement("div");

    const activeList = availableAbilities(c);
    const lockedList = jobDef(c).abilities.filter((a) => c.level < a.reqLevel);
    const activeHead = document.createElement("div");
    activeHead.className = "detail-section-head";
    activeHead.innerHTML = `<span>アクティブ（OFFで不使用、優先度で使う順番を調整）</span><span class="count">${activeList.length}/${activeList.length + lockedList.length}</span>`;
    wrap.appendChild(activeHead);

    const activeListWrap = document.createElement("div");
    activeListWrap.className = "skill-row-list";
    for (const a of activeList) activeListWrap.appendChild(buildSkillRow(c, a));
    for (const a of lockedList) activeListWrap.appendChild(buildSkillRow(c, a, { locked: true }));
    wrap.appendChild(activeListWrap);

    const race = RACES[c.race];
    const passives = Object.keys(race.passive).map((k) => ({ id: "p_" + k, name: PASSIVE_LABELS[k](race.passive[k]), kind: "passive" }));
    if (race.expMult !== 1) passives.push({ id: "p_exp", name: `獲得経験値 ${Math.round((race.expMult - 1) * 100)}%`, kind: "passive" });
    const passiveHead = document.createElement("div");
    passiveHead.className = "detail-section-head";
    passiveHead.innerHTML = `<span>パッシブ（種族特性、常時有効）</span><span class="count">${passives.length}/${passives.length}</span>`;
    wrap.appendChild(passiveHead);

    const passiveListWrap = document.createElement("div");
    passiveListWrap.className = "skill-row-list";
    for (const p of passives) passiveListWrap.appendChild(buildSkillRow(c, p, { staticOn: true }));
    if (passives.length === 0) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.textContent = "（この種族に特性はありません）";
      passiveListWrap.appendChild(none);
    }
    wrap.appendChild(passiveListWrap);

    if (!c.isMonster) {
      const subLabels = ["サブアビリティ①", "サブアビリティ②"];
      for (let slot = 0; slot < 2; slot++) {
        const subRow = document.createElement("div");
        subRow.className = "sub-ability-row";
        subRow.textContent = `${subLabels[slot]}（他ジョブで実際にレベルを上げた技を装備できる）`;
        wrap.appendChild(subRow);

        const subPickRow = document.createElement("div");
        subPickRow.className = "sub-pick-row";
        const noneBtn = document.createElement("button");
        noneBtn.className = "sub-pick" + (!c.subAbilityIds[slot] ? " active" : "");
        noneBtn.textContent = "なし";
        noneBtn.addEventListener("click", () => { c.subAbilityIds[slot] = null; renderCharDetail(); });
        subPickRow.appendChild(noneBtn);

        const otherSlotId = c.subAbilityIds[1 - slot];
        const candidates = subAbilityCandidates(c).filter((a) => a.id !== otherSlotId);
        for (const a of candidates) {
          const btn = document.createElement("button");
          btn.className = "sub-pick" + (c.subAbilityIds[slot] === a.id ? " active" : "");
          btn.textContent = a.name;
          btn.addEventListener("click", () => { c.subAbilityIds[slot] = a.id; renderCharDetail(); });
          subPickRow.appendChild(btn);
        }
        wrap.appendChild(subPickRow);
      }
      if (subAbilityCandidates(c).length === 0) {
        const hintEl = document.createElement("div");
        hintEl.className = "sub-ability-row";
        hintEl.textContent = "（まだ他ジョブの技を習得していません）";
        wrap.appendChild(hintEl);
      }
    }

    const targetRow = document.createElement("div");
    targetRow.className = "sub-ability-row";
    targetRow.textContent = "攻撃対象の優先度（単体を狙う技・通常攻撃に適用）";
    wrap.appendChild(targetRow);

    const targetPickRow = document.createElement("div");
    targetPickRow.className = "sub-pick-row";
    for (const mode of TARGET_MODES) {
      const btn = document.createElement("button");
      btn.className = "sub-pick" + (c.targetPriority === mode.value ? " active" : "");
      btn.textContent = mode.label;
      btn.addEventListener("click", () => { c.targetPriority = mode.value; renderCharDetail(); });
      targetPickRow.appendChild(btn);
    }
    wrap.appendChild(targetPickRow);

    return wrap;
  }

  // ---------- 所持品一覧 ----------
  // 未装備のアイテム(inventory配列)と、スキルブック(skillBooks配列。ドロップ・鑑定・
  // 使用はまだ未実装の予約フィールド)をスロット種別／スキルブックで絞り込んで一覧表示する。
  // 装備中のアイテムはinventoryから除外されており(equipItem/unequipSlot参照)、
  // 各キャラの装備タブからいつでも確認できるため、ここでは未装備分だけを扱う。
  let inventoryFilterSlot = "all"; // "all" | SLOTS[].key | "skillBook"

  function openInventoryScreen() {
    inventoryFilterSlot = "all";
    renderInventoryScreen();
    showScreen("screen-inventory");
  }

  function renderInventoryScreen() {
    const filterRow = document.getElementById("inventoryFilterRow");
    filterRow.innerHTML = "";
    const filters = [{ key: "all", name: "すべて" }, ...SLOTS, { key: "skillBook", name: "スキルブック" }];
    for (const f of filters) {
      const btn = document.createElement("button");
      btn.className = "priority-chip" + (inventoryFilterSlot === f.key ? " tier-3" : "");
      btn.textContent = f.name;
      btn.addEventListener("click", () => { inventoryFilterSlot = f.key; renderInventoryScreen(); });
      filterRow.appendChild(btn);
    }

    const totalCount = S.inventory.length + S.skillBooks.length;
    const shownCount = inventoryFilterSlot === "all" ? totalCount
      : inventoryFilterSlot === "skillBook" ? S.skillBooks.length
      : S.inventory.filter((i) => i.slot === inventoryFilterSlot).length;
    document.getElementById("inventoryCount").textContent = `所持品 ${totalCount}個中 ${shownCount}個を表示`;

    const body = document.getElementById("inventoryBody");
    body.innerHTML = "";
    if (shownCount === 0) {
      const none = document.createElement("div");
      none.className = "sub-ability-row";
      none.textContent = inventoryFilterSlot === "skillBook"
        ? "スキルブックがありません（スキルブックの入手・鑑定・使用はまだ実装されていません）"
        : "未装備の所持品がありません（装備中のアイテムは各キャラの装備タブで確認できます）";
      body.appendChild(none);
      return;
    }

    for (const slot of SLOTS) {
      if (inventoryFilterSlot !== "all" && inventoryFilterSlot !== slot.key) continue;
      const items = S.inventory
        .filter((i) => i.slot === slot.key)
        .sort((a, b) => {
          const ra = RARITIES.findIndex((r) => r.key === a.rarity);
          const rb = RARITIES.findIndex((r) => r.key === b.rarity);
          return rb - ra || itemEffectiveValue(b) - itemEffectiveValue(a);
        });
      if (items.length === 0) continue;
      body.appendChild(sectionLabel(`${slot.name}（${items.length}個）`));
      const list = document.createElement("div");
      list.className = "skill-row-list";
      for (const item of items) list.appendChild(buildInventoryItemRow(item));
      body.appendChild(list);
    }

    if (inventoryFilterSlot === "all" || inventoryFilterSlot === "skillBook") {
      const books = S.skillBooks.slice().sort((a, b) => {
        const ra = RARITIES.findIndex((r) => r.key === a.rarity);
        const rb = RARITIES.findIndex((r) => r.key === b.rarity);
        return rb - ra;
      });
      if (books.length > 0) {
        body.appendChild(sectionLabel(`スキルブック（${books.length}個）`));
        const list = document.createElement("div");
        list.className = "skill-row-list";
        for (const book of books) list.appendChild(buildInventorySkillBookRow(book));
        body.appendChild(list);
      }
    }
  }

  function buildInventoryItemRow(item) {
    const row = document.createElement("div");
    row.className = "skill-row";
    row.style.borderColor = item.rarityColor;

    const icon = document.createElement("div");
    icon.className = "skill-row-icon";
    icon.textContent = SLOT_ICONS[item.slot] || "❓";
    row.appendChild(icon);

    const name = document.createElement("div");
    name.className = "skill-row-name";
    const rarity = RARITIES.find((r) => r.key === item.rarity);
    name.textContent = `${itemLabel(item)}（${rarity ? rarity.name : item.rarity}）`;
    row.appendChild(name);

    const enhance = document.createElement("button");
    enhance.className = "priority-chip";
    enhance.textContent = "強化する";
    enhance.addEventListener("click", () => openEnhanceModal(item, () => renderInventoryScreen()));
    row.appendChild(enhance);

    return row;
  }

  // スキルブックのドロップ・鑑定・使用は未実装のため、現状は一覧表示のみ（操作ボタンなし）。
  // 未鑑定では詳細設計§6.3のとおりレア度だけを表示し、名称・効果・適性はUIに出さない
  function buildInventorySkillBookRow(book) {
    const row = document.createElement("div");
    row.className = "skill-row";
    const rarity = RARITIES.find((r) => r.key === book.rarity);
    if (rarity) row.style.borderColor = rarity.color;

    const icon = document.createElement("div");
    icon.className = "skill-row-icon";
    icon.textContent = "📖";
    row.appendChild(icon);

    const name = document.createElement("div");
    name.className = "skill-row-name";
    const rarityName = rarity ? rarity.name : book.rarity;
    name.textContent = book.identified
      ? `${book.name || "鑑定済みのスキルブック"}（${rarityName}）`
      : `未鑑定のスキルブック（${rarityName}）`;
    row.appendChild(name);

    return row;
  }

  document.getElementById("btnOpenInventory").addEventListener("click", () => { openInventoryScreen(); });
  document.getElementById("btnInventoryBack").addEventListener("click", () => { showScreen("screen-jobs"); });

  // 装備セクション（スロットをタップで所持品から選ぶ）
  let openSlot = null; // "charId:slotKey"

  function buildEquipSection(c) {
    const wrap = document.createElement("div");

    const head = document.createElement("div");
    head.className = "sub-ability-row";
    head.textContent = `装備（所持品 ${S.inventory.length}個）`;
    wrap.appendChild(head);

    const row = document.createElement("div");
    row.className = "equip-slot-row";
    for (const slot of SLOTS) {
      const item = c.equip[slot.key];
      const key = `${c.id}:${slot.key}`;
      const btn = document.createElement("button");
      btn.className = "equip-slot" + (item ? " filled" : "") + (openSlot === key ? " open" : "");
      if (item) btn.style.borderColor = item.rarityColor;
      btn.innerHTML = `<span class="slot-name">${slot.name}</span>
        <span class="slot-item">${item ? itemLabel(item) : "なし"}</span>`;
      btn.addEventListener("click", () => {
        openSlot = openSlot === key ? null : key;
        renderCharDetail();
      });
      row.appendChild(btn);
    }
    wrap.appendChild(row);

    const autoBtn = document.createElement("button");
    autoBtn.className = "equip-choice";
    autoBtn.style.marginTop = "6px";
    autoBtn.textContent = "おまかせ装備";
    autoBtn.addEventListener("click", () => { autoEquip(c); renderCharDetail(); });
    wrap.appendChild(autoBtn);

    // 開いているスロットの候補一覧
    const opened = SLOTS.find((s) => openSlot === `${c.id}:${s.key}`);
    if (opened) {
      const list = document.createElement("div");
      list.className = "equip-choice-list";
      const candidates = S.inventory
        .filter((i) => i.slot === opened.key)
        .sort((a, b) => itemScore(c, b) - itemScore(c, a));

      if (c.equip[opened.key]) {
        const off = document.createElement("button");
        off.className = "equip-choice";
        off.textContent = "はずす";
        off.addEventListener("click", () => { unequipSlot(c, opened.key); renderCharDetail(); });
        list.appendChild(off);

        const enhance = document.createElement("button");
        enhance.className = "equip-choice enhance-open";
        enhance.textContent = "強化する";
        enhance.addEventListener("click", () => openEnhanceModal(c.equip[opened.key]));
        list.appendChild(enhance);
      }
      if (candidates.length === 0) {
        const none = document.createElement("div");
        none.className = "sub-ability-row";
        none.textContent = `（${opened.name}の手持ちがありません）`;
        list.appendChild(none);
      }
      for (const item of candidates) {
        const btn = document.createElement("button");
        btn.className = "equip-choice";
        btn.style.borderColor = item.rarityColor;
        btn.textContent = itemLabel(item);
        btn.addEventListener("click", () => { equipItem(c, item); openSlot = null; renderCharDetail(); });
        list.appendChild(btn);
      }
      wrap.appendChild(list);
    }

    return wrap;
  }

  // ---------- 装備強化 ----------
  const SLOT_ICONS = { weapon: "⚔️", armor: "🛡️", accessory: "💍" };
  let enhanceItem = null;
  let enhanceMessage = "";
  let enhanceOnClose = null; // 呼び出し元の画面を再描画するコールバック（未指定ならキャラ詳細を再描画）

  function openEnhanceModal(item, onClose) {
    enhanceItem = item;
    enhanceMessage = "";
    enhanceOnClose = onClose || null;
    renderEnhanceModal();
    document.getElementById("enhanceModal").classList.remove("hidden");
  }

  function closeEnhanceModal() {
    document.getElementById("enhanceModal").classList.add("hidden");
    enhanceItem = null;
    const onClose = enhanceOnClose;
    enhanceOnClose = null;
    if (onClose) onClose();
    else renderCharDetail();
  }

  function renderEnhanceModal() {
    const item = enhanceItem;
    if (!item) return;
    const rarity = RARITIES.find((r) => r.key === item.rarity);
    const maxed = item.plus >= ENHANCE_MAX_PLUS;
    const nextValue = itemEffectiveValue({ ...item, plus: item.plus + 1 });

    document.getElementById("enIcon").textContent = SLOT_ICONS[item.slot] || "❓";
    document.getElementById("enName").textContent = `${item.name}${item.plus > 0 ? "+" + item.plus : ""}`;
    document.getElementById("enDesc").textContent =
      `${rarity.name} / ${STAT_LABELS[item.stat]}+${itemEffectiveValue(item)}` +
      (maxed ? "（強化値が上限に達しています）" : ` → 成功で ${STAT_LABELS[item.stat]}+${nextValue}`);

    const rate = enhanceSuccessRate(item);
    const cost = enhanceCost(item);
    const statsBox = document.getElementById("enStats");
    statsBox.innerHTML = `
      <div class="pm-stat-row"><span class="pm-stat-label">強化値</span><span>+${item.plus} / +${ENHANCE_MAX_PLUS}</span></div>
      <div class="pm-stat-row"><span class="pm-stat-label">成功率</span><span>${formatEnhanceRate(rate)}</span></div>
      <div class="pm-stat-row"><span class="pm-stat-label">消費強化石</span><span>${cost}（所持 ${S.material}）</span></div>` +
      (isFeatureEnabled("enhancePity") && !maxed ? buildPityRow(item) : "") +
      (isFeatureEnabled("guaranteedStone") && !maxed
        ? `<div class="pm-stat-row"><span class="pm-stat-label">確定強化石</span><span>必要 ${guaranteedStonesRequired(item)}個（所持 ${guaranteedStoneTotal()}：無償${S.guaranteedStones.free}／有償${S.guaranteedStones.paid}）</span></div>`
        : "");

    const resultBox = document.getElementById("enResult");
    resultBox.textContent = enhanceMessage;
    resultBox.className = "enhance-result" + (enhanceMessage.startsWith("成功") ? " success" : enhanceMessage ? " fail" : "");

    const btn = document.getElementById("btnEnhanceGo");
    btn.disabled = maxed || S.material < cost;
    btn.textContent = maxed ? "強化値が上限です" : (S.material < cost ? "強化石が足りません" : "強化する");

    const gBtn = document.getElementById("btnEnhanceGuaranteed");
    gBtn.classList.toggle("hidden", !isFeatureEnabled("guaranteedStone"));
    const required = maxed ? 0 : guaranteedStonesRequired(item);
    const enough = guaranteedStoneTotal() >= required;
    gBtn.disabled = maxed || !enough;
    gBtn.textContent = maxed ? "強化値が上限です"
      : (enough ? `確定強化石${required}個で強化する（成功率100%）` : `確定強化石が足りません（あと${required - guaranteedStoneTotal()}個）`);
  }

  function buildPityRow(item) {
    const threshold = enhancePityThreshold(item);
    const pity = Math.min(item.pity || 0, threshold);
    const text = isPityReady(item) ? "次の強化は必ず成功" : `${pity} / ${threshold}`;
    return `<div class="pm-stat-row"><span class="pm-stat-label">天井</span><span>${text}</span></div>`;
  }

  // 成功率は低い帯（LRの終盤は0.5%）でも0%と表示されないよう、10%未満は小数第1位まで出す
  function formatEnhanceRate(rate) {
    const pct = rate * 100;
    return (pct < 10 ? pct.toFixed(1) : String(Math.round(pct))) + "%";
  }

  document.getElementById("btnEnhanceGo").addEventListener("click", () => {
    // 判定と強化石・+値・天井ゲージへの反映は js/model/inventory.js
    const result = Inventory.enhanceItem(enhanceItem);
    if (!result) return;
    enhanceMessage = result.success
      ? `成功！ +${result.plus} になった` + (result.pityHit ? "（天井）" : "")
      : `失敗…（+${result.plus} のまま）`;
    scheduleSave();
    renderEnhanceModal();
  });
  // 確定強化石: その段の期待消費に応じた個数を消費して必ず+1する（通常の強化石は消費しない）。
  // 消費は取り消せないため即時保存する
  document.getElementById("btnEnhanceGuaranteed").addEventListener("click", () => {
    const result = Inventory.enhanceWithGuaranteed(enhanceItem); // 消費は無償分から
    if (!result) return;
    enhanceMessage = `成功！ +${result.plus} になった（確定強化石${result.required}個を使用）`;
    saveGame();
    renderEnhanceModal();
  });
  document.getElementById("btnEnhanceClose").addEventListener("click", closeEnhanceModal);
  document.getElementById("enhanceModal").addEventListener("click", (e) => {
    if (e.target.id === "enhanceModal") closeEnhanceModal();
  });

  document.getElementById("btnJobsDone").addEventListener("click", () => {
    if (jobsReturnScreen === "screen-map") {
      openMap();
    } else {
      openExploreHub();
    }
  });
  document.getElementById("btnMapJobs").addEventListener("click", () => {
    jobsReturnScreen = "screen-map";
    renderJobsScreen();
    showScreen("screen-jobs");
  });
  document.getElementById("btnRecruit").addEventListener("click", () => { openCreateScreen(); });
  document.getElementById("btnDetailBack").addEventListener("click", () => {
    detailCharId = null;
    openSlot = null;
    renderJobsScreen();
    showScreen("screen-jobs");
  });

  // ---------- Battle ----------
  const ATB_RATE = 7;
  const BASIC_ATTACK = QPCore.battle.BASIC_ATTACK;

  let partyEls = {};
  let nextBattleTimer = new Array(TEAM_COUNT).fill(null);

  function startDungeon(teamIndex, id, opts) {
    opts = opts || {};
    clearTimeout(nextBattleTimer[teamIndex]);
    const run = Runner.startRun(teamIndex, id);
    const d = run.dungeon;
    logEvent(teamIndex, "start", `${d.name} に出発した`, `全${d.battles}戦　推奨レベル ${d.level}`);
    trimTeamLog(teamIndex);
    if (teamIndex === S.activeTeam) {
      buildPartyDock();
      renderDock();
    }
    if (opts.navigate) showScreen("screen-battle");
    startBattle(run);
  }

  function startBattle(run) {
    const { battle, isBoss } = Runner.startBattle(run);
    logEvent(run.team, "encounter", isBoss ? "ボスが立ちはだかる！" : "敵が現れた！", enemyRoster(battle));
    if (run.team === S.activeTeam) renderDock();
  }

  // 敵の残り状況をテキストで表示（敵パネルの代わり）
  function enemyRoster(battle) {
    const counts = {};
    for (const e of battle.enemies) {
      const k = e.name;
      if (!counts[k]) counts[k] = { total: 0, alive: 0 };
      counts[k].total += 1;
      if (e.alive) counts[k].alive += 1;
    }
    return Object.keys(counts)
      .map((k) => {
        const c = counts[k];
        return c.alive === 0 ? `${k} ×${c.total}（全滅）` : `${k} ×${c.alive}`;
      })
      .join("　");
  }

  // ---------- Log ----------
  // 4チームが並行して進行するため、ログ履歴はチームごとにデータとして保持し、
  // 実際にDOMへ描画するのは「現在表示中のチーム」の分だけにする。
  // 背後で進行しているチームのログはteamLogsに積み上がるだけで、タブ切替時にrenderLogFeedで一括描画する。
  // 周回のたびに消してしまうと直前の結果を見返せないため消さず、直近LOG_HISTORY_RUNS周分だけを残して
  // それより古い周回のログはtrimTeamLogでまとめて間引く（大量に自動周回してもDOMが際限なく増えないように）
  const LOG_HISTORY_RUNS = 20;
  let teamLogs = Array.from({ length: TEAM_COUNT }, () => []); // [{type,title,subtitle,lines:[{text,cls}|{drop:item}]}]

  function trimTeamLog(teamIndex) {
    const entries = teamLogs[teamIndex];
    let startCount = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === "start") {
        startCount += 1;
        if (startCount > LOG_HISTORY_RUNS) {
          entries.splice(0, i + 1);
          if (teamIndex === S.activeTeam) renderLogFeed(teamIndex);
          return;
        }
      }
    }
  }

  function logEvent(teamIndex, type, title, subtitle) {
    const entry = { type, title, subtitle: subtitle || "", lines: [] };
    teamLogs[teamIndex].push(entry);
    if (teamIndex === S.activeTeam) appendLogCardDOM(entry);
    return entry;
  }

  function logLine(teamIndex, text, cls) {
    const entries = teamLogs[teamIndex];
    if (entries.length === 0) entries.push({ type: "encounter", title: "戦闘", subtitle: "", lines: [] });
    const entry = entries[entries.length - 1];
    entry.lines.push({ text, cls: cls || "" });
    if (teamIndex === S.activeTeam) appendLogLineDOM(text, cls);
  }

  function logDropLine(teamIndex, item) {
    const entries = teamLogs[teamIndex];
    if (entries.length === 0) return;
    entries[entries.length - 1].lines.push({ drop: item });
    if (teamIndex === S.activeTeam) {
      const feed = document.getElementById("logFeed");
      const card = feed.lastElementChild;
      if (card) card.querySelector(".lc-lines").appendChild(buildDropRow(item));
    }
  }

  function updateCardSubtitle(teamIndex, text) {
    const entries = teamLogs[teamIndex];
    if (entries.length === 0) return;
    entries[entries.length - 1].subtitle = text || "";
    if (teamIndex !== S.activeTeam) return;
    const feed = document.getElementById("logFeed");
    const card = feed.lastElementChild;
    if (!card) return;
    const sub = card.querySelector(".lc-sub");
    sub.textContent = text || "";
    sub.style.display = text ? "" : "none";
  }

  function appendLogCardDOM(entry) {
    const feed = document.getElementById("logFeed");
    const card = document.createElement("div");
    card.className = "log-card " + entry.type;
    const t = document.createElement("div");
    t.className = "lc-title";
    t.textContent = entry.title;
    card.appendChild(t);
    const sub = document.createElement("div");
    sub.className = "lc-sub";
    sub.textContent = entry.subtitle || "";
    if (!entry.subtitle) sub.style.display = "none";
    card.appendChild(sub);
    const lines = document.createElement("div");
    lines.className = "lc-lines";
    for (const l of entry.lines) {
      if (l.drop) { lines.appendChild(buildDropRow(l.drop)); continue; }
      const div = document.createElement("div");
      div.className = "lc-line " + (l.cls || "");
      div.textContent = l.text;
      lines.appendChild(div);
    }
    card.appendChild(lines);
    feed.appendChild(card);
    scrollLog();
  }

  function appendLogLineDOM(text, cls) {
    const feed = document.getElementById("logFeed");
    const card = feed.lastElementChild;
    if (!card) return;
    const lines = card.querySelector(".lc-lines");
    const div = document.createElement("div");
    div.className = "lc-line " + (cls || "");
    div.textContent = text;
    lines.appendChild(div);
    scrollLog();
  }

  // 表示するチームを切り替えた時、そのチームのログ履歴からDOMを丸ごと再構築する
  function renderLogFeed(teamIndex) {
    const feed = document.getElementById("logFeed");
    feed.innerHTML = "";
    for (const entry of teamLogs[teamIndex]) appendLogCardDOM(entry);
    if (teamLogs[teamIndex].length === 0 && !teamRuns[teamIndex]) {
      feed.innerHTML = `<p class="sub" style="margin:24px 0;text-align:center;">下の「マップ」からダンジョンを選んで冒険を始めましょう</p>`;
    }
  }

  function scrollLog() {
    const feed = document.getElementById("logFeed");
    feed.scrollTop = feed.scrollHeight;
  }

  // ---------- Dock ----------
  function buildPartyDock() {
    const partyRow = document.getElementById("partyRow");
    partyRow.innerHTML = "";
    partyEls = {};
    for (const c of activeParty()) {
      const card = document.createElement("div");
      card.className = "actor-card";
      card.innerHTML = `
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
    document.getElementById("dockDungeon").textContent = d ? d.name : "—";
    renderLogFeed(S.activeTeam);
    document.getElementById("dockStatus").textContent = !d
      ? ""
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

  // ---------- Auto-battle AI ----------
  function mpCostFor(c, ability) {
    const mult = (racePassive(c, "mpCostMult") || 1) * (treePassive(c, "mpCostMult") || 1);
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
      passives: (c) => ({
        lifesteal: racePassive(c, "lifesteal") + treePassive(c, "lifesteal"),
        healBonus: racePassive(c, "healBonus") + treePassive(c, "healBonus"),
        critBonus: racePassive(c, "critBonus") + treePassive(c, "critBonus"),
        dmgTakenMult: (racePassive(c, "dmgTakenMult") || 1) * (treePassive(c, "dmgTakenMult") || 1),
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
        logLine(t, `${ev.actor.name} の${ev.ability.name}！ ${ev.target.name}に${ev.dmg}のダメージ！` + (ev.drained > 0 ? `（${ev.drained}吸収）` : ""), "hit");
        break;
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
    tick(dtRaw * speedMult);
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
    Runner.finishRun(run, info.cleared);
    const isViewed = run.team === S.activeTeam;

    logEvent(run.team,
      info.cleared ? "clear" : "wipe",
      info.cleared ? `${run.dungeon.name} を踏破した！` : "パーティは全滅した・・・",
      info.cleared ? `合計 EXP +${run.expTotal}` : `${run.dungeon.name} の ${run.battleIndex + 1}戦目で力尽きた`
    );

    if (run.levelUps.length) logLine(run.team, "LEVEL UP! " + run.levelUps.join(" / "), "system");
    if (run.abilityUnlocks.length) logLine(run.team, run.abilityUnlocks.join(" / "), "heal");

    if (info.tameResult) {
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
      scheduleNext(run.team, () => startDungeon(run.team, nextId), 1400);
    }
  }

  function buildDropRow(item) {
    const row = document.createElement("div");
    row.className = "drop-row";
    const dot = document.createElement("div");
    dot.className = "drop-dot";
    dot.style.background = item.rarityColor;
    row.appendChild(dot);
    const label = document.createElement("div");
    label.textContent = itemLabel(item);
    row.appendChild(label);
    return row;
  }

  function itemLabel(item) {
    const plusText = item.plus > 0 ? `+${item.plus}` : "";
    return `${item.name}${plusText}（${STAT_LABELS[item.stat]}+${itemEffectiveValue(item)}）`;
  }

  // タブを閉じる・バックグラウンドに回す・アプリを切り替えるなど、
  // ページが見えなくなるタイミングで必ず保存しておく（iOS Safariでは
  // beforeunload/pagehideが確実に発火しないことがあるため、visibilitychangeも併用）
  // バックグラウンド中はrequestAnimationFrameが止まり戦闘が進まないため、ページを破棄されずに復帰した場合も
  // 起動時と同じオフライン精算を行う。隠れる直前に保存したセーブのsavedAtを起点にするので、
  // 復帰せずにページが破棄された場合（次回起動時に精算）と二重に精算されることはない
  let hiddenSaveAt = null;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenSaveAt = saveGame() ? lastSavedAt : null;
      return;
    }
    const since = hiddenSaveAt;
    hiddenSaveAt = null;
    if (since) settleAfterBackground(since);
  });

  function settleAfterBackground(savedAt) {
    const elapsedMs = Date.now() - savedAt;
    // 1周ぶんの時間も経っていないチームは、中断せずそのまま続きから再開する
    const targets = [];
    for (let i = 0; i < TEAM_COUNT; i++) {
      const run = teamRuns[i];
      if (!S.autoRepeat[i].active || !run || !run.dungeon) continue;
      if (elapsedMs / 1000 < Runner.estimateOfflineRunSeconds(run.dungeon)) continue;
      targets.push(i);
    }
    if (targets.length === 0) return;
    if (!claimOfflineSettlement(savedAt)) { enqueueModal(showOfflineSettleFailedModal); processModalQueue(); return; }

    const infos = new Array(TEAM_COUNT).fill(null);
    for (const i of targets) {
      const run = teamRuns[i];
      infos[i] = { active: true, target: S.autoRepeat[i].target, done: S.autoRepeat[i].done, dungeonId: run.dungeon.id };
      // 離れる直前の周回は途中で止まっているため打ち切り、離れていた時間ぶんはまとめて精算する
      // （起動時の精算で途中の周回を破棄するのと同じ扱い。この周の未確定ドロップは持ち帰れない）
      clearTimeout(nextBattleTimer[i]);
      if (Runner.interruptRun(i)) {
        logEvent(i, "wipe", "アプリを離れていたため、この周回を中断した", "離れていた間の自動周回はまとめて精算しました");
      }
    }
    const summaries = runOfflineProgress(infos, savedAt);
    saveGame();
    buildPartyDock();
    renderDock();
    if (summaries) { enqueueModal(() => showOfflineModal(summaries)); processModalQueue(); }
  }
  window.addEventListener("pagehide", saveGame);
  // バックグラウンド中は定期保存しない（保存済みのsavedAtを「離れた時刻」として固定し、復帰時の精算と
  // 次回起動時の精算が同じ期間を二重に数えないようにするため。隠れる直前には必ず保存している）
  setInterval(() => { if (!document.hidden) saveGame(); }, 20000);

  loadGame();
  renderTitle();
  showScreen("screen-title");
  document.getElementById("btnSettingsAnnounce").classList.toggle("hidden", !isFeatureEnabled("announcements"));

  // 起動時は「お知らせ→オフライン結果」の順でキューへ積み、他のモーダルが無い時だけ1つずつ開く
  if (isFeatureEnabled("announcements")) {
    const startupAnnouncement = pickStartupAnnouncement();
    if (startupAnnouncement) enqueueModal(() => openAnnouncementModal(startupAnnouncement));
  }
  if (pendingOfflineSummaries) enqueueModal(() => showOfflineModal(pendingOfflineSummaries));
  if (offlineSettleFailed) enqueueModal(showOfflineSettleFailedModal);
  processModalQueue();
})();

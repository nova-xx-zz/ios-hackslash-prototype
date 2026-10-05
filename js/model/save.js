// ---------- ゲームの状態とセーブ（model/save） ----------
// 保存対象のゲームの状態（ロスター・所持品・強化石・踏破済みダンジョン・自動周回など）を1つのオブジェクトにまとめ、
// セーブデータへの書き出し（serialize）と読み込み・旧形式からの移行（deserialize）を行う。
// 端末への書き込みや画面表示は行わない（game.js側）。状態を1つにまとめておくことで、本番化では
// このオブジェクトをそのままクラウドセーブやサーバーとやり取りできる（docs/production-plan.md §4）。
// 戦闘中の一時的な状態(run/battle)や画面表示用の状態は含めない。
(function (root) {
  "use strict";

  // schemaVersion 2からは、このメインセーブのmaterialを正本とし、旧jobquest_materialキーは
  // 互換ミラーとして更新するのみにする（強化石・スキルブックの鑑定など複数キーにまたがる更新を
  // 1回の保存でまとめて確定させるため）
  const SCHEMA_VERSION = 2;

  // 保存対象のゲームの状態の初期値。teamCount: チーム数、autoRepeatTarget: 自動周回の既定の回数
  function createState(opts) {
    opts = opts || {};
    const teamCount = opts.teamCount || 4;
    return {
      roster: [],
      inventory: [],
      activeTeam: 0, // 探索画面/編成画面で「表示中」のチーム（探索の進行そのものとは独立）
      clearedDungeons: new Set(),
      nextCharSeq: 1,
      // 自動周回（チームごとに独立して設定・進行する）
      autoRepeat: Array.from({ length: teamCount }, () => ({ active: false, target: opts.autoRepeatTarget || 5, done: 0 })),
      skillBooks: [], // スキルブック機能(未実装)向けの予約フィールド
      material: 0, // 強化石
      // 確定強化石（成功率100%で強化できる有償アイテム）の所持数。入手経路（アプリ内課金・無料配布）は未実装で、
      // FEATURE_FLAGS.guaranteedStone が無効の間はUIにも出ない。本番ではサーバーを正本にする（docs/production-plan.md）。
      // 資金決済法の残高計算で有償分だけを数えられるよう、無償分(free)と有償分(paid)を分けて持ち、消費は無償分から行う
      guaranteedStones: { free: 0, paid: 0 },
    };
  }

  // 状態をセーブデータ（JSONにできるオブジェクト）にする。
  // opts: now（保存時刻）, runDungeonIds（チームごとの探索中ダンジョンのid。オフライン精算に使う）, enabledFeatures
  function serialize(state, opts) {
    opts = opts || {};
    const runDungeonIds = opts.runDungeonIds || [];
    return {
      schemaVersion: SCHEMA_VERSION,
      roster: state.roster,
      inventory: state.inventory,
      activeTeam: state.activeTeam,
      clearedDungeons: [...state.clearedDungeons],
      nextCharSeq: state.nextCharSeq,
      savedAt: opts.now,
      autoRepeat: state.autoRepeat.map((ar, i) => ({
        active: ar.active,
        target: ar.target,
        done: ar.done,
        dungeonId: runDungeonIds[i] || null,
      })),
      skillBooks: state.skillBooks,
      material: state.material,
      guaranteedStones: state.guaranteedStones,
      enabledFeaturesAtSave: opts.enabledFeatures || [],
    };
  }

  // セーブデータ（JSON.parse済み）から状態を復元する。使えないデータならnullを返す。
  // opts: legacyMaterial（旧形式セーブ用。旧jobquest_materialキーの値）,
  //       syncExpToNext（レベル記録の必要EXPを現在の曲線で計算し直す関数。js/data.js）
  // 戻り値: { state（保存対象の項目のみ。自動周回は含めない）, isLegacy, savedAt, savedAutoRepeat }
  function deserialize(data, opts) {
    opts = opts || {};
    if (!data || !Array.isArray(data.roster) || data.roster.length === 0) return null;
    // schemaVersion 2以降はこのセーブのmaterialを正本として使う。それ未満（旧形式）の
    // セーブでは jobquest_material キーが正本だったため、そちらから一度だけ引き継ぐ
    const isLegacy = !(typeof data.schemaVersion === "number" && data.schemaVersion >= SCHEMA_VERSION);
    const gs = data.guaranteedStones;
    const state = {
      roster: data.roster,
      inventory: Array.isArray(data.inventory) ? data.inventory : [],
      activeTeam: typeof data.activeTeam === "number" ? data.activeTeam : 0,
      clearedDungeons: new Set(Array.isArray(data.clearedDungeons) ? data.clearedDungeons : []),
      nextCharSeq: typeof data.nextCharSeq === "number" ? data.nextCharSeq : 1,
      skillBooks: Array.isArray(data.skillBooks) ? data.skillBooks : [],
      material: (!isLegacy && typeof data.material === "number") ? data.material : (opts.legacyMaterial || 0),
      guaranteedStones: (gs && typeof gs === "object")
        ? { free: Number(gs.free) || 0, paid: Number(gs.paid) || 0 }
        : { free: typeof gs === "number" ? gs : 0, paid: 0 }, // 区別のない旧形式は無償分として扱う
    };
    // 必要EXPは保存値ではなく現在の曲線から計算し直す（キャラ本体とジョブごとの記録）
    if (opts.syncExpToNext) {
      for (const c of state.roster) {
        opts.syncExpToNext(c);
        for (const rec of Object.values(c.jobLevels || {})) opts.syncExpToNext(rec);
      }
    }
    return {
      state,
      isLegacy,
      savedAt: data.savedAt,
      // 旧バージョン（単一チームのみの自動周回）のデータはそのままでは形が合わないため、
      // 配列でない場合はオフライン進行の計算対象から外す（ロスター等の本体データは復元される）
      savedAutoRepeat: Array.isArray(data.autoRepeat) ? data.autoRepeat : [],
    };
  }

  // クラウドに置いたセーブ（JSON文字列）を端末に戻す前の確認と下ごしらえ。使えないデータならnull。
  // 戻したセーブで自動周回が稼働中のままだと、起動時にそのセーブの保存時刻からオフライン精算が走るため、
  // 自動周回は止めた状態にする（古いセーブを戻すたびに離れていた時間ぶんの報酬が入るのを防ぐ）。
  // 戻り値: { json（端末に書き込む文字列）, savedAt, summary: { members, maxLevel, clearedDungeons, material } }
  function prepareRestore(json) {
    let data;
    try { data = JSON.parse(json); } catch (e) { return null; }
    if (!deserialize(data, {})) return null;
    if (Array.isArray(data.autoRepeat)) data.autoRepeat = data.autoRepeat.map((ar) => Object.assign({}, ar, { active: false }));
    const roster = data.roster;
    return {
      json: JSON.stringify(data),
      savedAt: typeof data.savedAt === "number" ? data.savedAt : null,
      summary: {
        members: roster.length,
        maxLevel: roster.reduce((m, c) => Math.max(m, Number(c && c.level) || 0), 0),
        clearedDungeons: Array.isArray(data.clearedDungeons) ? data.clearedDungeons.length : 0,
        material: typeof data.material === "number" ? data.material : 0,
      },
    };
  }

  const exported = { SCHEMA_VERSION, createState, serialize, deserialize, prepareRestore };
  root.QPModel = root.QPModel || {};
  root.QPModel.save = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);

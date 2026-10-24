// 仲間一覧（パーティ編成の「控え」・仲間と別れる）の絞り込み・並び替え。
// 画面内の一時的な表示条件だけを扱い、ロスターの配列・キャラのデータは変更しない（セーブ項目も増やさない）。
//   kind:  "all" | "human" | "monster"
//   group: ジョブID（人間）または種族ID（モンスター）。"all" なら絞り込まない
//   favoriteOnly: true ならお気に入り（★）だけ
//   sort:  "level"（Lvの高い順）| "levelAsc"（Lvの低い順）| "job"（ジョブ・種族ごと）| "newest"（仲間にした新しい順）| "oldest"
(function (root) {
  "use strict";
  const KINDS = Object.freeze(["all", "human", "monster"]);
  const SORTS = Object.freeze(["level", "levelAsc", "job", "newest", "oldest"]);

  function kindOf(c) { return c && c.isMonster ? "monster" : "human"; }
  // 人間はジョブ、モンスターは種族でまとめる（モンスターのジョブ＝種族のため）
  function groupKey(c) { return c ? (c.isMonster ? "m:" + c.race : "j:" + c.job) : ""; }
  // キャラIDは "c" + 通し番号。番号が大きいほど新しく仲間になった
  function seqOf(c) {
    const m = /^c(\d+)$/.exec(String(c && c.id));
    return m ? Number(m[1]) : -1;
  }

  function matches(c, opts) {
    const o = opts || {};
    const kind = o.kind || "all";
    if (!KINDS.includes(kind)) throw new RangeError("Unknown roster kind: " + kind);
    if (kind !== "all" && kindOf(c) !== kind) return false;
    if (o.group && o.group !== "all" && groupKey(c) !== o.group) return false;
    if (o.favoriteOnly && !c.favorite) return false;
    return true;
  }

  function filter(chars, opts) {
    return chars.filter((c) => matches(c, opts));
  }

  // label(c): ジョブ・種族の表示名（"job" 並びの名前順に使う）。元の配列は並べ替えない
  function sort(chars, mode, label) {
    if (!SORTS.includes(mode)) throw new RangeError("Unknown roster sort: " + mode);
    const nameOf = label || (() => "");
    const metrics = chars.map((c, index) => ({
      c, index, level: Number(c.level) || 0, seq: seqOf(c),
      kind: kindOf(c) === "human" ? 0 : 1, group: String(nameOf(c) || ""),
    }));
    metrics.sort((a, b) => {
      let primary = 0;
      if (mode === "level") primary = b.level - a.level;
      else if (mode === "levelAsc") primary = a.level - b.level;
      else if (mode === "newest") primary = b.seq - a.seq;
      else if (mode === "oldest") primary = a.seq - b.seq;
      else primary = a.kind - b.kind || a.group.localeCompare(b.group, "ja") || b.level - a.level;
      return primary || a.index - b.index;
    });
    return metrics.map((m) => m.c);
  }

  // 絞り込みの選択肢: 今いる仲間のジョブ・種族だけを出す（空の選択肢を作らない）
  function groupOptions(chars, kind, label) {
    const nameOf = label || ((c) => groupKey(c));
    const seen = new Map();
    for (const c of chars) {
      if (kind && kind !== "all" && kindOf(c) !== kind) continue;
      const key = groupKey(c);
      if (!seen.has(key)) seen.set(key, { key, name: String(nameOf(c) || key), kind: kindOf(c), count: 0 });
      seen.get(key).count += 1;
    }
    return [...seen.values()].sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "human" ? -1 : 1) || a.name.localeCompare(b.name, "ja"));
  }

  const api = { KINDS, SORTS, kindOf, groupKey, seqOf, matches, filter, sort, groupOptions };
  root.QPCore = root.QPCore || {};
  root.QPCore.rosterOrganize = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

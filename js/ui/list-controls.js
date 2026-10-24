// ---------- 一覧の絞り込み・並び替えの部品（パーティ編成の控え・仲間と別れる・装備強化で共通） ----------
// js/ui/ の各ファイルと js/game.js は同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する。
// ここは party.js より前に読み込む。表示条件は各画面の一時状態で、セーブデータには入れない。
"use strict";

// 小さなプルダウン（iPhoneでは標準の選択ピッカーが開く）。options: [[値, 表示名], ...]
function buildFilterSelect(name, options, current, onChange) {
  const label = document.createElement("label");
  label.className = "list-filter-select-label";
  const caption = document.createElement("span");
  caption.className = "list-filter-caption";
  caption.textContent = name;
  label.appendChild(caption);
  const select = document.createElement("select");
  select.className = "list-filter-select";
  select.setAttribute("aria-label", name);
  for (const [value, text] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  }
  select.value = current;
  select.addEventListener("change", (e) => {
    const value = e && e.target ? e.target.value : select.value;
    // 一覧にない値（古い選択肢など）は採用しない
    if (!options.some(([v]) => v === value)) return;
    onChange(value);
  });
  label.appendChild(select);
  return label;
}

// 切り替えチップ（選択中は古金色）。options: [[値, 表示名], ...]
function buildFilterChips(name, options, current, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "list-filter-chips";
  if (name) {
    const label = document.createElement("span");
    label.className = "disassemble-filter-label";
    label.textContent = name + ":";
    wrap.appendChild(label);
  }
  for (const [value, text] of options) {
    const chip = document.createElement("button");
    chip.className = "priority-chip inv-filter" + (current === value ? " tier-3" : "");
    chip.textContent = text;
    chip.setAttribute("aria-pressed", current === value ? "true" : "false");
    chip.addEventListener("click", () => onChange(value));
    wrap.appendChild(chip);
  }
  return wrap;
}

const ROSTER_SORT_OPTIONS = [
  ["level", "Lvが高い順"], ["levelAsc", "Lvが低い順"], ["job", "ジョブ・種族ごと"], ["newest", "新しい順"], ["oldest", "古い順"],
];
function newRosterListView() {
  return { kind: "all", group: "all", favoriteOnly: false, sort: "oldest" }; // 既定は従来どおり仲間にした順
}

// 仲間一覧の絞り込みバー。view（newRosterListView の形）を書き換えて onChange を呼ぶ。
// opts: { chars（選択肢を作る元の仲間）, showKind（人間／モンスターの切り替えを出すか）, showFavorite, onChange }
function buildRosterFilterBar(view, opts) {
  const org = QPCore.rosterOrganize;
  const bar = document.createElement("div");
  bar.className = "list-filter-bar";
  const change = (fn) => (value) => { fn(value); opts.onChange(); };

  if (opts.showKind) {
    const chipsLine = document.createElement("div");
    chipsLine.className = "list-filter-line";
    chipsLine.appendChild(buildFilterChips("種類", [["all", "すべて"], ["human", "人間"], ["monster", "モンスター"]], view.kind,
      change((v) => {
        view.kind = v;
        // 種類を変えたら、合わなくなったジョブ・種族の絞り込みは外す
        if (view.group !== "all" && v !== "all" && !view.group.startsWith(v === "monster" ? "m:" : "j:")) view.group = "all";
      })));
    bar.appendChild(chipsLine);
  }

  const selectLine = document.createElement("div");
  selectLine.className = "list-filter-line";
  const groups = org.groupOptions(opts.chars, view.kind, (c) => jobDef(c).name);
  if (view.group !== "all" && !groups.some((g) => g.key === view.group)) view.group = "all"; // 該当者がいなくなった
  selectLine.appendChild(buildFilterSelect("ジョブ・種族",
    [["all", "すべて"], ...groups.map((g) => [g.key, `${g.kind === "monster" ? "🐾" : ""}${g.name}（${g.count}）`])],
    view.group, change((v) => { view.group = v; })));
  selectLine.appendChild(buildFilterSelect("並び順", ROSTER_SORT_OPTIONS, view.sort, change((v) => { view.sort = v; })));
  if (opts.showFavorite !== false) {
    const fav = document.createElement("button");
    fav.className = "priority-chip inv-filter list-filter-fav" + (view.favoriteOnly ? " tier-3" : "");
    fav.textContent = "★のみ";
    fav.setAttribute("aria-pressed", view.favoriteOnly ? "true" : "false");
    fav.addEventListener("click", change(() => { view.favoriteOnly = !view.favoriteOnly; }));
    selectLine.appendChild(fav);
  }
  bar.appendChild(selectLine);
  return bar;
}

// view の条件で絞り込み・並び替えた仲間を返す（元の配列は変えない）
function applyRosterListView(chars, view) {
  const org = QPCore.rosterOrganize;
  return org.sort(org.filter(chars, view), view.sort, (c) => jobDef(c).name);
}

function rosterListViewActive(view) {
  return view.kind !== "all" || view.group !== "all" || view.favoriteOnly;
}

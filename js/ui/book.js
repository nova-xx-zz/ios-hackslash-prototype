// ---------- 画面: 冒険者の書（書物） ----------
// 探索画面の下の「書物」から開く。目次から各項目へ進み、「もどる」で1つ前のページに戻る（目次では探索画面へ）。
//   冒険の手引き … 遊び方の説明（BOOK_GUIDE）
//   モンスター辞典 … すべてのモンスター（出会ったことのある敵）と、ダンジョンごとに出会った敵（S.records.dungeonEncounters）。
//                    地方ごとにダンジョンを並べ、レア敵には★レアの印を付ける
//   アイテム辞典 … 手に入れた装備の種類とレア度（S.records.itemsFound。自動分解した物も含む）
//   種族辞典・ジョブ辞典 … 種族とジョブの説明・能力値の傾向・特性・アビリティ
//   冒険の記録 … ダンジョンに潜った履歴（S.records.runHistory。新しい順に最大50件）
// 記録そのものは js/model/records.js（メインセーブに入るので、クラウドセーブにも残る）
"use strict";

const BOOK_ICONS = {
  guide: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h10M9 8h5M9 11h5"/>',
  monsters: '<path d="M6 3c2.5 3 3.5 7 3 12M11 2.5c2 3.5 2.5 8 1 13M16 4c1.5 3 1.5 7-.5 10.5"/><path d="M4 20c3-1.5 6-2 8-2s5 .5 8 2"/>',
  items: '<path d="M3 11h18v9H3Z"/><path d="M3 11a9 6 0 0 1 18 0M10 14h4v3h-4ZM3 15h7m4 0h7"/>',
  races: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
  jobs: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="M12 7v10M8 11h8"/>',
  history: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2Z"/><path d="M9 4v14M15 6v14"/>',
  dungeon: '<path d="M5 21V11a7 7 0 0 1 14 0v10M9 21v-6h6v6M3 21h18"/>',
  all: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
};
function bookIcon(name) {
  return `<svg class="book-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BOOK_ICONS[name] || BOOK_ICONS.guide}</svg>`;
}

// 冒険の手引き（遊び方）。数値はゲームの設定（data.js）と合わせて書く
const BOOK_GUIDE = [
  { title: "ゲームについて", body: [
    "仲間を集めてパーティを作り、ダンジョンへ送り出して強くしていくハクスラRPGです。戦闘はすべて自動で進みます。",
    "ダンジョンを踏破すると次のダンジョンが解放されます。仲間を育て、装備を集めて、奥のダンジョンを目指しましょう。",
  ] },
  { title: "パーティと編成", body: [
    "パーティは第一〜第四の4つ。1つのパーティには5人まで入れられます。4つのパーティは同時に別々のダンジョンを探索できます。",
    "編成画面でメンバーを長押しして動かすと、別のパーティや控えに移せます。仲間は「仲間を探す」から増やせます。",
    "探索中・自動周回中のパーティは、編成・装備・スキル・転職などを変更できません。",
  ] },
  { title: "種族とジョブ", body: [
    "キャラの能力値は「種族」と「ジョブ」の組み合わせで決まります。種族ごとに会心率アップや被ダメージ軽減などの特性もあります。",
    "ジョブはキャラ詳細の「ジョブ」から、いつでも切り替えられます。ジョブごとにレベルを持っていて、戻ればそのレベルから再開できます。",
    `基本職をLv.${JOB_MASTER_LEVEL}まで極めると、対応する上級職に転職できるようになります。`,
  ] },
  { title: "スキルとスキルツリー", body: [
    "使える技はジョブのレベルで増えていきます。スキルの画面で技のON/OFFと優先度（優先・通常・温存）を決めると、自動戦闘がそれに従って技を選びます。",
    "サブアビリティには、これまでに育てたことのあるジョブの技を入れられます。いろいろなジョブを育てるほど選べる技が増えます。",
    "レベルアップでSPを得て、スキルツリーで能力の強化や新しい技を習得できます。",
  ] },
  { title: "装備と強化", body: [
    "ダンジョンで見つけた装備は、踏破すると手に入ります。全滅すると、その周回で見つけた装備は持ち帰れません。",
    "装備の枠は、右手・左手・頭・体・装飾品の5か所です。装飾品は最初1枠で、スキルツリーの「装備の心得」「装備の極意」で3枠まで増えます（モンスターはLv20・Lv40で増えます）。",
    "ジョブによって持てる装備の種類が違います（まほうつかいは剣やよろいを持てない、など）。両手武器は強力ですが、持っている間は左手に何も付けられません。とうぞく・ぶとうか・けんごうなどの二刀流のジョブは、左手にも片手武器を持てます。",
    "装備はシリーズ（ブロンズ・アイアンなど）に分かれ、地方ごとに手に入るシリーズが変わります。同じシリーズを2・4・6個そろえて付けると、セット効果が付きます。",
    "地方ごとに29種類の「名のある装備」（◆）があります。★レアモンスターやボスがときどき落とし、ふつうの戦闘でもまれに手に入ります。能力値が高く、会心率や吸収などの特殊効果が付きます。",
    "☠の付いた装備は呪われています。とても強力ですが、被ダメージが増える・最大HPが減るなどのデメリットがあります。おまかせ装備では選ばれないので、付ける時は自分で選んでください。",
    "装備は強化石を使って強化できます。強化値が高いほど成功しにくくなります。",
    "所持品の「分解する」で、選んだ装備を強化石に変えられます。",
  ] },
  { title: "ハードとエクストラ", body: [
    "ダンジョンをノーマルで踏破すると「ハード」、ハードを踏破すると「エクストラ」に挑めるようになります。マップでダンジョンを選んで、モードを切り替えてください。",
    "ハードは推奨Lvが10、エクストラは25上がった強さの敵が出ます。EXPはハードで1.5倍、エクストラで2倍です。",
    "ハード・エクストラで手に入る装備は、レベルが上がるうえに「オプション効果」が付きます（ハードは1〜2個、エクストラは強い効果が2〜3個）。能力値アップ・会心率や吸収などの戦闘の効果のほか、パーティの獲得EXPや強化石が増える周回向けの効果もあります。",
  ] },
  { title: "地方とレアモンスター", body: [
    "ダンジョンは地方ごとに分かれています。地方の最後のダンジョンを踏破すると、次の地方へ進めるようになります。マップの上の地方の名前を押すと、地方を切り替えられます。",
    "奥のダンジョンで拾った装備ほど、装備のレベルが高く強くなります（装備のレベルは、拾ったダンジョンの推奨Lvです）。",
    "ダンジョンには、まれにそのダンジョンだけのレアモンスター（★）が現れます。強めですがEXPが多く、倒すとスーパーレア以上の装備を必ず落とします。",
  ] },
  { title: "探索と自動周回", body: [
    "探索画面の「マップ」からダンジョンを選んで出発します。ダンジョンでは何回か戦闘があり、最後はボスとの戦いです。",
    "道中では宝箱・罠・泉・石碑のできごとが起きることがあります。",
    "自動周回を使うと、同じダンジョンに決めた回数だけ自動で出発し続けます。全滅すると止まります。",
  ] },
  { title: "自動分解", body: [
    "探索画面右上の「自動分解」をONにすると、選んだレア度の装備は手に入れた時に強化石に変わります。",
    "自動分解の設定は全パーティ共通です。探索中・自動周回中のパーティがある間は変更できません。",
  ] },
  { title: "離れている間の進行", body: [
    "自動周回中にアプリを閉じると、次に開いた時に、離れていた時間（最大8時間）ぶんの周回の結果をまとめて受け取れます。",
    "結果を受け取ると自動周回はいったん止まります。続ける時は、もう一度「自動周回開始」を押してください。",
  ] },
  { title: "データの保存", body: [
    "進行は端末に自動で保存されます。クラウドにも自動でバックアップされ、端末のデータが消えた時はタイトルの「データ復元」で戻せます。",
    "ホーム画面に追加したアプリとSafariで開いたページは、別々のデータになります。",
  ] },
];

let bookStack = []; // 開いているページの順番（最後が今のページ）。各ページは { title, sub, render(body) }

function openBook() {
  bookStack = [bookRootPage()];
  renderBook();
  showScreen("screen-book");
}
function pushBookPage(page) {
  bookStack.push(page);
  renderBook();
  document.getElementById("bookBody").scrollTop = 0;
}
function renderBook() {
  const page = bookStack[bookStack.length - 1];
  document.getElementById("bookTitle").textContent = page.title;
  const sub = document.getElementById("bookSub");
  sub.textContent = page.sub || "";
  sub.classList.toggle("hidden", !page.sub);
  const body = document.getElementById("bookBody");
  body.innerHTML = "";
  page.render(body);
}
document.getElementById("btnBookBack").addEventListener("click", () => {
  if (bookStack.length > 1) { bookStack.pop(); renderBook(); return; }
  openExploreHub();
});

// 目次やリストの1行（アイコン・名前・右側の補足・＞）。onClick が無ければ押せない行
function bookRow(opts) {
  const row = document.createElement(opts.onClick ? "button" : "div");
  row.className = "book-row" + (opts.onClick ? "" : " disabled");
  row.innerHTML = `
    ${opts.iconHtml || ""}
    <span class="book-row-label"></span>
    <span class="book-row-meta"></span>
    ${opts.onClick ? '<span class="book-row-chev" aria-hidden="true">›</span>' : ""}`;
  row.querySelector(".book-row-label").textContent = opts.label;
  row.querySelector(".book-row-meta").textContent = opts.meta || "";
  if (opts.onClick) row.addEventListener("click", opts.onClick);
  return row;
}
function bookList(rows) {
  const list = document.createElement("div");
  list.className = "book-list";
  for (const r of rows) list.appendChild(r);
  return list;
}
function bookHeading(text) {
  const h = document.createElement("div");
  h.className = "book-heading";
  h.textContent = text;
  return h;
}
function bookParagraph(text, cls) {
  const p = document.createElement("p");
  p.className = "book-paragraph" + (cls ? " " + cls : "");
  p.textContent = text;
  return p;
}

// ---------- 目次 ----------
function bookRootPage() {
  return {
    title: "冒険者の書",
    sub: "ギルドに伝わる手引きと、これまでの冒険の記録",
    render(body) {
      const r = S.records;
      const playerRaces = PLAYER_RACE_IDS.length;
      body.appendChild(bookList([
        bookRow({ iconHtml: bookIcon("guide"), label: "冒険の手引き", onClick: () => pushBookPage(guideIndexPage()) }),
        bookRow({ iconHtml: bookIcon("monsters"), label: "モンスター辞典", meta: `${dexSeen.size}/${ENEMY_TEMPLATES.length}`, onClick: () => pushBookPage(monsterIndexPage()) }),
        bookRow({ iconHtml: bookIcon("items"), label: "アイテム辞典", meta: `${r.itemsFound.length}/${(ITEM_BASES.length + UNIQUE_ITEMS.length) * RARITIES.length}`, onClick: () => pushBookPage(itemDexPage()) }),
        bookRow({ iconHtml: bookIcon("races"), label: "種族辞典", meta: `${playerRaces}種族`, onClick: () => pushBookPage(raceIndexPage()) }),
        bookRow({ iconHtml: bookIcon("jobs"), label: "ジョブ辞典", meta: `${Object.keys(JOBS).length}職`, onClick: () => pushBookPage(jobIndexPage()) }),
        bookRow({ iconHtml: bookIcon("history"), label: "冒険の記録", meta: `${r.runHistory.length}件`, onClick: () => pushBookPage(historyPage()) }),
      ]));
    },
  };
}

// ---------- 冒険の手引き ----------
function guideIndexPage() {
  return {
    title: "冒険の手引き",
    render(body) {
      body.appendChild(bookList(BOOK_GUIDE.map((g) => bookRow({ label: g.title, onClick: () => pushBookPage(guideTopicPage(g)) }))));
    },
  };
}
function guideTopicPage(g) {
  return {
    title: g.title,
    render(body) {
      const box = document.createElement("div");
      box.className = "book-text";
      for (const line of g.body) box.appendChild(bookParagraph(line));
      body.appendChild(box);
    },
  };
}

// ---------- モンスター辞典 ----------
function dungeonMonsterKeys(d) {
  return [...new Set([...d.pool, d.boss, ...(d.rares || [])])];
}
function monsterIndexPage() {
  return {
    title: "モンスター辞典",
    sub: "ダンジョンを選ぶと、そこで出会った魔物が見られます",
    render(body) {
      body.appendChild(bookList([
        bookRow({ iconHtml: bookIcon("all"), label: "すべてのモンスター", meta: `${dexSeen.size}/${ENEMY_TEMPLATES.length}`, onClick: () => pushBookPage(allMonstersPage()) }),
      ]));
      for (const region of REGIONS) {
        const dungeons = DUNGEONS.filter((d) => d.region === region.id);
        if (!dungeons.length) continue;
        const reached = dungeons.some((d) => isDungeonOpen(d));
        body.appendChild(bookHeading(reached ? region.name : "？？？地方"));
        body.appendChild(bookList(dungeons.map((d) => {
        if (!isDungeonOpen(d) && !S.clearedDungeons.has(d.id)) return bookRow({ iconHtml: bookIcon("dungeon"), label: "？？？", meta: "未到達" });
        const keys = dungeonMonsterKeys(d);
        const met = (S.records.dungeonEncounters[d.id] || []).filter((k) => keys.includes(k)).length;
        return bookRow({ iconHtml: bookIcon("dungeon"), label: d.name, meta: `${met}/${keys.length}`, onClick: () => pushBookPage(dungeonMonstersPage(d)) });
        })));
      }
    },
  };
}
function monsterGrid(keys, isSeen, bossKey) {
  const grid = document.createElement("div");
  grid.className = "dex-card-grid";
  for (const key of keys) {
    const t = getEnemyTemplate(key);
    if (!t) continue;
    const seen = isSeen(key);
    const card = document.createElement("button");
    card.className = "dex-card" + (seen ? "" : " locked") + (t.rare ? " rare" : "");
    const tag = key === bossKey ? "ボス" : t.rare ? "★レア" : "";
    card.innerHTML = seen
      ? `<div class="dex-card-icon">${t.icon || "❓"}</div>
         <div class="dex-card-name"></div>
         <div class="dex-card-element">${t.element}${tag ? "・" + tag : ""}</div>`
      : `<div class="dex-card-icon">❓</div>
         <div class="dex-card-name">？？？</div>
         <div class="dex-card-element">${tag || "&nbsp;"}</div>`;
    if (seen) {
      card.querySelector(".dex-card-name").textContent = t.name;
      card.addEventListener("click", () => openDexDetail(key));
    }
    grid.appendChild(card);
  }
  return grid;
}
function allMonstersPage() {
  return {
    title: "すべてのモンスター",
    sub: `出会った魔物 ${dexSeen.size} / ${ENEMY_TEMPLATES.length} 体`,
    render(body) { body.appendChild(monsterGrid(ENEMY_TEMPLATES.map((t) => t.key), (k) => dexSeen.has(k), null)); },
  };
}
function dungeonMonstersPage(d) {
  const keys = dungeonMonsterKeys(d);
  const met = new Set(S.records.dungeonEncounters[d.id] || []);
  return {
    title: d.name,
    sub: `このダンジョンで出会った魔物 ${keys.filter((k) => met.has(k)).length} / ${keys.length} 体`,
    render(body) {
      body.appendChild(bookParagraph(d.desc, "book-note"));
      body.appendChild(monsterGrid(keys, (k) => met.has(k), d.boss));
    },
  };
}

// ---------- アイテム辞典 ----------
// シリーズ（地方ごとの装備の系統）の一覧 → シリーズを開くと、その26種類とレア度ごとの入手状況・セット効果
function itemDexPage() {
  const found = new Set(S.records.itemsFound);
  const foundIn = (series) => ITEM_BASES.filter((b) => b.series === series.key)
    .reduce((n, b) => n + RARITIES.filter((r) => found.has(`${b.key}:${r.key}`)).length, 0);
  return {
    title: "アイテム辞典",
    sub: `手に入れた装備 ${found.size} / ${(ITEM_BASES.length + UNIQUE_ITEMS.length) * RARITIES.length} 種類（自動分解した物も含む）`,
    render(body) {
      body.appendChild(bookHeading("シリーズ"));
      body.appendChild(bookList(ITEM_SERIES.map((series) => {
        const total = ITEM_TYPES.length * RARITIES.length;
        const any = foundIn(series) > 0;
        return bookRow({
          label: any ? `${series.name}シリーズ` : "？？？",
          meta: `${foundIn(series)}/${total}`,
          onClick: () => pushBookPage(itemSeriesPage(series)),
        });
      })));
      body.appendChild(bookParagraph("シリーズは地方ごとに変わります。同じシリーズの装備を2・4・6個そろえて付けるとセット効果が付きます。", "book-note"));

      // 名のある装備（地方ごとに29種類）
      body.appendChild(bookHeading("名のある装備"));
      body.appendChild(bookList(REGIONS.map((region) => {
        const list = UNIQUE_ITEMS.filter((u) => u.region === region.id);
        const got = list.filter((u) => RARITIES.some((r) => found.has(`${u.key}:${r.key}`))).length;
        return bookRow({
          label: got > 0 || S.clearedDungeons.has(DUNGEONS.find((d) => d.region === region.id).id) ? `${region.name}の名のある装備` : "？？？",
          meta: `${got}/${list.length}`,
          onClick: () => pushBookPage(uniqueRegionPage(region)),
        });
      })));
      body.appendChild(bookParagraph("名のある装備（◆）は、★レアモンスターやボスがときどき落とします。☠は呪いの装備で、強い代わりにデメリットがあります。", "book-note"));
    },
  };
}

function uniqueRegionPage(region) {
  const found = new Set(S.records.itemsFound);
  const list = UNIQUE_ITEMS.filter((u) => u.region === region.id);
  return {
    title: `${region.name}の名のある装備`,
    sub: `手に入れた ${list.filter((u) => RARITIES.some((r) => found.has(`${u.key}:${r.key}`))).length} / ${list.length} 種類`,
    render(body) {
      const wrap = document.createElement("div");
      wrap.className = "book-list";
      for (const u of list) {
        const has = RARITIES.some((r) => found.has(`${u.key}:${r.key}`));
        const row = document.createElement("div");
        row.className = "book-unique-row" + (u.cursed ? " cursed" : "") + (has ? "" : " unknown");
        row.innerHTML = `<div class="book-unique-name"></div><div class="book-unique-effect"></div><div class="book-unique-flavor"></div>`;
        const typeText = `${u.typeName}${u.hands === 2 ? "・両手" : ""}`;
        row.querySelector(".book-unique-name").textContent = has ? `${u.cursed ? "☠" : "◆"}${u.name}（${typeText}）` : `？？？（${typeText}）`;
        row.querySelector(".book-unique-effect").textContent = has ? u.effect.desc : "";
        row.querySelector(".book-unique-flavor").textContent = has ? `「${u.flavor}」` : "";
        wrap.appendChild(row);
      }
      body.appendChild(wrap);
    },
  };
}

function itemSeriesPage(series) {
  const found = new Set(S.records.itemsFound);
  const bases = ITEM_BASES.filter((b) => b.series === series.key);
  const anySeries = bases.some((b) => RARITIES.some((r) => found.has(`${b.key}:${r.key}`)));
  return {
    title: anySeries ? `${series.name}シリーズ` : "？？？",
    sub: `推奨Lv${series.minLevel}〜のダンジョンで手に入る`,
    render(body) {
      body.appendChild(bookHeading("セット効果"));
      body.appendChild(bookParagraph(series.setBonus.map((b) => `${b.count}個: ${b.desc}`).join(" ／ ")));
      for (const slot of SLOTS) {
        const list = document.createElement("div");
        list.className = "book-list";
        for (const base of bases.filter((b) => b.slot === slot.key)) {
          const row = document.createElement("div");
          row.className = "book-item-row";
          const anyFound = RARITIES.some((r) => found.has(`${base.key}:${r.key}`));
          const name = document.createElement("div");
          name.className = "book-item-name";
          const statNames = Object.keys(base.stats).map((k) => STAT_LABELS[k]).join("・");
          name.textContent = anyFound
            ? `${SLOT_ICONS[base.slot] || ""} ${base.name}（${base.typeName}${base.hands === 2 ? "・両手" : ""}／${statNames}）`
            : `？？？（${base.typeName}）`;
          row.appendChild(name);
          const chips = document.createElement("div");
          chips.className = "book-item-rarities";
          for (const r of RARITIES) {
            const has = found.has(`${base.key}:${r.key}`);
            const chip = document.createElement("span");
            chip.className = "book-rarity-chip" + (has ? " found" : "");
            chip.textContent = r.key.toUpperCase();
            chip.title = has ? `${r.name}の${base.name}` : "まだ手に入れていない";
            if (has) { chip.style.background = r.color; chip.style.color = "#171a1a"; }
            chips.appendChild(chip);
          }
          row.appendChild(chips);
          list.appendChild(row);
        }
        if (!list.children.length) continue;
        body.appendChild(bookHeading(slot.name));
        body.appendChild(list);
      }
      body.appendChild(bookParagraph("色の付いたレア度が、これまでに手に入れたものです。", "book-note"));
    },
  };
}

// ---------- 種族辞典 ----------
function starRow(label, stars, max) {
  return `<div class="pm-stat-row"><span class="pm-stat-label">${label}</span><span class="pm-stat-stars">${starBar(stars, max)}</span></div>`;
}
function raceIndexPage() {
  return {
    title: "種族辞典",
    render(body) {
      body.appendChild(bookList(PLAYER_RACE_IDS.map((id) => {
        const race = RACES[id];
        const count = S.roster.filter((c) => c.race === id).length;
        return bookRow({
          iconHtml: `<span class="book-emoji" aria-hidden="true">${race.icon || "👤"}</span>`,
          label: race.name, meta: count ? `なかま ${count}人` : "",
          onClick: () => pushBookPage(racePage(id)),
        });
      })));
    },
  };
}
function racePage(id) {
  const race = RACES[id];
  return {
    title: race.name,
    render(body) {
      const MAX = 5;
      const stars = raceStatStars(race, MAX);
      const passives = Object.keys(race.passive).map((k) => PASSIVE_LABELS[k](race.passive[k]));
      if (race.expMult !== 1) passives.push(`獲得経験値 ${Math.round((race.expMult - 1) * 100)}%`);
      const box = document.createElement("div");
      box.className = "book-detail";
      box.innerHTML = `
        <div class="book-detail-icon book-emoji-lg">${race.icon || "👤"}</div>
        <p class="book-paragraph"></p>
        <div class="book-heading">能力値の傾向</div>
        <div class="pm-stats">${Object.keys(STAT_LABELS).map((k) => starRow(STAT_LABELS[k], stars[k], MAX)).join("")}</div>
        <div class="book-heading">種族特性</div>
        <p class="book-paragraph">${passives.length ? passives.join(" / ") : "特性なし"}</p>`;
      box.querySelector(".book-paragraph").textContent = race.desc;
      body.appendChild(box);
    },
  };
}

// ---------- ジョブ辞典 ----------
function jobIndexPage() {
  return {
    title: "ジョブ辞典",
    render(body) {
      const row = (id) => {
        const job = JOBS[id];
        const trained = S.roster.filter((c) => c.jobLevels && c.jobLevels[id]).length;
        return bookRow({
          iconHtml: `<span class="book-insignia">${jobInsignia(id)}</span>`,
          label: job.name, meta: trained ? `経験者 ${trained}人` : "",
          onClick: () => pushBookPage(jobPage(id)),
        });
      };
      body.appendChild(bookHeading("基本職"));
      body.appendChild(bookList(BASIC_JOB_IDS.map(row)));
      body.appendChild(bookHeading(`上級職（対応する基本職をLv.${JOB_MASTER_LEVEL}まで極めると転職できる）`));
      body.appendChild(bookList(Object.keys(JOBS).filter((id) => JOBS[id].tier !== "basic").map(row)));
    },
  };
}
function jobPage(id) {
  const job = JOBS[id];
  return {
    title: job.name,
    render(body) {
      const MAX = 5;
      const stars = jobStatStars(job, MAX);
      const box = document.createElement("div");
      box.className = "book-detail";
      box.innerHTML = `
        <div class="book-detail-icon book-insignia-lg">${jobInsignia(id)}</div>
        <p class="book-paragraph book-desc"></p>
        ${job.requires ? `<p class="book-paragraph book-note">転職の条件: ${JOBS[job.requires.job].name} Lv.${job.requires.level}</p>` : ""}
        <div class="book-heading">能力値の傾向</div>
        <div class="pm-stats">${Object.keys(STAT_LABELS).map((k) => starRow(STAT_LABELS[k], stars[k], MAX)).join("")}</div>
        <div class="book-heading">アビリティ</div>
        <div class="book-abilities"></div>`;
      box.querySelector(".book-desc").textContent = job.desc;
      const list = box.querySelector(".book-abilities");
      for (const a of job.abilities) {
        const row = document.createElement("div");
        row.className = "pm-ability-row";
        row.innerHTML = `<div class="pm-ability-name"></div><div class="pm-ability-desc"></div>`;
        row.querySelector(".pm-ability-name").innerHTML = `${a.name}<span class="pm-ability-lv">Lv.${a.reqLevel}</span>`;
        row.querySelector(".pm-ability-desc").textContent = a.desc;
        list.appendChild(row);
      }
      body.appendChild(box);
    },
  };
}

// ---------- 冒険の記録 ----------
function historyPage() {
  const list = S.records.runHistory;
  const clears = list.reduce((n, e) => n + (e.offline ? e.clears || 0 : e.cleared ? 1 : 0), 0);
  return {
    title: "冒険の記録",
    sub: list.length ? `新しい順に最大${QPModel.records.RUN_HISTORY_MAX}件　（この中の踏破 ${clears}回）` : "",
    render(body) {
      if (!list.length) {
        body.appendChild(bookParagraph("まだ記録がありません。ダンジョンに潜ると、ここに記録が残ります。", "book-note"));
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "book-history";
      for (const e of list) wrap.appendChild(historyEntry(e));
      body.appendChild(wrap);
    },
  };
}
function historyEntry(e) {
  const d = getDungeon(e.dungeonId);
  const card = document.createElement("div");
  card.className = "book-history-entry " + (e.cleared ? "cleared" : "wiped");
  const when = new Date(e.at);
  const p = (n) => String(n).padStart(2, "0");
  const date = isNaN(when) ? "" : `${when.getMonth() + 1}/${when.getDate()} ${p(when.getHours())}:${p(when.getMinutes())}`;
  let result;
  if (e.offline) result = `離れている間に ${e.runs}周（踏破 ${e.clears}回${e.cleared ? "" : "・全滅で停止"}）`;
  else result = e.cleared ? "踏破" : `全滅（${(e.battlesWon || 0) + 1}/${e.battles}戦目）`;
  const details = [`EXP +${e.exp || 0}`];
  if (e.items) details.push(`アイテム ${e.items}個`);
  if (e.disassembled) details.push(`自動分解 ${e.disassembled}個（強化石+${e.material || 0}）`);
  if (e.tamed) details.push(`テイム: ${e.tamed}`);
  card.innerHTML = `
    <div class="bhe-top"><span class="bhe-date"></span><span class="bhe-team"></span></div>
    <div class="bhe-main"><span class="bhe-dungeon"></span><span class="bhe-result"></span></div>
    <div class="bhe-details"></div>`;
  card.querySelector(".bhe-date").textContent = date;
  card.querySelector(".bhe-team").textContent = TEAM_NAMES[e.team] || "";
  const modeText = e.mode && e.mode !== "normal" ? `（${getDungeonMode(e.mode).name}）` : "";
  card.querySelector(".bhe-dungeon").textContent = (d ? d.name : e.dungeonId) + modeText;
  card.querySelector(".bhe-result").textContent = result;
  card.querySelector(".bhe-details").textContent = details.join("　");
  return card;
}

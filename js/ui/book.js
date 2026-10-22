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

// 章・記事の本文は book-guide-content.js で管理する。旧 BOOK_GUIDE は廃止。
const BOOK_PROTO_HIDDEN_TOPICS = new Set(["BKG-024", "BKG-025"]); // 正式版の認証・実決済は試作版にはない
function visibleBookGuideTopics() {
  return BOOK_GUIDE_CONTENT.topics.filter((topic) => !BOOK_PROTO_HIDDEN_TOPICS.has(topic.id));
}
function bookGuideById(id) {
  return visibleBookGuideTopics().find((topic) => topic.id === id) || null;
}

let bookStack = []; // 開いているページの順番（最後が今のページ）。各ページは { title, sub, render(body) }

function openBook() {
  bookStack = [bookRootPage()];
  renderBook();
  showScreen("screen-book");
}
function pushBookPage(page) {
  const body = document.getElementById("bookBody");
  bookStack[bookStack.length - 1].scrollTop = body.scrollTop;
  bookStack.push(page);
  renderBook();
  body.scrollTop = 0;
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
  if (bookStack.length > 1) {
    bookStack.pop();
    renderBook();
    document.getElementById("bookBody").scrollTop = bookStack[bookStack.length - 1].scrollTop || 0;
    return;
  }
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

// ---------- 冒険の手引き（章 → 記事） ----------
function guideIndexPage() {
  return {
    title: "冒険の手引き",
    sub: "知りたい章を選んでください",
    render(body) {
      const visible = visibleBookGuideTopics();
      body.appendChild(bookList(BOOK_GUIDE_CONTENT.chapters.map((chapter) => {
        const count = visible.filter((topic) => topic.chapterId === chapter.id).length;
        return bookRow({
          iconHtml: bookIcon("guide"),
          label: chapter.title,
          meta: count + "項目",
          onClick: () => pushBookPage(guideChapterPage(chapter)),
        });
      })));
    },
  };
}
function guideChapterPage(chapter) {
  return {
    title: chapter.title,
    render(body) {
      const topics = visibleBookGuideTopics().filter((topic) => topic.chapterId === chapter.id);
      body.appendChild(bookList(topics.map((topic) => bookRow({
        label: topic.title,
        onClick: () => pushBookPage(guideTopicPage(topic)),
      }))));
    },
  };
}
function guideTopicPage(topic) {
  return {
    title: topic.title,
    sub: topic.summary,
    render(body) {
      const box = document.createElement("div");
      box.className = "book-text";
      const lines = topic.id === "BKG-026"
        ? topic.body.map((line) => line.includes("別の端末で続きから遊べません")
          ? "**Q. 別の端末で続きから遊べません。**\nA. タイトル画面の「データ復元」と「データの保存」の説明を確認してください。" : line)
        : topic.body;
      for (const line of lines) {
        const warning = /^(?:\*\*)?(?:注意：|全滅すると)/.test(line);
        const paragraph = bookParagraph(line.replace(/\*\*/g, ""), warning ? "book-guide-warning" : "");
        if (/^\*\*Q\./.test(line)) paragraph.classList.add("book-guide-faq");
        box.appendChild(paragraph);
      }
      body.appendChild(box);
      const related = topic.related.map(bookGuideById).filter(Boolean);
      if (related.length) {
        body.appendChild(bookHeading("関連する項目"));
        body.appendChild(bookList(related.map((entry) => bookRow({
          label: entry.title, onClick: () => pushBookPage(guideTopicPage(entry)),
        }))));
      }
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
    // 魔物の絵（絵文字）は出さず、名前と属性だけにする
    const tameTag = seen && t.tamable ? "・テイム可" : "";
    card.innerHTML = seen
      ? `<div class="dex-card-name"></div>
         <div class="dex-card-element">${t.element}${tag ? "・" + tag : ""}${tameTag}</div>`
      : `<div class="dex-card-name">？？？</div>
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
      body.appendChild(bookList(Object.keys(JOBS).filter((id) => JOBS[id].tier === "advanced").map(row)));
      const specialIds = SPECIAL_JOB_IDS.filter(jobUsable);
      if (specialIds.length) {
        body.appendChild(bookHeading("特殊職（テスト中）"));
        body.appendChild(bookList(specialIds.map(row)));
      }
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
        ${job.tier === "special" ? `<p class="book-paragraph book-note">転職の条件: ${specialJobUnlockText(job)}</p>` : ""}
        ${job.soloBonus ? `<p class="book-paragraph book-note">ひとり旅の加護: チームがこのジョブ1人だけのとき ATK+${Math.round(job.soloBonus.atkPct * 100)}%・受けるダメージ−${Math.round((1 - job.soloBonus.dmgTakenMult) * 100)}%</p>` : ""}
        <div class="book-heading">能力値の傾向</div>
        <div class="pm-stats">${Object.keys(STAT_LABELS).map((k) => starRow(STAT_LABELS[k], stars[k], MAX)).join("")}</div>
        <div class="book-heading">アビリティ</div>
        <div class="book-abilities"></div>`;
      box.querySelector(".book-desc").textContent = job.desc;
      const list = box.querySelector(".book-abilities");
      for (const a of [...job.abilities, ...(job.explorationSkills || [])]) {
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

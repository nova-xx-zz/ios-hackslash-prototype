#!/usr/bin/env node
"use strict";
// 抽選用のローカルツール。応募リストは GitHub にコミットせず、端末内でのみ扱う。
const fs = require("node:fs");
const crypto = require("node:crypto");

function parseHandles(text) {
  const seen = new Set();
  const handles = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    if (!/^@?[A-Za-z0-9_]{1,15}$/.test(line)) {
      throw new Error(`行 ${i + 1}: Xのユーザー名形式ではありません。1行1アカウントのみ記載してください`);
    }
    const normalized = line.replace(/^@/, "").toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    handles.push("@" + normalized);
  });
  return handles;
}

function draw(handles, slots, randomInt = crypto.randomInt) {
  if (!Array.isArray(handles) || !Number.isSafeInteger(slots) || slots < 1 || slots > handles.length) {
    throw new Error("当選枠は応募者数以下の正の整数を指定してください");
  }
  const pool = [...handles];
  // Fisher-Yatesの部分シャッフル。crypto.randomIntは偏りのない安全な乱数を使う。
  for (let i = 0; i < pool.length - 1; i++) {
    const index = i + randomInt(pool.length - i);
    [pool[i], pool[index]] = [pool[index], pool[i]];
  }
  return { winners: pool.slice(0, slots), waitlist: pool.slice(slots), ranking: pool };
}

function run(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || !/^[1-9]\d*$/.test(argv[1])) {
    throw new Error("使用方法: node tools/beta-lottery.js <応募者リスト.txt> <当選人数>");
  }
  const slots = Number(argv[1]);
  if (!Number.isSafeInteger(slots) || slots > 30) {
    throw new Error("当選枠の上限は30です。初回は10枠程度を推奨します");
  }
  const handles = parseHandles(fs.readFileSync(argv[0], "utf8"));
  const { winners, waitlist } = draw(handles, slots);
  const inputHash = crypto.createHash("sha256").update([...handles].sort().join("\n")).digest("hex");
  const out = [
    "ソードクレストβテスター抽選（このログは非公開で保管）",
    "日時UTC: " + new Date().toISOString(),
    "抽選方式: Node.js crypto.randomInt / Fisher-Yates",
    "応募者数（Xユーザー名重複除外）: " + handles.length,
    "応募リストSHA-256（ソート済み正規化ハンドル）: " + inputHash,
    "当選者（応募人数以下・1人1アカウントを事前に確認）:"
  ];
  winners.forEach((name, i) => out.push(`${i + 1}. ${name}`));
  out.push("補欠順位:");
  waitlist.forEach((name, i) => out.push(`${i + 1}. ${name}`));
  return out.join("\n");
}

if (require.main === module) {
  try {
    process.stdout.write(run() + "\n");
  } catch (e) {
    process.stderr.write("抽選エラー: " + e.message + "\n");
    process.exitCode = 1;
  }
}
module.exports = { parseHandles, draw, run };

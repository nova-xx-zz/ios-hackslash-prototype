// ---------- 画面: 状態・端末保存・設定（定数、端末への保存の窓口、ゲームの状態 S、保存失敗の警告、自動分解・図鑑の設定） ----------
// js/ui/ の各ファイルと js/game.js は、元は1つの game.js だったものを画面ごとに分けたもの。
// 同じ順番で <script> として読み込み、トップレベルの関数・変数を共有する（index.html の読み込み順を変えないこと）。
"use strict";

// 自動周回の回数（x100はショップで買うと選べる。js/data.js の AUTO_REPEAT_CHOICES）
const AUTO_REPEAT_OPTIONS = AUTO_REPEAT_CHOICES.map((c) => c.n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MAX_ACTIVE = 5;

// 取り消せない操作の2回押し: 1回目で確認の状態に入り（armConfirm）、2回目で確定する。
// 確認のボタンは1回目と同じ位置に出るので、ダブルタップ1回（2回のクリックになる）で素通りしないよう、
// 確認に入ってから CONFIRM_GUARD_MS 以内の2回目は無視する（confirmReady が false）
const CONFIRM_GUARD_MS = 500;
let confirmArmedAt = -Infinity;
function armConfirm() { confirmArmedAt = Date.now(); }
function confirmReady() { return Date.now() - confirmArmedAt >= CONFIRM_GUARD_MS; }

// プレイヤーが入力した文字（仲間の名前など）を innerHTML に入れる時は、必ずこれを通す
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
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

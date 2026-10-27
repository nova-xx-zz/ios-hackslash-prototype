// ---------- 画面: 設定（クラウドセーブ） ----------
// クラウドセーブの状態の表示と、「今すぐバックアップ」「クラウドから復元」。通信は js/cloud.js（QPCloud）
"use strict";

const CLOUD_STATUS_LABELS = { off: "未接続", connecting: "接続中…", ready: "有効", error: "停止中", disabled: "準備中（通信停止）" };
const CLOUD_DISABLED_MESSAGE = "クラウドバックアップは現在利用できません。端末への通常セーブは継続されます。";

function formatDateTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function showCloudMessage(text, isError) {
  const el = document.getElementById("cloudMessage");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
  el.classList.toggle("error", !!isError);
}

let cloudRestoreCandidate = null; // 2回押しで確定する復元の候補 { json, savedAt }
let selectedBackupId = null;
let cloudHistoryInitialized = false;

async function refreshCloudHistory() {
  if (!window.QPCloud || QPCloud.getState().status === "disabled" ||
      typeof QPCloud.listBackups !== "function") return;
  const manual = document.getElementById("cloudManualList");
  const automatic = document.getElementById("cloudAutoList");
  if (!manual || !automatic) return;
  try {
    const entries = await QPCloud.listBackups();
    const groups = [["manual", manual, "cloudManualCount"], ["auto", automatic, "cloudAutoCount"]];
    for (const [kind, container, counterId] of groups) {
      const list = entries.filter(e => e.kind === kind);
      container.replaceChildren();
      document.getElementById(counterId).textContent = "（" + list.length + "/5）";
      if (!list.length) {
        const empty = document.createElement("p");
        empty.className = "settings-note";
        empty.textContent = "保存履歴はありません";
        container.appendChild(empty);
      }
      for (const entry of list) {
        const row = document.createElement("div");
        row.className = "settings-backup-entry";
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "btn small ghost";
        choose.textContent = formatDateTime(entry.createdAt) + "（" +
          QPCore.saveDiagnostics.formatBytes(entry.bytes) + "）";
        choose.addEventListener("click", () => {
          resetCloudRestoreConfirm();
          selectedBackupId = entry.id;
          document.getElementById("btnCloudRestore").textContent = "選択した履歴を確認";
          showCloudMessage(formatDateTime(entry.createdAt) +
            " のバックアップを選択しました。「選択した履歴を確認」を押してください。", false);
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn small ghost";
        del.textContent = "削除";
        del.setAttribute("aria-label", formatDateTime(entry.createdAt) + "のバックアップを削除");
        del.addEventListener("click", async () => {
          if (!confirm("このバックアップを削除しますか？操作は取り消せません。")) return;
          del.disabled = true;
          try {
            await QPCloud.deleteBackup(entry.id);
            if (selectedBackupId === entry.id) {
              selectedBackupId = null;
              resetCloudRestoreConfirm();
            }
            showCloudMessage("バックアップを削除しました", false);
            await refreshCloudHistory();
          } catch(e) {
            showCloudMessage(e.message || "削除できませんでした", true);
            del.disabled = false;
          }
        });
        row.appendChild(choose);
        row.appendChild(del);
        container.appendChild(row);
      }
    }
  } catch(e) {
    showCloudMessage(e.message || "履歴の取得に失敗しました", true);
  }
}


function renderCloudState(st) {
  document.getElementById("cloudStatus").textContent = CLOUD_STATUS_LABELS[st.status] || "—";
  document.getElementById("cloudLastUpload").textContent = formatDateTime(st.lastUploadAt);
  document.getElementById("cloudUid").textContent = st.uid || "—";
  const disabled = st.status === "disabled";
  const busy = st.status === "connecting" || disabled;
  document.getElementById("btnCloudBackup").disabled = busy;
  document.getElementById("btnCloudRestore").disabled = busy;
  const refresh = document.getElementById("btnCloudRefresh");
  if (refresh) refresh.disabled = busy;
  if (disabled) {
    showCloudMessage(CLOUD_DISABLED_MESSAGE, false);
  } else if (st.error && !cloudRestoreCandidate) {
    showCloudMessage(st.error, true);
  }
  if (st.status === "ready" && !cloudHistoryInitialized) {
    cloudHistoryInitialized = true;
    refreshCloudHistory();
  }
}

function resetCloudRestoreConfirm() {
  cloudRestoreCandidate = null;
  document.getElementById("btnCloudRestore").textContent = "クラウドから復元";
}

if (window.QPCloud) {
  QPCloud.subscribe(renderCloudState);

  document.getElementById("btnCloudBackup").addEventListener("click", async () => {
    resetCloudRestoreConfirm();
    showCloudMessage("バックアップしています…");
    const ok = await QPCloud.backupNow();
    const st = QPCloud.getState();
    if (ok) {
      showCloudMessage(`手動バックアップを保存しました（${formatDateTime(st.lastUploadAt)}）`);
      await refreshCloudHistory();
    }
    else showCloudMessage(st.error || "バックアップできませんでした", true);
  });

  // 1回目: クラウドのセーブの内容を見せる → 2回目: 端末のセーブを置き換えて読み込み直す（取り消せない）
  document.getElementById("btnCloudRestore").addEventListener("click", async () => {
    if (cloudRestoreCandidate) {
      if (!confirmReady()) return;
      const json = cloudRestoreCandidate.json;
      resetCloudRestoreConfirm();
      selectedBackupId = null;
      if (!restoreSaveFromCloud(json)) showCloudMessage("復元できませんでした（クラウドのセーブが壊れているか、端末に保存できません）", true);
      return;
    }
    showCloudMessage("クラウドのセーブを確認しています…");
    let cloud;
    try {
      cloud = await QPCloud.fetchCloudSave(selectedBackupId);
    } catch (e) {
      showCloudMessage(e.message, true);
      return;
    }
    const prepared = cloud && QPModel.save.prepareRestore(cloud.json);
    if (!prepared) { showCloudMessage(cloud ? "クラウドのセーブを読み込めませんでした" : "クラウドにセーブがありません", !!cloud); return; }
    const s = prepared.summary;
    const older = lastSavedAt && prepared.savedAt && prepared.savedAt < lastSavedAt;
    showCloudMessage(
      `クラウドのセーブ: ${formatDateTime(prepared.savedAt)}（なかま${s.members}人・最高Lv.${s.maxLevel}・踏破${s.clearedDungeons}か所・強化石${s.material}）\n` +
      (older ? "※ 今の端末の進行より古いセーブです。" : "") +
      "今の進行はこのセーブで置き換えられます（自動周回は止まった状態になります）。よければもう一度押してください。",
      false
    );
    cloudRestoreCandidate = { json: prepared.json };
    armConfirm();
    document.getElementById("btnCloudRestore").textContent = "本当に復元する（取り消せません）";
  });

  const refreshButton = document.getElementById("btnCloudRefresh");
  if (refreshButton) refreshButton.addEventListener("click", refreshCloudHistory);

  // 設定画面を離れたら、復元の確認は取り消す
  document.getElementById("btnSettingsBack").addEventListener("click", () => {
    selectedBackupId = null;
    resetCloudRestoreConfirm();
    showCloudMessage("");
  });
} else {
  document.querySelector("#screen-settings .settings-cloud").classList.add("hidden");
}

/**
 * iPhoneでも端末の既存セーブサイズを確認できる非破壊診断。
 * navigator.storage.estimate はオリジン全体の概算でありlocalStorageの
 * 空き容量・実際の書込成功を保証しない。データの書換・削除は行わない。
 */
async function inspectCurrentSaveStorage(){
  const button=document.getElementById("btnSaveStorageDiagnostics");
  const output=document.getElementById("saveStorageDiagnosticsResult");
  button.disabled=true;
  output.textContent="保存状況を読み取っています…";
  try {
    const json=store.getString(KEYS.save);
    let estimate=null,persisted=null,indexedDBAvailable=false;
    try {
      const s=window.navigator&&window.navigator.storage;
      if(s&&typeof s.estimate==="function")estimate=await s.estimate();
      if(s&&typeof s.persisted==="function")persisted=await s.persisted();
    }catch(e){ /* 容量API拒否の場合は「取得不可」と表示し、診断を継続 */ }
    try { indexedDBAvailable=!!window.indexedDB; }catch(e){ /* private-mode restricted */ }
    const diagnostic=QPCore.saveDiagnostics.analyze(json,{
      inventoryCount:S.inventory.length,estimate,persisted,indexedDBAvailable
    });
    const fmt=QPCore.saveDiagnostics.formatBytes;
    const cloudStatus=!diagnostic.saved?"判定不可（保存データなし）":
      diagnostic.utf8Bytes > 32*1024*1024?"新方式の32MiB上限を超過":
      "新方式のサイズ上限内（実際のバックアップ成功は未確認）";
    const stored=diagnostic.saved?
      `${fmt(diagnostic.utf8Bytes)} / ${diagnostic.characters.toLocaleString("ja-JP")}文字`:
      "端末に保存済みのゲームデータがありません";
    const capacity=diagnostic.originQuotaBytes===null?"取得不可":
      `${fmt(diagnostic.originUsageBytes)} 使用 / ${fmt(diagnostic.originQuotaBytes)} 見積上限`;
    const permanent=diagnostic.persisted===null?"取得不可":diagnostic.persisted?"許可あり":"許可なし・未確認";
    output.textContent=[
      "端末の保存済みセーブ: "+stored,
      "現在の未装備アイテム: "+S.inventory.length.toLocaleString("ja-JP")+"件",
      "クラウド保存: "+cloudStatus,
      "旧方式の送信目安: "+fmt(diagnostic.cloudLimitBytes)+"（旧Firestore単一文書）",
      "新方式の未圧縮上限: 32.00 MiB（圧縮率や通信成功は別途確認）",
      "ブラウザの保存領域（オリジン全体の参考値）: "+capacity,
      "永続保存の状態: "+permanent,
      "IndexedDB API: "+(diagnostic.indexedDBAvailable?"利用候補あり":"利用可否を確認できません"),
      "※容量上限はlocalStorage専用ではありません。iPhoneで実際に保存できる残量の保証ではありません。",
      "※診断は読み取り専用です。書き込み成功やクラウド同期完了は別途確認してください。"
    ].join("\n");
  } catch(e) {
    output.textContent="保存状況を取得できませんでした。既存のセーブは変更していません。";
  } finally {
    button.disabled=false;
  }
}
document.getElementById("btnSaveStorageDiagnostics").addEventListener("click",inspectCurrentSaveStorage);


// 明示的に操作した時だけ、現行セーブを別のIndexedDB領域へ複製して照合する。
// 読み込み元・通常の保存先・クラウド同期・ゲーム起動時の復元方法は変更しない。
async function createVerifiedSaveShadow(){
  const button=document.getElementById("btnSaveShadowCopy");
  const output=document.getElementById("saveShadowCopyResult");
  button.disabled=true;
  output.textContent="検証用コピーを書き込み、読み戻しています…";
  try {
    const original=store.getString(KEYS.save);
    const mirror=QPCore.saveMirror;
    const backend=mirror.createIndexedDBBackend(window.indexedDB);
    const summary=await mirror.copyVerified({
      json:original,backend,maxSchemaVersion:QPModel.save.SCHEMA_VERSION
    });
    const changed=store.getString(KEYS.save)!==original;
    output.textContent=[
      "検証用コピー: 保存・読み戻し・SHA-256照合が完了",
      "対象: "+summary.inventoryCount.toLocaleString("ja-JP")+"件の未装備品 / "+
        summary.rosterCount.toLocaleString("ja-JP")+"人の仲間",
      "容量: "+QPCore.saveDiagnostics.formatBytes(summary.utf8Bytes),
      changed?"※処理中に元のセーブが更新されました。コピーは開始時点の内容です。":
        "元のセーブ形式・保存場所は変更していません。",
      "※同じ端末のIndexedDBに置いた検証用コピーです。自動復元もクラウドバックアップも行いません。"
    ].join("\n");
  }catch(e){
    const quota=e&&e.name==="QuotaExceededError";
    output.textContent=quota?
      "検証用コピーの容量が不足しています。既存のlocalStorageセーブは変更していません。":
      "検証用コピーを完了できませんでした（IndexedDB非対応・アクセス拒否・内容不正など）。既存のセーブは変更していません。";
  }finally{
    button.disabled=false;
  }
}
document.getElementById("btnSaveShadowCopy").addEventListener("click",createVerifiedSaveShadow);


// v2保存方式のリハーサル。現行localStorage・旧IndexedDB検証コピーは変更しない。
async function verifySegmentedSaveCopy(){
  const button=document.getElementById("btnSegmentedSaveCopy");
  const output=document.getElementById("segmentedSaveCopyResult");
  button.disabled=true;
  output.textContent="分割コピーを作成し、全件の整合性を検証しています…";
  try{
    const json=store.getString(KEYS.save);
    const backend=QPCore.saveMirror.createIndexedDBBackend(window.indexedDB);
    const result=await QPCore.saveSegments.copyToIndexedDB(backend,json,{
      maxSchemaVersion:QPModel.save.SCHEMA_VERSION
    });
    output.textContent=[
      "分割コピーの照合が完了",
      "未装備品: "+result.manifest.inventoryCount.toLocaleString("ja-JP")+"件",
      "分割数: "+result.manifest.parts.length.toLocaleString("ja-JP")+"個",
      "UTF-8容量: "+QPCore.saveDiagnostics.formatBytes(result.manifest.totalBytes),
      "※旧セーブ・従来の保存機能・クラウドは変更していません。",
      "※自動復元は無効です。コピーは同一端末内にあり、実際のバックアップの代用にはなりません。"
    ].join("\n");
  }catch(e){
    output.textContent=e&&e.name==="QuotaExceededError"?
      "分割コピーの容量が不足しています。元のプレイデータは変更していません。":
      "分割コピーの検証に失敗しました。元のプレイデータは変更していません。";
  }finally{button.disabled=false;}
}
document.getElementById("btnSegmentedSaveCopy").addEventListener("click",verifySegmentedSaveCopy);

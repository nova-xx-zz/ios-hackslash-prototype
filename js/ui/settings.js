// ---------- 画面: 設定（クラウドセーブ） ----------
// クラウドセーブの状態の表示と、「今すぐバックアップ」「クラウドから復元」。通信は js/cloud.js（QPCloud）
"use strict";

const CLOUD_STATUS_LABELS = { off: "未接続", connecting: "接続中…", ready: "有効", error: "停止中" };

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

function renderCloudState(st) {
  document.getElementById("cloudStatus").textContent = CLOUD_STATUS_LABELS[st.status] || "—";
  document.getElementById("cloudLastUpload").textContent = formatDateTime(st.lastUploadAt);
  document.getElementById("cloudUid").textContent = st.uid || "—";
  const busy = st.status === "connecting";
  document.getElementById("btnCloudBackup").disabled = busy;
  document.getElementById("btnCloudRestore").disabled = busy;
  if (st.error && !cloudRestoreCandidate) showCloudMessage(st.error, true);
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
    if (ok) showCloudMessage(`バックアップしました（${formatDateTime(st.lastUploadAt)}）`);
    else showCloudMessage(st.error || "バックアップできませんでした", true);
  });

  // 1回目: クラウドのセーブの内容を見せる → 2回目: 端末のセーブを置き換えて読み込み直す（取り消せない）
  document.getElementById("btnCloudRestore").addEventListener("click", async () => {
    if (cloudRestoreCandidate) {
      const json = cloudRestoreCandidate.json;
      resetCloudRestoreConfirm();
      if (!restoreSaveFromCloud(json)) showCloudMessage("復元できませんでした（クラウドのセーブが壊れているか、端末に保存できません）", true);
      return;
    }
    showCloudMessage("クラウドのセーブを確認しています…");
    let cloud;
    try {
      cloud = await QPCloud.fetchCloudSave();
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
    document.getElementById("btnCloudRestore").textContent = "本当に復元する（取り消せません）";
  });

  // 設定画面を離れたら、復元の確認は取り消す
  document.getElementById("btnSettingsBack").addEventListener("click", () => { resetCloudRestoreConfirm(); showCloudMessage(""); });
} else {
  document.querySelector("#screen-settings .settings-cloud").classList.add("hidden");
}

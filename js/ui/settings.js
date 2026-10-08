// ---------- 画面: 設定（クラウドセーブ） ----------
// クラウドセーブの状態の表示と、「今すぐバックアップ」「クラウドから復元」。通信は js/cloud.js（QPCloud）
"use strict";

const CLOUD_STATUS_LABELS = { off: "未接続", connecting: "接続中…", ready: "有効", error: "停止中", "needs-login": "アカウント未連携", conflict: "セーブの選択が必要" };

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
  const prod = window.QPRuntime && QPRuntime.channel === "production";
  document.getElementById("btnCloudBackup").disabled = busy || (prod && st.status !== "ready");
  document.getElementById("btnCloudRestore").disabled = busy || (prod && (st.status === "needs-login" || !st.uid));
  if (prod) {
    document.getElementById("btnCloudConnect").classList.toggle("hidden", st.status !== "needs-login");
    document.getElementById("btnCloudPreferLocal").classList.toggle("hidden", st.status !== "conflict");
    document.getElementById("btnCloudLogout").classList.toggle("hidden", !st.uid);
    if (st.status !== "conflict") resetCloudLocalConfirm();
  }
  if (st.error && !cloudRestoreCandidate) showCloudMessage(st.error, true);
}

function resetCloudRestoreConfirm() {
  cloudRestoreCandidate = null;
  document.getElementById("btnCloudRestore").textContent = "クラウドから復元";
}

let cloudLocalConfirm = false;
function resetCloudLocalConfirm() {
  cloudLocalConfirm = false;
  const btn = document.getElementById("btnCloudPreferLocal");
  if (btn) btn.textContent = "この端末の進行を採用する";
}

if (window.QPCloud) {
  const prod = window.QPRuntime && QPRuntime.channel === "production";
  if (prod) {
    document.getElementById("cloudAccountActions").classList.remove("hidden");
    document.getElementById("cloudHelpText").textContent =
      "正式版のバックアップはGoogleで連携したアカウントに保存します。別の端末のセーブがある場合は自動上書きしません。端末の進行は連携前でも保存されます。";
    document.getElementById("btnCloudConnect").addEventListener("click", async () => {
      try { showCloudMessage("アカウントを連携しています…"); await QPCloud.connectGoogle(); showCloudMessage("連携しました。クラウドの進行をご確認ください。"); }
      catch (e) { showCloudMessage(e.message || "連携に失敗しました", true); }
    });
    document.getElementById("btnCloudLogout").addEventListener("click", async () => {
      resetCloudRestoreConfirm();resetCloudLocalConfirm();
      try { await QPCloud.disconnect(); showCloudMessage("クラウドアカウントからログアウトしました。端末の進行は残ります。"); }
      catch (e) { showCloudMessage(e.message || "ログアウトできませんでした", true); }
    });
    document.getElementById("btnCloudPreferLocal").addEventListener("click", async () => {
      resetCloudRestoreConfirm();
      if (!cloudLocalConfirm) {
        cloudLocalConfirm = true;armConfirm();
        document.getElementById("btnCloudPreferLocal").textContent = "本当にクラウドの進行を上書きする";
        showCloudMessage("クラウドの古い進行は失われます。別の端末で保存した内容を確認した上で、もう一度押してください。", true);
        return;
      }
      if (!confirmReady()) return;
      resetCloudLocalConfirm();
      try {
        const ok = await QPCloud.preferLocal();
        showCloudMessage(ok ? "この端末の進行をクラウドに保存しました。" : (QPCloud.getState().error || "上書きできませんでした"), !ok);
      } catch (e) { showCloudMessage(e.message || "同期に失敗しました", true); }
    });
  }
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
      if (!confirmReady()) return;
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
    armConfirm();
    document.getElementById("btnCloudRestore").textContent = "本当に復元する（取り消せません）";
  });

  // 設定画面を離れたら、復元の確認は取り消す
  document.getElementById("btnSettingsBack").addEventListener("click", () => { resetCloudRestoreConfirm(); resetCloudLocalConfirm(); showCloudMessage(""); });
} else {
  document.querySelector("#screen-settings .settings-cloud").classList.add("hidden");
}

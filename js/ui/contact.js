// Googleフォームの回答URLを、設定画面・探索画面に安全に表示する。
// URL/プレイヤーデータをFirestoreやセーブへ書き込まない。
(function (root) {
  "use strict";

  function normalizeGoogleFormUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return null;
    const text = value.trim();
    if (!text) return null;
    let url;
    try { url = new URL(text); } catch (_) { return null; }
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const formPath = /^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?$/;
    const shortPath = /^\/[A-Za-z0-9_-]+\/?$/;
    if (url.hostname === "docs.google.com" && formPath.test(url.pathname)) return url.href;
    if (url.hostname === "forms.gle" && shortPath.test(url.pathname)) return url.href;
    return null;
  }

  function setupContactLinks(doc, rawUrl) {
    const url = normalizeGoogleFormUrl(rawUrl);
    for (const id of ["contactSettingsLink", "contactExploreLink"]) {
      const el = doc.getElementById(id);
      if (!el) continue;
      if (url) {
        el.href = url;
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
        el.classList.remove("hidden");
      } else {
        el.removeAttribute("href");
        el.classList.add("hidden");
      }
    }
    const section = doc.getElementById("settingsContactSection");
    if (section) section.classList.toggle("hidden", !url);
    return Boolean(url);
  }

  const api = Object.freeze({ normalizeGoogleFormUrl, setupContactLinks });
  root.SCContact = api;
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root.document) setupContactLinks(root.document, root.SC_CONTACT_FORM_URL);
})(typeof globalThis !== "undefined" ? globalThis : this);

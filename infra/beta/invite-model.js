"use strict";

const LIMIT = 30;

function assertState(state) {
  if (!state || state.limit !== LIMIT || !Number.isSafeInteger(state.activeCount)
      || state.activeCount < 0 || state.activeCount > LIMIT) {
    throw new Error("Invalid betaControl/state; refuse to modify invitations");
  }
}
function transition(state, member, operation) {
  assertState(state);
  if (operation !== "activate" && operation !== "revoke") throw new Error("Unknown invitation operation");
  const currentlyActive = !!(member && member.enabled === true);
  if (operation === "activate") {
    if (currentlyActive) return { activeCount: state.activeCount, changed: false };
    if (state.activeCount >= LIMIT) throw new Error("Beta is full: 30 active invitations");
    return { activeCount: state.activeCount + 1, changed: true };
  }
  if (!currentlyActive) return { activeCount: state.activeCount, changed: false };
  if (state.activeCount < 1) throw new Error("Invitation counter mismatch; refuse to revoke");
  return { activeCount: state.activeCount - 1, changed: true };
}
function validUid(uid) {
  return typeof uid === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(uid);
}
function parseExpiry(iso, now = Date.now()) {
  if (typeof iso !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:/.test(iso) || !/(Z|[+-]\d\d:\d\d)$/.test(iso)) {
    throw new Error("Use an offset-aware ISO timestamp (e.g. 2026-11-15T23:59:00+09:00)");
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms <= now || ms > now + 60 * 86400000) {
    throw new Error("Expiry must be in the future and within 60 days");
  }
  return ms;
}

module.exports = { LIMIT, assertState, transition, validUid, parseExpiry };

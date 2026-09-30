const crypto = require("crypto");

function verifyGitHubSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !webhookSecret) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex")}`;
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signatureHeader, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createDeliveryStore(options = {}) {
  const maxEntries = options.maxEntries ?? 1000;
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const entries = new Map();

  function prune(now) {
    for (const [deliveryId, seenAt] of entries) {
      if (now - seenAt > ttlMs) entries.delete(deliveryId);
    }
    while (entries.size > maxEntries) {
      const first = entries.keys().next().value;
      if (!first) break;
      entries.delete(first);
    }
  }

  return {
    markIfNew(deliveryId) {
      const now = Date.now();
      prune(now);
      if (!deliveryId) return false;
      if (entries.has(deliveryId)) return false;
      entries.set(deliveryId, now);
      return true;
    },
  };
}

module.exports = {
  verifyGitHubSignature,
  createDeliveryStore,
};

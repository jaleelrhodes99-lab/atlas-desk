const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {
  verifyGitHubSignature,
  createDeliveryStore,
} = require("../../api/github-app/security");

test("verifyGitHubSignature accepts valid signatures", () => {
  const payload = Buffer.from('{"action":"opened"}');
  const secret = "top-secret";
  const signature = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")}`;

  assert.equal(verifyGitHubSignature(payload, signature, secret), true);
});

test("verifyGitHubSignature rejects invalid signatures", () => {
  const payload = Buffer.from('{"action":"opened"}');
  assert.equal(
    verifyGitHubSignature(payload, "sha256=deadbeef", "top-secret"),
    false
  );
});

test("delivery store rejects duplicate delivery ids", () => {
  const store = createDeliveryStore({ ttlMs: 1000, maxEntries: 10 });
  assert.equal(store.markIfNew("delivery-1"), true);
  assert.equal(store.markIfNew("delivery-1"), false);
  assert.equal(store.markIfNew("delivery-2"), true);
});

test("delivery store rejects missing delivery ids", () => {
  const store = createDeliveryStore({ ttlMs: 1000, maxEntries: 10 });
  assert.equal(store.markIfNew(""), false);
});

test("delivery store allows id after TTL expiry", async () => {
  const store = createDeliveryStore({ ttlMs: 10, maxEntries: 10 });
  assert.equal(store.markIfNew("delivery-expire"), true);
  assert.equal(store.markIfNew("delivery-expire"), false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(store.markIfNew("delivery-expire"), true);
});

test("delivery store evicts oldest when max entries exceeded", () => {
  const store = createDeliveryStore({ ttlMs: 1000, maxEntries: 2 });
  assert.equal(store.markIfNew("d1"), true);
  assert.equal(store.markIfNew("d2"), true);
  assert.equal(store.markIfNew("d3"), true);
  assert.equal(store.markIfNew("d1"), true);
});

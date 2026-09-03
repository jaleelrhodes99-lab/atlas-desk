const crypto = require("crypto");
const MEM0 = "https://api.mem0.ai/v1";
const WRITE_MAX = 2000;

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(status).json(body);
}

function configured() {
  return Boolean(process.env.MEM0_API_KEY);
}

function userId() {
  return process.env.MEM0_USER_ID || "atlas-desk-jaleel";
}

function header(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function gateOk(req) {
  const expected = process.env.ATLAS_MEMORY_GATE || "";
  if (!expected) return false;
  let provided = header(req, "x-atlas-memory-key");
  const auth = header(req, "authorization");
  if (!provided && /^Bearer /i.test(auth)) {
    provided = auth.slice(7).trim();
  }
  if (!provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function mem0(path, method, payload) {
  const headers = {
    Authorization: `Token ${process.env.MEM0_API_KEY}`,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${MEM0}${path}`, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error("memory cloud call failed");
    err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }
  return data;
}

module.exports = async (req, res) => {
  const allowed = gateOk(req);
  const publicPlugin = {
    id: "memory-cloud",
    provider: "mem0",
    broker: false,
    gated: true,
  };
  const plugin = {
    ...publicPlugin,
    connected: configured(),
    user_id: userId(),
  };

  if (req.method === "GET") {
    if (!allowed) {
      return json(res, 200, { ok: true, plugin: publicPlugin });
    }
    return json(res, 200, {
      ok: true,
      plugin,
      next: configured()
        ? "POST /api/memory with { action: recall|write }"
        : "Set MEM0_API_KEY on the Vercel project as a Secret, then retry",
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method not allowed" });
  }

  if (!allowed) {
    return json(res, 401, {
      ok: false,
      plugin: publicPlugin,
      error: "memory gate required",
    });
  }

  if (!configured()) {
    return json(res, 409, {
      ok: false,
      plugin,
      error: "memory cloud not connected",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};
  const action = body.action || "status";

  try {
    if (action === "recall") {
      const query = String(body.query || "atlas desk structure").slice(0, WRITE_MAX);
      const data = await mem0("/memories/search/", "POST", {
        query,
        user_id: userId(),
      });
      return json(res, 200, { ok: true, plugin, action, query, memories: data });
    }

    if (action === "write") {
      const text = String(body.text || "").trim();
      if (!text) {
        return json(res, 400, { ok: false, error: "text required" });
      }
      if (text.length > WRITE_MAX) {
        return json(res, 400, { ok: false, error: "text too long" });
      }
      const data = await mem0("/memories/", "POST", {
        messages: [{ role: "user", content: text }],
        user_id: userId(),
        metadata: { desk: "atlas", engine: "atlas-2.3.0", broker: false },
      });
      return json(res, 200, { ok: true, plugin, action, stored: data });
    }

    return json(res, 200, { ok: true, plugin, action: "status" });
  } catch (err) {
    return json(res, err.status || 502, {
      ok: false,
      plugin: { ...plugin, connected: false },
      error: "memory cloud call failed",
    });
  }
};

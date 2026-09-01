const MEM0 = "https://api.mem0.ai/v1";

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  res.status(status).json(body);
}

function configured() {
  return Boolean(process.env.MEM0_API_KEY);
}

function userId() {
  return process.env.MEM0_USER_ID || "atlas-desk-jaleel";
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
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `mem0 ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

module.exports = async (req, res) => {
  const plugin = {
    id: "memory-cloud",
    provider: "mem0",
    connected: configured(),
    user_id: userId(),
    broker: false,
  };

  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      plugin,
      next: configured()
        ? "POST /api/memory with { action: recall|write }"
        : "Set MEM0_API_KEY on the Vercel project, then retry",
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "method not allowed" });
  }

  if (!configured()) {
    return json(res, 409, {
      ok: false,
      plugin,
      error: "memory cloud not connected",
      hint: "Create a key at https://app.mem0.ai and set MEM0_API_KEY",
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
      const query = String(body.query || "atlas desk structure");
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
      error: err.message || "memory cloud call failed",
    });
  }
};

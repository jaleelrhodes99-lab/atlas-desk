function createInMemoryRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000;
  const maxRequests = options.maxRequests || 120;
  const requestLog = new Map();

  return function rateLimit(req, res, next) {
    const key = req.ip || "unknown";
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = requestLog.get(key) || [];
    const recent = timestamps.filter((ts) => ts > windowStart);

    if (recent.length >= maxRequests) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    recent.push(now);
    requestLog.set(key, recent);
    return next();
  };
}

module.exports = {
  createInMemoryRateLimiter,
};

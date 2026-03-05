const { verifyToken } = require("../utils/jwt");
const Player = require("../models/Player");

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

    const decoded = verifyToken(token);

    // ✅ support both token payloads:
    // - new: { playerId }
    // - old: { pid }
    const id = decoded.playerId || decoded.pid;
    if (!id) return res.status(401).json({ ok: false, error: "bad_token_payload" });

    const player = await Player.findById(id);
    if (!player) return res.status(401).json({ ok: false, error: "invalid_token" });

    req.player = player;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
}

module.exports = { requireAuth };
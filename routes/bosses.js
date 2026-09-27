const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const { authenticate } = require("./auth"); // assuming a middleware or we can write our own inline

// Ensure verifyToken is used directly if there's no authenticate middleware exported
const { verifyToken } = require("../utils/jwt");

// Tiny local middleware for protecting routes
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, error: "missing_token" });
    }
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);
    
    // Support either payload format { playerId } or { pid }
    const pid = decoded.playerId || decoded.pid;
    if (!pid) return res.status(401).json({ ok: false, error: "invalid_token_payload" });

    req.playerId = pid;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
};

// In-memory active boss sessions: sessionToken -> { playerId, bossId, startMs, createdAt }
const crypto = require("crypto");
const activeBossSessions = new Map();

// Periodic cleanup of sessions older than 60 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeBossSessions.entries()) {
    if (now - session.createdAt > 60 * 60 * 1000) {
      activeBossSessions.delete(token);
    }
  }
}, 5 * 60 * 1000);

// Minimum realistic combat durations required to defeat each boss
const MIN_BOSS_COMBAT_MS = {
  boss_base: 8000,       // 8s minimum
  boss_radiance: 12000,  // 12s minimum
  boss_sans: 12000,      // 12s minimum
  boss_goddess: 15000,   // 15s minimum
};

// GET /bosses/unlocks
router.get("/unlocks", requireAuth, async (req, res) => {
  try {
    const player = await Player.findById(req.playerId).lean();
    if (!player) return res.status(404).json({ ok: false, error: "player_not_found" });

    return res.json({
      ok: true,
      unlocked: player.bossUnlocks || []
    });
  } catch (err) {
    console.error("GET /bosses/unlocks error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /bosses/start
// Initiates an authoritative boss session
router.post("/start", requireAuth, async (req, res) => {
  try {
    const { bossId } = req.body;
    if (!bossId || typeof bossId !== "string") {
      return res.status(400).json({ ok: false, error: "invalid_boss_id" });
    }

    const sessionToken = crypto.randomBytes(24).toString("hex");
    const now = Date.now();

    activeBossSessions.set(sessionToken, {
      playerId: req.playerId,
      bossId,
      startMs: now,
      createdAt: now,
    });

    return res.json({
      ok: true,
      sessionToken,
      bossId,
      startMs: now,
    });
  } catch (err) {
    console.error("POST /bosses/start error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /bosses/unlock
router.post("/unlock", requireAuth, async (req, res) => {
  try {
    const { bossId, sessionToken } = req.body;
    if (!bossId || typeof bossId !== "string") {
      return res.status(400).json({ ok: false, error: "invalid_boss_id" });
    }

    // Anti-Cheat: Validate boss battle session
    if (!sessionToken) {
      return res.status(400).json({
        ok: false,
        error: "missing_boss_session",
        message: "Boss battle must be initiated through /bosses/start"
      });
    }

    const session = activeBossSessions.get(sessionToken);
    if (!session) {
      return res.status(400).json({
        ok: false,
        error: "invalid_or_expired_session",
        message: "Boss session expired or does not exist"
      });
    }

    if (session.playerId !== req.playerId) {
      return res.status(403).json({ ok: false, error: "unauthorized_session" });
    }

    if (session.bossId !== bossId) {
      return res.status(400).json({ ok: false, error: "boss_id_mismatch" });
    }

    // Validate elapsed combat time
    const elapsedMs = Date.now() - session.startMs;
    const minRequired = MIN_BOSS_COMBAT_MS[bossId] || 8000;

    if (elapsedMs < minRequired) {
      console.warn(`[AntiCheat] Instant boss kill attempt rejected for player ${req.playerId} against ${bossId}: elapsed ${elapsedMs}ms, min ${minRequired}ms`);
      activeBossSessions.delete(sessionToken);
      return res.status(400).json({
        ok: false,
        error: "combat_too_fast",
        message: "Defeat sequence occurred impossibly fast"
      });
    }

    // Single-use token: consume immediately
    activeBossSessions.delete(sessionToken);

    const player = await Player.findByIdAndUpdate(
      req.playerId,
      { $addToSet: { bossUnlocks: bossId } },
      { new: true, select: "bossUnlocks" }
    );

    if (!player) return res.status(404).json({ ok: false, error: "player_not_found" });

    res.json({
      ok: true,
      unlocked: player.bossUnlocks
    });
  } catch (err) {
    console.error("POST /bosses/unlock error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;

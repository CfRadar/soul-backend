const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const { requireAuth } = require("../middleware/auth");
const { getTimeTrialRank, getTimeTrialTitle } = require("../utils/rank");

// In-memory active time trial sessions: sessionToken -> { playerId, startMs, createdAt }
const crypto = require("crypto");
const activeSessions = new Map();

// Cleanup sessions older than 70 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (now - session.createdAt > 70 * 60 * 1000) {
      activeSessions.delete(token);
    }
  }
}, 5 * 60 * 1000);

// Helper to format player for public leaderboard with dedicated Time Trial ranks
function pub(p, position) {
  const timeMs = Number(p.bestTimeTrialMs || 0);
  const ttRank = getTimeTrialRank(timeMs, position);
  const ttTitle = getTimeTrialTitle(ttRank);

  return {
    position: position,
    uid: p.uid,
    username: p.username,
    bestTimeTrialMs: timeMs,
    timeTrialRank: ttRank,
    timeTrialTitle: ttTitle,
    rank: ttRank, // For components that inspect rank field
    rating: Number(p.rating || 0),
    wins: Number(p.wins || 0),
    losses: Number(p.losses || 0),
  };
}

// ✅ GET /time-trial/leaderboard?limit=50
// Returns top players sorted by bestTimeTrialMs desc, then updatedAt desc
router.get("/leaderboard", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query?.limit) || 50, 1), 200);

    const players = await Player.find({ bestTimeTrialMs: { $gt: 0 } })
      .sort({ bestTimeTrialMs: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    // Add position to each player
    const leaderboard = players.map((player, index) =>
      pub(player, index + 1)
    );

    return res.json({
      ok: true,
      rows: leaderboard,
    });
  } catch (e) {
    console.error("time-trial leaderboard error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ POST /time-trial/start
// requireAuth
// Starts an authoritative time trial run session
router.post("/start", requireAuth, async (req, res) => {
  try {
    const playerId = String(req.player._id);
    const sessionToken = crypto.randomBytes(24).toString("hex");
    const now = Date.now();

    activeSessions.set(sessionToken, {
      playerId,
      startMs: now,
      createdAt: now,
    });

    return res.json({
      ok: true,
      sessionToken,
      startMs: now,
    });
  } catch (e) {
    console.error("time-trial start error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ POST /time-trial/submit
// requireAuth
// Body: { timeMs: number, sessionToken?: string }
// Validates actual server elapsed time against claimed timeMs
router.post("/submit", requireAuth, async (req, res) => {
  try {
    const { timeMs, sessionToken } = req.body;
    const playerId = String(req.player._id);

    // Validate timeMs format
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      return res.status(400).json({ ok: false, error: "invalid_timeMs" });
    }

    // Anti-Cheat: Validate run session token
    if (!sessionToken) {
      return res.status(400).json({
        ok: false,
        error: "missing_run_session",
        message: "Time trial must be started via /time-trial/start"
      });
    }

    const session = activeSessions.get(sessionToken);
    if (!session) {
      return res.status(400).json({
        ok: false,
        error: "invalid_or_expired_session",
        message: "Run session expired or does not exist"
      });
    }

    // Verify session owner
    if (session.playerId !== playerId) {
      return res.status(403).json({ ok: false, error: "unauthorized_session" });
    }

    // Calculate actual elapsed server time
    const serverElapsedMs = Date.now() - session.startMs;
    // Allow generous 4-second grace buffer for client countdown/transit latency
    const maxAllowedMs = serverElapsedMs + 4000;

    if (timeMs > maxAllowedMs) {
      console.warn(`[AntiCheat] Time trial time inflation rejected for player ${playerId}: claimed ${timeMs}ms, server elapsed ${serverElapsedMs}ms`);
      activeSessions.delete(sessionToken);
      return res.status(400).json({
        ok: false,
        error: "time_manipulation_detected",
        message: "Claimed survival time exceeds real elapsed time"
      });
    }

    // Single-use token: consume immediately
    activeSessions.delete(sessionToken);

    // Cap to sensible max (60 minutes)
    const maxMs = 60 * 60 * 1000;
    const cappedTimeMs = Math.min(timeMs, maxMs);

    // Check if this is a new best time
    const player = await Player.findById(playerId);
    if (!player) {
      return res.status(404).json({ ok: false, error: "player_not_found" });
    }

    const currentBest = player.bestTimeTrialMs || 0;
    const improved = cappedTimeMs > currentBest;

    if (improved) {
      player.bestTimeTrialMs = cappedTimeMs;
      await player.save();
    }

    const finalBest = player.bestTimeTrialMs || 0;
    const ttRank = getTimeTrialRank(finalBest);
    const ttTitle = getTimeTrialTitle(ttRank);

    return res.json({
      ok: true,
      bestTimeTrialMs: finalBest,
      timeTrialRank: ttRank,
      timeTrialTitle: ttTitle,
      improved,
    });
  } catch (e) {
    console.error("time-trial submit error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;

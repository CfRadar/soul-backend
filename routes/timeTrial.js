const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const { requireAuth } = require("../middleware/auth");
const { getTimeTrialRank, getTimeTrialTitle } = require("../utils/rank");

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

// ✅ POST /time-trial/submit
// requireAuth
// Body: { timeMs: number }
// Only update if timeMs > player.bestTimeTrialMs
// Response: { ok: true, bestTimeTrialMs, timeTrialRank, timeTrialTitle, improved: boolean }
router.post("/submit", requireAuth, async (req, res) => {
  try {
    const { timeMs } = req.body;
    const playerId = req.player._id;

    // Validate timeMs
    if (!Number.isFinite(timeMs) || timeMs < 0) {
      return res.status(400).json({ ok: false, error: "invalid_timeMs" });
    }

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

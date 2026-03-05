const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const { getRankWithPosition } = require("../utils/rank");

// Helper to format player for public leaderboard (no email)
function pub(p, position) {
  return {
    position: position,
    uid: p.uid,
    username: p.username,
    rating: Number(p.rating || 0),
    rank: getRankWithPosition(p.rating || 0, position),
    wins: Number(p.wins || 0),
    losses: Number(p.losses || 0),
  };
}

// ✅ GET /leaderboard?limit=10
// Returns top players sorted by rating desc, then wins desc, then updatedAt desc
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query?.limit) || 10, 1), 100);

    const players = await Player.find({})
      .sort({ rating: -1, wins: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    // Add position to each player and calculate rank with position
    const leaderboard = players.map((player, index) => 
      pub(player, index + 1)
    );

    return res.json({
      ok: true,
      leaderboard: leaderboard,
    });
  } catch (e) {
    console.error("leaderboard error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;


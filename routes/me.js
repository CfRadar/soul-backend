const express = require("express");
const { requireAuth } = require("../middleware/auth");
const Player = require("../models/Player");
const { getRankWithPosition } = require("../utils/rank");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const p = req.player;

  // Get leaderboard position for dynamic rank
  const top = await Player.find({}, "_id rating")
    .sort({ rating: -1 })
    .limit(10)
    .lean();
  
  const myIndex = top.findIndex(player => 
    String(player._id) === String(p._id)
  );
  const leaderboardPosition = myIndex >= 0 ? myIndex + 1 : null;

  const total = (p.wins || 0) + (p.losses || 0);
  const winrate = total === 0 ? 0 : Math.round((p.wins / total) * 100);

  res.json({
    ok: true,
    player: {
      id: p._id,
      uid: p.uid,
      username: p.username,
      rating: p.rating,
      rank: getRankWithPosition(p.rating, leaderboardPosition),
      wins: p.wins,
      losses: p.losses,
      winrate,
    },
  });
});

// POST /me/username - Change username
router.post("/username", requireAuth, async (req, res) => {
  try {
    const username = req.body.username ? String(req.body.username).trim() : "";

    // Validate username format: 3-16 chars, letters/numbers/_
    const usernameRegex = /^[a-zA-Z0-9_]{3,16}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ ok: false, error: "invalid_username" });
    }

    // Check if username is already taken (by another player)
    const existing = await req.player.constructor.findOne({ username });
    if (existing && String(existing._id) !== String(req.player._id)) {
      return res.status(409).json({ ok: false, error: "username_taken" });
    }

    // Update username
    req.player.username = username;
    await req.player.save();

    // Return updated player data (without email)
    const p = req.player;
    const total = (p.wins || 0) + (p.losses || 0);
    const winrate = total === 0 ? 0 : Math.round((p.wins / total) * 100);

    // Get leaderboard position for dynamic rank
    const top = await Player.find({}, "_id rating")
      .sort({ rating: -1 })
      .limit(10)
      .lean();
    
    const myIndex = top.findIndex(player => 
      String(player._id) === String(p._id)
    );
    const leaderboardPosition = myIndex >= 0 ? myIndex + 1 : null;

    return res.json({
      ok: true,
      player: {
        id: p._id,
        uid: p.uid,
        username: p.username,
        rating: p.rating,
        rank: getRankWithPosition(p.rating, leaderboardPosition),
        wins: p.wins,
        losses: p.losses,
        winrate,
      },
    });
  } catch (e) {
    // Handle MongoDB duplicate key error (code 11000)
    if (e.code === 11000) {
      return res.status(409).json({ ok: false, error: "username_taken" });
    }
    console.error("update username error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();

const Player = require("../models/Player");
const { sendOtp, verifyOtp } = require("../utils/otpService"); // your apps script helper
const { signToken } = require("../utils/jwt");
const { makeUID } = require("../utils/uid");
const { getRankWithPosition } = require("../utils/rank");

// POST /auth/request-otp
router.post("/request-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email.includes("@"))
      return res.status(400).json({ ok: false, error: "invalid_email" });

    const r = await sendOtp(email);
    if (!r?.ok)
      return res.status(400).json(r || { ok: false, error: "otp_send_failed" });

    return res.json({ ok: true });
  } catch (e) {
    console.error("request-otp error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /auth/verify-otp
router.post("/verify-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const otp = String(req.body.otp || "").trim();

    if (!email.includes("@") || otp.length < 4) {
      return res.status(400).json({ ok: false, error: "invalid_input" });
    }

    const r = await verifyOtp(email, otp);
    if (!r?.ok)
      return res.status(400).json(r || { ok: false, error: "otp_verify_failed" });

    // find or create player
    let player = await Player.findOne({ email });

    if (!player) {
      // username: base + random suffix (to avoid collisions)
      const base =
        email.split("@")[0].replace(/[^a-z0-9_]/gi, "").slice(0, 12) || "player";
      let username = `${base}${Math.floor(100 + Math.random() * 900)}`;

      // ensure unique username (rare collision)
      for (let i = 0; i < 5; i++) {
        const exists = await Player.findOne({ username });
        if (!exists) break;
        username = `${base}${Math.floor(100 + Math.random() * 900)}${i}`;
      }

      player = await Player.create({
        email,
        username,
        uid: makeUID("SD"),
        rating: 0,
      });
    }

    // update lastSeenAt
    player.lastSeenAt = new Date();
    await player.save();

    // ✅ UPDATED JWT payload: keep pid (old) + add playerId (new)
    const pid = player._id.toString();
    const token = signToken({
      pid,              // keep for existing socket auth / older middleware
      playerId: pid,    // add for requireAuth middleware compatibility
      uid: player.uid,
    });

    // Get leaderboard position for dynamic rank
    const top = await Player.find({}, "_id rating")
      .sort({ rating: -1 })
      .limit(10)
      .lean();
    
    const myIndex = top.findIndex(p => String(p._id) === String(player._id));
    const leaderboardPosition = myIndex >= 0 ? myIndex + 1 : null;

    return res.json({
      ok: true,
      token,
      player: {
        id: pid,
        uid: player.uid,
        username: player.username,
        rating: player.rating,
        rank: getRankWithPosition(player.rating, leaderboardPosition),
        wins: player.wins,
        losses: player.losses,
        friends: player.friends || [],
      },
    });
  } catch (e) {
    console.error("verify-otp error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /auth/logout (optional)
router.post("/logout", (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
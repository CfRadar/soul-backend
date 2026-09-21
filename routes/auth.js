const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");

const Player = require("../models/Player");
const { sendOtp, verifyOtp } = require("../utils/otpService");
const { signToken } = require("../utils/jwt");
const { makeUID } = require("../utils/uid");
const { getRankWithPosition } = require("../utils/rank");

// Helper to construct standard player auth response
async function generatePlayerAuthResponse(player) {
  const pid = player._id.toString();
  const token = signToken({
    pid,              // for socket auth & legacy middleware
    playerId: pid,    // for requireAuth middleware
    uid: player.uid,
  });

  // Fetch top 10 leaderboard for dynamic rank determination
  const top = await Player.find({}, "_id rating")
    .sort({ rating: -1 })
    .limit(10)
    .lean();

  const myIndex = top.findIndex((p) => String(p._id) === String(player._id));
  const leaderboardPosition = myIndex >= 0 ? myIndex + 1 : null;

  return {
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
  };
}

// POST /auth/signup
router.post("/signup", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "").trim();
    let username = String(req.body.username || "").trim();

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ ok: false, error: "password_too_short" });
    }

    if (username) {
      if (username.length < 3 || username.length > 16 || !/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ ok: false, error: "invalid_username" });
      }
      const existingUser = await Player.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ ok: false, error: "username_taken" });
      }
    } else {
      // Auto-generate unique username if not provided
      const base =
        email.split("@")[0].replace(/[^a-z0-9_]/gi, "").slice(0, 12) || "player";
      username = `${base}${Math.floor(100 + Math.random() * 900)}`;
      for (let i = 0; i < 5; i++) {
        const exists = await Player.findOne({ username });
        if (!exists) break;
        username = `${base}${Math.floor(100 + Math.random() * 900)}${i}`;
      }
    }

    const existingEmail = await Player.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ ok: false, error: "email_taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const player = await Player.create({
      email,
      username,
      password: hashedPassword,
      uid: makeUID("SD"),
      rating: 0,
      wins: 0,
      losses: 0,
      lastSeenAt: new Date(),
    });

    const responseData = await generatePlayerAuthResponse(player);
    return res.status(201).json(responseData);
  } catch (e) {
    console.error("signup error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const identifier = String(req.body.email || req.body.username || "").trim();
    const password = String(req.body.password || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ ok: false, error: "missing_credentials" });
    }

    const normalizedEmail = identifier.toLowerCase();
    const player = await Player.findOne({
      $or: [{ email: normalizedEmail }, { username: identifier }],
    });

    if (!player) {
      return res.status(401).json({ ok: false, error: "user_not_found" });
    }

    if (!player.password) {
      return res.status(400).json({ ok: false, error: "account_has_no_password" });
    }

    const isMatch = await bcrypt.compare(password, player.password);
    if (!isMatch) {
      return res.status(401).json({ ok: false, error: "invalid_password" });
    }

    player.lastSeenAt = new Date();
    await player.save();

    const responseData = await generatePlayerAuthResponse(player);
    return res.json(responseData);
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /auth/request-otp (Legacy fallback)
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

// POST /auth/verify-otp (Legacy fallback)
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

    let player = await Player.findOne({ email });
    if (!player) {
      const base =
        email.split("@")[0].replace(/[^a-z0-9_]/gi, "").slice(0, 12) || "player";
      let username = `${base}${Math.floor(100 + Math.random() * 900)}`;

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

    player.lastSeenAt = new Date();
    await player.save();

    const responseData = await generatePlayerAuthResponse(player);
    return res.json(responseData);
  } catch (e) {
    console.error("verify-otp error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /auth/logout
router.post("/logout", (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
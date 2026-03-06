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

// POST /bosses/unlock
router.post("/unlock", requireAuth, async (req, res) => {
  try {
    const { bossId } = req.body;
    if (!bossId || typeof bossId !== "string") {
      return res.status(400).json({ ok: false, error: "invalid_boss_id" });
    }

    // You can enforce an enum check here if you only want exactly "boss_radiance"
    // e.g., const ALLOWED_BOSSES = ["boss_radiance"];
    // if (!ALLOWED_BOSSES.includes(bossId)) return res.status(400).json({ ok: false, error: "unknown_boss" });

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

// server/routes/friends.js
const express = require("express");
const router = express.Router();
const Player = require("../models/Player");
const { requireAuth } = require("../middleware/auth");
const { getRank } = require("../utils/rank");

function pub(p) {
  return {
    id: String(p._id),
    uid: p.uid,
    username: p.username,
    rating: Number(p.rating || 0),
    rank: getRank(p.rating || 0),
    wins: Number(p.wins || 0),
    losses: Number(p.losses || 0),
  };
}

// ✅ GET /friends/list
router.get("/list", requireAuth, async (req, res) => {
  try {
    if (!req.player?._id) return res.status(401).json({ ok: false, error: "unauthorized" });

    const me = await Player.findById(req.player._id)
      .populate("friends", "uid username rating wins losses")
      .exec();

    return res.json({
      ok: true,
      friends: (me?.friends || []).map(pub),
    });
  } catch (e) {
    console.error("friends/list error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ GET /friends/requests
router.get("/requests", requireAuth, async (req, res) => {
  try {
    if (!req.player?._id) return res.status(401).json({ ok: false, error: "unauthorized" });

    const me = await Player.findById(req.player._id)
      .populate("friendRequestsIn", "uid username rating wins losses")
      .populate("friendRequestsOut", "uid username rating wins losses")
      .exec();

    return res.json({
      ok: true,
      incoming: (me?.friendRequestsIn || []).map(pub),
      outgoing: (me?.friendRequestsOut || []).map(pub),
    });
  } catch (e) {
    console.error("friends/requests error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ POST /friends/request  body: { uid }
router.post("/request", requireAuth, async (req, res) => {
  try {
    const uid = String(req.body.uid || "").trim().toUpperCase();
    if (!uid) return res.status(400).json({ ok: false, error: "missing_uid" });
    if (!req.player?._id) return res.status(401).json({ ok: false, error: "unauthorized" });

    const me = await Player.findById(req.player._id);
    const other = await Player.findOne({ uid });

    if (!other) return res.status(404).json({ ok: false, error: "no_user" });
    if (String(other._id) === String(me._id))
      return res.status(400).json({ ok: false, error: "cant_add_self" });

    // already friends
    if ((me.friends || []).some((x) => String(x) === String(other._id))) {
      return res.json({ ok: true, status: "already_friends" });
    }

    // already requested by me
    if ((me.friendRequestsOut || []).some((x) => String(x) === String(other._id))) {
      return res.json({ ok: true, status: "already_requested" });
    }

    // if they requested me already -> auto accept
    if ((me.friendRequestsIn || []).some((x) => String(x) === String(other._id))) {
      me.friendRequestsIn = (me.friendRequestsIn || []).filter((x) => String(x) !== String(other._id));
      other.friendRequestsOut = (other.friendRequestsOut || []).filter(
        (x) => String(x) !== String(me._id)
      );

      me.friends = [...(me.friends || []), other._id];
      other.friends = [...(other.friends || []), me._id];

      await me.save();
      await other.save();

      return res.json({ ok: true, status: "accepted", friend: pub(other) });
    }

    // normal request
    me.friendRequestsOut = [...(me.friendRequestsOut || []), other._id];
    other.friendRequestsIn = [...(other.friendRequestsIn || []), me._id];

    await me.save();
    await other.save();

    return res.json({ ok: true, status: "requested" });
  } catch (e) {
    console.error("friends/request error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ POST /friends/accept  body: { uid }
router.post("/accept", requireAuth, async (req, res) => {
  try {
    const uid = String(req.body.uid || "").trim().toUpperCase();
    if (!uid) return res.status(400).json({ ok: false, error: "missing_uid" });
    if (!req.player?._id) return res.status(401).json({ ok: false, error: "unauthorized" });

    const me = await Player.findById(req.player._id);
    const other = await Player.findOne({ uid });
    if (!other) return res.status(404).json({ ok: false, error: "no_user" });

    const hasReq = (me.friendRequestsIn || []).some((x) => String(x) === String(other._id));
    if (!hasReq) return res.status(400).json({ ok: false, error: "no_request" });

    me.friendRequestsIn = (me.friendRequestsIn || []).filter((x) => String(x) !== String(other._id));
    other.friendRequestsOut = (other.friendRequestsOut || []).filter(
      (x) => String(x) !== String(me._id)
    );

    if (!(me.friends || []).some((x) => String(x) === String(other._id))) me.friends.push(other._id);
    if (!(other.friends || []).some((x) => String(x) === String(me._id))) other.friends.push(me._id);

    await me.save();
    await other.save();

    return res.json({ ok: true, friend: pub(other) });
  } catch (e) {
    console.error("friends/accept error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ✅ POST /friends/decline  body: { uid }
router.post("/decline", requireAuth, async (req, res) => {
  try {
    const uid = String(req.body.uid || "").trim().toUpperCase();
    if (!uid) return res.status(400).json({ ok: false, error: "missing_uid" });
    if (!req.player?._id) return res.status(401).json({ ok: false, error: "unauthorized" });

    const me = await Player.findById(req.player._id);
    const other = await Player.findOne({ uid });
    if (!other) return res.status(404).json({ ok: false, error: "no_user" });

    me.friendRequestsIn = (me.friendRequestsIn || []).filter((x) => String(x) !== String(other._id));
    other.friendRequestsOut = (other.friendRequestsOut || []).filter(
      (x) => String(x) !== String(me._id)
    );

    await me.save();
    await other.save();

    return res.json({ ok: true });
  } catch (e) {
    console.error("friends/decline error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;
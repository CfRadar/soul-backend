// server/index.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const meRoutes = require("./routes/me");
const friendsRoutes = require("./routes/friends");
const leaderboardRoutes = require("./routes/leaderboard");
const timeTrialRoutes = require("./routes/timeTrial");
const bossesRoutes = require("./routes/bosses");

require("dotenv").config();
const { connectDB } = require("./db");

const Player = require("./models/Player");
const { verifyToken } = require("./utils/jwt");
const { getRank } = require("./utils/rank");

const app = express();
app.use(express.json());
app.use(cors());

app.use("/auth", authRoutes);
app.use("/me", meRoutes);
app.use("/friends", friendsRoutes);
app.use("/leaderboard", leaderboardRoutes);
app.use("/time-trial", timeTrialRoutes);
app.use("/bosses", bossesRoutes);

app.get("/", (_, res) => res.send("Soul Duel server running"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/* -------------------- HELPERS -------------------- */

function clamp0(n) {
  return Math.max(0, Number(n) || 0);
}

async function applyResult({ winnerPid, loserPid, mode, winnerSurvivalMs = 0, loserSurvivalMs = 0 }) {
  // ✅ friend match: NO rank changes
  if (mode !== "ranked") return { winnerDelta: 0, loserDelta: 0 };

  const winner = await Player.findById(winnerPid);
  const loser = await Player.findById(loserPid);
  if (!winner || !loser) return { winnerDelta: 0, loserDelta: 0 };

  // Performance-based rating calculation
  // Normalize survival time to 0-1 range (0s=0, 60s+=1)
  const winnerNormalized = Math.min(1, winnerSurvivalMs / 60000);
  const loserNormalized = Math.min(1, loserSurvivalMs / 60000);

  // Calculate bonus based on survival time
  const winnerBonus = Math.round(winnerNormalized * 10); // 0-10
  const loserMitigation = Math.round(loserNormalized * 10); // 0-10

  // Apply rating changes
  // Winner: +10 base + 0-10 bonus = 10-20
  const winnerDelta = 10 + winnerBonus;
  // Loser: -20 base - 0-10 mitigation = -20 to -10
  const loserDelta = -(20 - loserMitigation);

  winner.wins = clamp0(winner.wins) + 1;
  loser.losses = clamp0(loser.losses) + 1;
  winner.rating = clamp0(winner.rating) + winnerDelta;
  loser.rating = Math.max(0, clamp0(loser.rating) + loserDelta);

  await winner.save();
  await loser.save();

  return { winnerDelta, loserDelta };
}

/**
 * Ends a room for any reason (death/forfeit/disconnect).
 * - Always emits matchOver (so both clients end).
 * - Applies rating changes ONLY if room.mode === "ranked".
 */
async function endRoom({ roomId, loserSid, reason = "death" }) {
  const r = rooms.get(roomId);
  if (!r || r.state === "ended") return;

  const [a, b] = r.players;
  const winnerSid = loserSid === a ? b : a;

  r.state = "ended";

  // Get player IDs from stored room data
  const loserPid = r.playerIds[r.players.indexOf(loserSid)];
  const winnerPid = r.playerIds[r.players.indexOf(winnerSid)];

  // Collect survival times (in milliseconds)
  const winnerSurvivalMs = r.stats?.[winnerSid]?.survivalMs || 0;
  const loserSurvivalMs = r.stats?.[loserSid]?.survivalMs || 0;

  // ✅ ranked only
  let winnerData = null;
  let loserData = null;
  let winnerDelta = 0;
  let loserDelta = 0;
  if (winnerPid && loserPid && r.mode === "ranked") {
    const result = await applyResult({
      winnerPid,
      loserPid,
      mode: r.mode,
      winnerSurvivalMs,
      loserSurvivalMs,
    });
    winnerDelta = result.winnerDelta || 0;
    loserDelta = result.loserDelta || 0;

    // Fetch updated player data
    const winnerPlayer = await Player.findById(winnerPid).lean();
    const loserPlayer = await Player.findById(loserPid).lean();
    if (winnerPlayer) {
      winnerData = {
        pid: winnerPlayer._id.toString(),
        uid: winnerPlayer.uid,
        username: winnerPlayer.username,
        rating: winnerPlayer.rating || 0,
        rank: getRank(winnerPlayer.rating || 0),
        wins: winnerPlayer.wins || 0,
        losses: winnerPlayer.losses || 0,
        delta: winnerDelta,
      };
    }
    if (loserPlayer) {
      loserData = {
        pid: loserPlayer._id.toString(),
        uid: loserPlayer.uid,
        username: loserPlayer.username,
        rating: loserPlayer.rating || 0,
        rank: getRank(loserPlayer.rating || 0),
        wins: loserPlayer.wins || 0,
        losses: loserPlayer.losses || 0,
        delta: loserDelta,
      };
    }
  } else if (r.mode !== "ranked") {
    // Friend matches: set delta to 0
    winnerDelta = 0;
    loserDelta = 0;
  }

  io.to(roomId).emit("game:matchOver", {
    roomId,
    winnerId: winnerSid,
    loserId: loserSid,
    endedAt: Date.now(),
    reason,
    mode: r.mode,
    winner: winnerData,
    loser: loserData,
    winnerDelta,
    loserDelta,
  });

  setTimeout(() => rooms.delete(roomId), 15000);
}

/* -------------------- MATCHMAKING / ROOMS -------------------- */

// ranked queue
const queue = []; // socket.id list

// roomId -> { players:[socketId,socketId], startedAt:number, state:"found"|"started"|"ended", seed:number, mode:"ranked"|"friend" }
const rooms = new Map();

function makeRoomId(a, b) {
  return `room_${a.slice(0, 5)}_${b.slice(0, 5)}_${Date.now()}`;
}

function safeRemoveFromQueue(id) {
  const idx = queue.indexOf(id);
  if (idx !== -1) queue.splice(idx, 1);
}

/* -------------------- FRIEND INVITES (SOCKET) -------------------- */

// uid -> socketId
const onlineByUid = new Map();

// inviteId -> { fromUid, toUid, seed, createdAt }
const invites = new Map();

function makeInviteId() {
  return `inv_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

// cleanup old invites
setInterval(() => {
  const now = Date.now();
  for (const [inviteId, inv] of invites.entries()) {
    if (now - inv.createdAt > 2 * 60 * 1000) invites.delete(inviteId);
  }
}, 30 * 1000);

/* -------------------- SOCKET AUTH -------------------- */

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("no_token"));

    const decoded = verifyToken(token); // you sign { pid, uid }
    const playerId = decoded.playerId || decoded.pid;
    if (!playerId) return next(new Error("bad_token_payload"));

    const player = await Player.findById(playerId).lean();
    if (!player) return next(new Error("no_player"));

    socket.player = {
      id: String(player._id),
      uid: player.uid,
      username: player.username,
      email: player.email,
      rating: player.rating || 0,
      rank: getRank(player.rating || 0),
    };

    next();
  } catch (e) {
    next(new Error("bad_token"));
  }
});

/* -------------------- SOCKET EVENTS -------------------- */

io.on("connection", (socket) => {
  socket.emit("server:hello", { id: socket.id });

  // mark online
  if (socket.player?.uid) onlineByUid.set(socket.player.uid, socket.id);

  /* -------------------- RANKED MATCHMAKING -------------------- */
  socket.on("matchmaking:join", ({ mode } = {}) => {
    // allow client to pass mode; default ranked
    const wantedMode = mode === "friend" ? "friend" : "ranked";

    // We only use queue for ranked.
    if (wantedMode !== "ranked") return;

    safeRemoveFromQueue(socket.id);

    // if already in active room, ignore
    for (const [, r] of rooms.entries()) {
      if (r.players.includes(socket.id) && r.state !== "ended") return;
    }

    queue.push(socket.id);

    if (queue.length >= 2) {
      const p1 = queue.shift();
      const p2 = queue.shift();
      const roomId = makeRoomId(p1, p2);

      const startAt = Date.now() + 5000;
      const seed = Math.floor(Math.random() * 1e9);

      rooms.set(roomId, {
        players: [p1, p2],
        playerIds: [
          io.sockets.sockets.get(p1)?.player?.id || null,
          io.sockets.sockets.get(p2)?.player?.id || null,
        ],
        startedAt: startAt,
        state: "found",
        seed,
        mode: "ranked",
        stats: {},
        hp: {
          [p1]: 100,
          [p2]: 100
        },
        radiance: {
          active: false,
          startedAt: 0,
          durationMs: 60000,
          finished: {}
        }
      });

      io.sockets.sockets.get(p1)?.join(roomId);
      io.sockets.sockets.get(p2)?.join(roomId);

      const s1 = io.sockets.sockets.get(p1)?.player;
      const s2 = io.sockets.sockets.get(p2)?.player;

      io.to(roomId).emit("matchFound", {
        roomId,
        startAt,
        seed,
        mode: "ranked",
        p1: s1
          ? { uid: s1.uid, username: s1.username, rating: s1.rating, rank: s1.rank, socketId: p1 }
          : { socketId: p1 },
        p2: s2
          ? { uid: s2.uid, username: s2.username, rating: s2.rating, rank: s2.rank, socketId: p2 }
          : { socketId: p2 },
      });

      setTimeout(() => {
        const r = rooms.get(roomId);
        if (!r || r.state === "ended") return;
        r.state = "started";

        io.to(roomId).emit("game:start", {
          roomId,
          startAt: r.startedAt,
          seed: r.seed,
          mode: r.mode,
        });

        // Send initial HP
        io.to(roomId).emit("game:hpInit", { 
          hpMap: r.hp || {}, 
          maxHpMap: { [r.players[0]]: 100, [r.players[1]]: 100 } 
        });
      }, Math.max(0, startAt - Date.now()));
    }
  });

  socket.on("matchmaking:leave", () => {
    safeRemoveFromQueue(socket.id);
  });

  /* -------------------- GAME ENDING EVENTS -------------------- */
  
  socket.on("game:hpUpdate", ({ roomId, hp, maxHp }) => {
    try {
      if (!roomId) return;
      const r = rooms.get(roomId);
      if (!r || r.state === "ended") return;
      if (!r.players.includes(socket.id)) return;
      
      // We only care about rank mode syncs (or friend if we add it)
      if (r.mode !== "ranked" && r.mode !== "friend") return;
      
      // Sanitize the HP value safely
      if (typeof hp !== "number" || isNaN(hp)) return;
      const cleanHp = Math.max(0, hp);
      const cleanMaxHp = (typeof maxHp === "number" && !isNaN(maxHp)) ? Math.max(10, maxHp) : 100;
      
      if (!r.hp) r.hp = {};
      r.hp[socket.id] = cleanHp;
      
      // Target sync cleanly only to the opponents inside the room securely
      socket.to(roomId).emit("game:hpSync", { socketId: socket.id, hp: cleanHp, maxHp: cleanMaxHp });
    } catch (e) {
      console.error("game:hpUpdate error:", e);
    }
  });

  // ✅ HP reached 0 => end match
  socket.on("game:death", async ({ roomId } = {}) => {
    try {
      if (!roomId) return;
      const r = rooms.get(roomId);
      if (!r) return;

      // Record survival time for this player
      const survivalMs = Math.max(0, Date.now() - (r.startedAt || Date.now()));
      if (!r.stats) r.stats = {};
      r.stats[socket.id] = { survivalMs };

      await endRoom({ roomId, loserSid: socket.id, reason: "death" });
    } catch (e) {
      console.error("game:death error:", e);
    }
  });

  // ✅ Ranked exit => forfeit (loss -20). Friend => no rank change (server checks mode)
  socket.on("game:forfeit", async ({ roomId } = {}) => {
    try {
      if (!roomId) return;
      const r = rooms.get(roomId);
      if (!r) return;

      // Record survival time for this player
      const survivalMs = Math.max(0, Date.now() - (r.startedAt || Date.now()));
      if (!r.stats) r.stats = {};
      r.stats[socket.id] = { survivalMs };

      await endRoom({ roomId, loserSid: socket.id, reason: "forfeit" });
    } catch (e) {
      console.error("game:forfeit error:", e);
    }
  });

  /* -------------------- RADIANCE BOSS SYNC (RANKED ONLY) -------------------- */
  socket.on("radiance:finished", ({ roomId } = {}) => {
    try {
      if (!roomId) return;
      const r = rooms.get(roomId);
      if (!r) return;
      
      // Ensure socket is actually in this room
      if (!r.players.includes(socket.id)) return;
      
      // We only care about rank mode syncs
      if (r.mode !== "ranked") return;

      // Mark this specific socket as finished
      if (!r.radiance) {
        r.radiance = { active: false, startedAt: 0, durationMs: 60000, finished: {} };
      }
      
      // If already finished, ignore duplicate emits
      if (r.radiance.finished[socket.id]) return;
      
      r.radiance.active = true;
      r.radiance.finished[socket.id] = true;

      // Check if BOTH players are finished
      const allDone = r.players.every((pid) => r.radiance.finished[pid] === true);

      if (allDone) {
        r.radiance.active = false;
        // Broadcast to entire room that normal gameplay resumes
        io.to(roomId).emit("radiance:resumeNormal", {
          roomId,
          resumeAt: Date.now() + 1000 // 1 second buffer for visual clarity
        });
      } else {
        // Only one finished, tell them to wait
        socket.emit("radiance:wait", { roomId });
      }
    } catch (e) {
      console.error("radiance:finished error:", e);
    }
  });

  /* -------------------- GODDESS BOSS SYNC (RANKED ONLY) -------------------- */
  socket.on("goddess:finished", ({ roomId } = {}) => {
    try {
      if (!roomId) return;
      const r = rooms.get(roomId);
      if (!r) return;
      
      // Ensure socket is actually in this room
      if (!r.players.includes(socket.id)) return;
      
      // We only care about rank mode syncs
      if (r.mode !== "ranked") return;

      // Mark this specific socket as finished
      if (!r.goddess) {
        r.goddess = { active: false, startedAt: 0, durationMs: 60000, finished: {} };
      }
      
      // If already finished, ignore duplicate emits
      if (r.goddess.finished[socket.id]) return;
      
      r.goddess.active = true;
      r.goddess.finished[socket.id] = true;

      // Check if BOTH players are finished
      const allDone = r.players.every((pid) => r.goddess.finished[pid] === true);

      if (allDone) {
        r.goddess.active = false;
        // Broadcast to entire room that normal gameplay resumes
        io.to(roomId).emit("goddess:resumeNormal", {
          roomId,
          resumeAt: Date.now() + 1000 // 1 second buffer for visual clarity
        });
      } else {
        // Only one finished, tell them to wait
        socket.emit("goddess:wait", { roomId });
      }
    } catch (e) {
      console.error("goddess:finished error:", e);
    }
  });

  /* -------------------- FRIEND INVITES -------------------- */

  // send invite to a UID (online only for now)
  socket.on("friend:invite", ({ toUid }) => {
    try {
      const from = socket.player;
      if (!from?.uid) return;

      const targetUid = String(toUid || "").trim().toUpperCase();
      if (!targetUid || targetUid === from.uid) return;

      const targetSocketId = onlineByUid.get(targetUid);
      if (!targetSocketId) {
        socket.emit("friend:invite:status", {
          ok: false,
          error: "friend_offline",
          toUid: targetUid,
        });
        return;
      }

      const inviteId = makeInviteId();
      const seed = Math.floor(Math.random() * 1e9);

      invites.set(inviteId, {
        fromUid: from.uid,
        toUid: targetUid,
        seed,
        createdAt: Date.now(),
      });

      // notify receiver
      io.to(targetSocketId).emit("friend:invite:received", {
        inviteId,
        from: {
          uid: from.uid,
          username: from.username,
          rating: from.rating,
          rank: from.rank,
        },
      });

      // ack sender
      socket.emit("friend:invite:status", {
        ok: true,
        status: "sent",
        inviteId,
        toUid: targetUid,
      });
    } catch (e) {
      console.error("friend:invite error:", e);
      socket.emit("friend:invite:status", { ok: false, error: "server_error" });
    }
  });

  // accept invite => match starts automatically after 5 seconds ✅ (your requirement)
  socket.on("friend:invite:accept", ({ inviteId }) => {
    try {
      const me = socket.player;
      const inv = invites.get(inviteId);

      if (!me?.uid) {
        socket.emit("friend:invite:status", { ok: false, error: "unauthorized" });
        return;
      }
      if (!inv) {
        socket.emit("friend:invite:status", { ok: false, error: "invite_not_found" });
        return;
      }
      if (inv.toUid !== me.uid) {
        socket.emit("friend:invite:status", { ok: false, error: "not_yours" });
        return;
      }

      const fromSocketId = onlineByUid.get(inv.fromUid);
      if (!fromSocketId) {
        socket.emit("friend:invite:status", { ok: false, error: "sender_offline" });
        invites.delete(inviteId);
        return;
      }

      // ✅ always start 5 seconds after ACCEPT (prevents instant start)
      const startAt = Date.now() + 5000;
      const roomId = `friend_${inv.fromUid}_${inv.toUid}_${Date.now()}`;

      // register room so death/forfeit/disconnect works
      rooms.set(roomId, {
        players: [fromSocketId, socket.id],
        playerIds: [
          io.sockets.sockets.get(fromSocketId)?.player?.id || null,
          socket.player?.id || null,
        ],
        startedAt: startAt,
        state: "found",
        seed: inv.seed,
        mode: "friend",
        stats: {},
        hp: {
          [fromSocketId]: 100,
          [socket.id]: 100
        },
      });

      // join sockets into room
      io.sockets.sockets.get(fromSocketId)?.join(roomId);
      socket.join(roomId);

      const fromSock = io.sockets.sockets.get(fromSocketId);
      const p1 = fromSock?.player || { uid: inv.fromUid };
      const p2 = socket.player || { uid: inv.toUid };

      io.to(roomId).emit("matchFound", {
        roomId,
        startAt,
        seed: inv.seed,
        mode: "friend",
        p1: { uid: p1.uid, username: p1.username, rating: p1.rating, rank: p1.rank, socketId: fromSocketId },
        p2: { uid: p2.uid, username: p2.username, rating: p2.rating, rank: p2.rank, socketId: socket.id },
      });

      setTimeout(() => {
        const r = rooms.get(roomId);
        if (!r || r.state === "ended") return;
        r.state = "started";

        io.to(roomId).emit("game:start", {
          roomId,
          startAt: r.startedAt,
          seed: r.seed,
          mode: r.mode,
        });
        io.to(roomId).emit("game:hpInit", { 
          hpMap: r.hp || {}, 
          maxHpMap: { [r.players[0]]: 100, [r.players[1]]: 100 } 
        });
      }, Math.max(0, startAt - Date.now()));

      io.to(fromSocketId).emit("friend:invite:status", {
        ok: true,
        status: "accepted",
        inviteId,
      });

      socket.emit("friend:invite:status", {
        ok: true,
        status: "accepted",
        inviteId,
      });

      invites.delete(inviteId);
    } catch (e) {
      console.error("friend:invite:accept error:", e);
      socket.emit("friend:invite:status", { ok: false, error: "server_error" });
    }
  });

  socket.on("friend:invite:decline", ({ inviteId }) => {
    try {
      const me = socket.player;
      const inv = invites.get(inviteId);
      if (!me?.uid || !inv) return;
      if (inv.toUid !== me.uid) return;

      const fromSocketId = onlineByUid.get(inv.fromUid);
      if (fromSocketId) {
        io.to(fromSocketId).emit("friend:invite:status", {
          ok: true,
          status: "declined",
          inviteId,
        });
      }

      socket.emit("friend:invite:status", { ok: true, status: "declined", inviteId });
      invites.delete(inviteId);
    } catch (e) {
      console.error("friend:invite:decline error:", e);
    }
  });

  /* -------------------- DISCONNECT -------------------- */

  socket.on("disconnect", async () => {
    safeRemoveFromQueue(socket.id);
    if (socket.player?.uid) onlineByUid.delete(socket.player.uid);

    // If player was in ANY active room (ranked or friend), end it.
    try {
      for (const [roomId, r] of rooms.entries()) {
        if (r.state === "ended") continue;
        if (!r.players.includes(socket.id)) continue;

        // Record survival time for disconnecting player
        const survivalMs = Math.max(0, Date.now() - (r.startedAt || Date.now()));
        if (!r.stats) r.stats = {};
        r.stats[socket.id] = { survivalMs };

        // ranked disconnect => loss; friend disconnect => no rank change
        await endRoom({ roomId, loserSid: socket.id, reason: "disconnect" });
      }
    } catch (e) {
      console.error("disconnect room end error:", e);
    }
  });
});

/* -------------------- BOOT -------------------- */

connectDB()
  .then(() => {
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ DB connection failed:", err.message);
    process.exit(1);
  });
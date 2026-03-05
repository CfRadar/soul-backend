const mongoose = require("mongoose");

const PlayerSchema = new mongoose.Schema(
  {
    uid: { type: String, unique: true, index: true }, // secret friend code
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },

    rating: { type: Number, default: 0, min: 0 },

    wins: { type: Number, default: 0, min: 0 },
    losses: { type: Number, default: 0, min: 0 },

    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }],
    friendRequestsIn: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }],
    friendRequestsOut: [{ type: mongoose.Schema.Types.ObjectId, ref: "Player" }],

    // time trial - best survival time in milliseconds
    bestTimeTrialMs: { type: Number, default: 0, min: 0 },

    // quick stats
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// helpful virtuals (not stored)
PlayerSchema.virtual("rank").get(function () {
  const r = Math.max(0, this.rating || 0);
  if (r >= 500) return "legendary";
  if (r >= 400) return "diamond";
  if (r >= 300) return "platinum";
  if (r >= 200) return "gold";
  if (r >= 100) return "silver";
  return "bronze";
});

PlayerSchema.set("toJSON", { virtuals: true });
PlayerSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Player", PlayerSchema);
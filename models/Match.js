const mongoose = require("mongoose");

const MatchSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ["ranked", "friend"], required: true },

    roomId: { type: String, required: true, index: true },

    players: [
      {
        player: { type: mongoose.Schema.Types.ObjectId, ref: "Player", required: true },
        uid: { type: String, required: true },
        username: { type: String, required: true },

        ratingBefore: { type: Number, required: true },
        ratingAfter: { type: Number, required: true },
        delta: { type: Number, required: true },
      },
    ],

    winnerUid: { type: String, required: true },
    loserUid: { type: String, required: true },

    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Match", MatchSchema);
const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("Missing MONGODB_URI in .env");

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    autoIndex: true,
  });

  console.log("✅ MongoDB connected");
}

module.exports = { connectDB };
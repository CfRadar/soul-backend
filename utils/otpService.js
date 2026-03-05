const { callOtpService } = require("./otpAppsScript");

function normalizeEmail(e) {
  const s = String(e || "").trim().toLowerCase();
  return s.includes("@") ? s : "";
}

async function sendOtp(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    // local validation before hitting external service
    return { ok: false, error: "invalid_email" };
  }

  // payload is nested for signing, but include flat fields for compatibility
  return callOtpService("send", { email: normalized }, { email: normalized });
}

async function verifyOtp(email, otp) {
  const normalized = normalizeEmail(email);
  if (!normalized || !otp) {
    return { ok: false, error: "invalid_input" };
  }
  return callOtpService("verify", { email: normalized, otp }, { email: normalized, otp });
}

module.exports = { sendOtp, verifyOtp };
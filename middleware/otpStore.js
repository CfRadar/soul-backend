// email -> { code, expiresAt, attempts }
const store = new Map();

function createOtp(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 2 * 60 * 1000; // 2 min
  store.set(email, { code, expiresAt, attempts: 0 });
  return { code, expiresAt };
}

function verifyOtp(email, code) {
  const row = store.get(email);
  if (!row) return { ok: false, reason: "no_otp" };

  if (Date.now() > row.expiresAt) {
    store.delete(email);
    return { ok: false, reason: "expired" };
  }

  row.attempts += 1;
  if (row.attempts > 5) {
    store.delete(email);
    return { ok: false, reason: "too_many_attempts" };
  }

  if (String(code) !== row.code) {
    return { ok: false, reason: "wrong" };
  }

  store.delete(email);
  return { ok: true };
}

module.exports = { createOtp, verifyOtp };
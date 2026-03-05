const crypto = require("crypto");

// match Apps Script: base64 HMAC of JSON payload
function signPayload(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload))
    .digest("base64");
}

async function callOtpService(action, payload, extraFields = {}) {
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.OTP_SHARED_SECRET;
  if (!url) throw new Error("Missing APPS_SCRIPT_URL");
  if (!secret) throw new Error("Missing OTP_SHARED_SECRET");

  const sig = signPayload(payload, secret);
  // build body object; merge extraFields after payload so caller can inject flat properties
  const bodyObj = { action, payload, sig, ...extraFields };
  const body = JSON.stringify(bodyObj);

  console.log("📤 OTP Service Request:");
  console.log("  URL:", url);
  console.log("  Action:", action);
  console.log("  Payload:", JSON.stringify(payload));
  if (Object.keys(extraFields).length) {
    console.log("  Extra fields:", JSON.stringify(extraFields));
  }
  console.log("  Signature:", sig);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    console.error("OTP service response status", res.status, res.statusText);
    console.error("OTP service response body", text);
    throw new Error(`OTP service returned ${res.status}: ${res.statusText}`);
  }

  const data = await res.json().catch((err) => {
    throw new Error(`Failed to parse OTP service response: ${err.message}`);
  });

  if (!data || !data.ok) {
    throw new Error(data ? data.error || "OTP service error" : "Bad response from OTP service");
  }
  return data;
}

module.exports = { callOtpService };
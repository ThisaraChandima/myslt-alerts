// myslt-bot: Cloudflare Worker that responds to WhatsApp messages with SLT data usage.
// Send "check", "usage", or "data" to your WhatsApp and get back a beautiful report.

const API = "https://omniscapp.slt.lk/slt/ext/api";
const CLIENT_ID = "b7402e9d66808f762ccedbe42c20668e";

// ── Progress bar & status helpers ──

function progressBar(pct, width = 10) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}

function statusEmoji(remaining, limit) {
  const pct = (remaining / limit) * 100;
  if (pct <= 10) return "🔴";
  if (pct <= 25) return "🟠";
  if (pct <= 50) return "🟡";
  return "🟢";
}

// ── SLT API ──

async function sltFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`SLT API error: ${res.status}`);
  return res.json();
}

async function login(username, password) {
  const body = new URLSearchParams({ username, password, channelID: "WEB" });
  const json = await sltFetch(`${API}/Account/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-IBM-Client-Id": CLIENT_ID },
    body,
  });
  if (!json.accessToken) throw new Error("Login failed");
  return json.accessToken;
}

function parseBucket(raw) {
  if (!raw || raw.limit == null) return null;
  const limit = parseFloat(raw.limit);
  const used = parseFloat(raw.used);
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return null;
  return { name: raw.name || null, expiry: raw.expiry_date || null, limit, used, remaining: +(limit - used).toFixed(2), unit: raw.volume_unit || "GB" };
}

async function getUsage(token, subscriberId) {
  const json = await sltFetch(`${API}/BBVAS/UsageSummary?subscriberID=${subscriberId}`, {
    headers: { Authorization: `Bearer ${token}`, "X-IBM-Client-Id": CLIENT_ID },
  });
  if (!json.isSuccess) throw new Error("Usage fetch failed");

  const b = json.dataBundle || {};
  const info = b.my_package_info || {};
  const details = info.usageDetails || [];
  const standardBucket = details.find(d => d.name && d.name.includes("Standard")) || b.my_package_summary;

  // Fetch individual add-on details
  let vasDetails = [];
  try {
    const vasJson = await sltFetch(`${API}/BBVAS/GetDashboardVASBundles?subscriberID=${subscriberId}`, {
      headers: { Authorization: `Bearer ${token}`, "X-IBM-Client-Id": CLIENT_ID },
    });
    if (vasJson.isSuccess && vasJson.dataBundle && vasJson.dataBundle.usageDetails) {
      vasDetails = vasJson.dataBundle.usageDetails.map(parseBucket).filter(Boolean);
    }
  } catch (e) { /* ignore */ }

  return {
    ...parseBucket(standardBucket),
    addon: parseBucket(b.vas_data_summary),
    bonus: parseBucket(b.bonus_data_summary),
    free: parseBucket(b.free_data_summary),
    extra: parseBucket(b.extra_gb_data_summary),
    packageName: info.package_name || null,
    expiry: (details[0] || {}).expiry_date || null,
    reportedTime: b.reported_time || info.reported_time || null,
    details,
    vasDetails,
  };
}

// ── Beautiful message ──

function formatMessage(u) {
  const { limit, used, remaining, unit } = u;
  const pct = Math.round((remaining / limit) * 100);
  const lines = [];

  lines.push("╔══════════════════════╗");
  lines.push("║  📡 *SLT Data Report*  ║");
  lines.push("╚══════════════════════╝");

  if (u.packageName) lines.push(`📋 *${u.packageName}*`);
  if (u.reportedTime) lines.push(`🕐 ${u.reportedTime}`);
  lines.push("");

  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`${statusEmoji(remaining, limit)} *Standard Package*`);
  lines.push(`   ${progressBar(pct)} ${pct}%`);
  lines.push(`   📊 ${remaining} ${unit} left of ${limit} ${unit}`);
  lines.push(`   📈 Used: ${used} ${unit}`);
  if (u.expiry) lines.push(`   📅 Resets: ${u.expiry}`);

  if (u.details && u.details.length > 0) {
    lines.push("");
    lines.push("┈┈┈ 📦 *Package Breakdown* ┈┈┈");
    u.details.forEach(d => {
      if (!d.name || !d.limit) return;
      const dLimit = parseFloat(d.limit);
      const dRemaining = parseFloat(d.remaining);
      const dPct = Math.round((dRemaining / dLimit) * 100);
      lines.push(`   ${statusEmoji(dRemaining, dLimit)} ${d.name.replace(/\.$/, "")}`);
      lines.push(`      ${progressBar(dPct, 8)} ${dPct}%`);
      lines.push(`      ${dRemaining} / ${dLimit} ${d.volume_unit}${d.expiry_date ? `  ⏳ ${d.expiry_date}` : ""}`);
    });
  }

  if (u.vasDetails && u.vasDetails.length > 0) {
    lines.push("");
    lines.push("┈┈┈ 🎮 *Add-Ons* ┈┈┈");
    u.vasDetails.forEach(d => {
      if (!d.name || !d.limit) return;
      const dPct = Math.round((d.remaining / d.limit) * 100);
      lines.push(`   ${statusEmoji(d.remaining, d.limit)} ${d.name.replace(/\.$/, "")}`);
      lines.push(`      ${progressBar(dPct, 8)} ${dPct}%`);
      lines.push(`      ${d.remaining} / ${d.limit} ${d.unit}${d.expiry ? `  ⏳ ${d.expiry}` : ""}`);
    });
  }

  const extras = [];
  if (u.bonus && u.bonus.remaining > 0) extras.push({ label: "🎁 Bonus", ...u.bonus });
  if (u.free && u.free.remaining > 0) extras.push({ label: "🆓 Free", ...u.free });
  if (u.extra && u.extra.remaining > 0) extras.push({ label: "📦 Extra", ...u.extra });
  if (extras.length > 0) {
    lines.push("");
    lines.push("┈┈┈ 🎁 *Other Data* ┈┈┈");
    extras.forEach(e => {
      const ePct = Math.round((e.remaining / e.limit) * 100);
      lines.push(`   ${e.label}: ${e.remaining}/${e.limit} ${e.unit} ${progressBar(ePct, 6)}`);
    });
  }

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("⚡ _Powered by myslt-alerts_");

  return lines.join("\n");
}

// ── Green API send ──

async function sendWhatsApp(env, chatId, message) {
  const base = env.GREENAPI_API_URL.replace(/\/+$/, "");
  const url = `${base}/waInstance${env.GREENAPI_ID_INSTANCE}/sendMessage/${env.GREENAPI_API_TOKEN}`;
  const cid = chatId.includes("@") ? chatId : `${chatId}@c.us`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: cid, message }),
  });
  if (!res.ok) throw new Error("WhatsApp send failed: " + await res.text());
}

// ── Cloudflare Worker entry ──

const TRIGGER_WORDS = ["check", "usage", "data", "slt", "balance", "remaining"];

export default {
  // Background cron check
  async scheduled(event, env, ctx) {
    try {
      const token = await login(env.SLT_USERNAME, env.SLT_PASSWORD);
      const usage = await getUsage(token, env.SLT_SUBSCRIBER_ID);

      const exhausted = [];
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${now.getMonth() + 1}`; // e.g. "2026-8"

      // Check standard bucket
      if (usage.remaining <= 0) exhausted.push({ id: "standard", name: "Standard Package" });
      
      // Check add-ons
      if (usage.details) {
        usage.details.forEach(d => {
          if (d.name && parseFloat(d.remaining) <= 0) exhausted.push({ id: d.name, name: d.name.replace(/\.$/, "") });
        });
      }
      if (usage.vasDetails) {
        usage.vasDetails.forEach(d => {
          if (d.name && d.remaining <= 0) exhausted.push({ id: d.name, name: d.name.replace(/\.$/, "") });
        });
      }

      // If any packages are fully empty
      for (const pkg of exhausted) {
        // Construct a safe KV key
        const kvKey = `alert_${currentMonth}_${pkg.id.replace(/\s+/g, "_")}`;
        const hasAlerted = await env.SLT_STATE.get(kvKey);

        if (!hasAlerted) {
          // Send urgent alert to WhatsApp!
          const alertMsg = `🚨 *SLT DATA EXHAUSTED* 🚨\n\nYour *${pkg.name}* has completely run out of data!\n\n_Reply with "check" for a full data report._`;
          // We need to use env.GREENAPI_CHAT_ID (or hardcoded number since the user only has one contact allowed)
          const cid = env.GREENAPI_CHAT_ID || "94765525508";
          await sendWhatsApp(env, cid, alertMsg);
          
          // Save state so we don't spam the user every hour
          await env.SLT_STATE.put(kvKey, "true", { expirationTtl: 30 * 24 * 60 * 60 }); // expires in 30 days
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } catch (err) {
      console.error("Scheduled check failed:", err.message || err);
    }
  },

  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("myslt-bot is running! Send 'check' on WhatsApp to get your data usage.", { status: 200 });
    }

    try {
      const emailReq = request.clone();
      const body = await request.json();

      // Forward webhook to uni-mail-whatsapp bot asynchronously via Service Binding
      if (env.EMAIL_BOT) {
        ctx.waitUntil(env.EMAIL_BOT.fetch(emailReq).catch(e => console.error("Forwarding failed", e)));
      }

      // Green API webhook sends different types of notifications.
      // We only care about incoming text messages.
      const type = body.typeWebhook;
      if (type !== "incomingMessageReceived") {
        return new Response("OK", { status: 200 });
      }

      const msgData = body.messageData;
      if (!msgData || msgData.typeMessage !== "textMessage") {
        return new Response("OK", { status: 200 });
      }

      const text = (msgData.textMessageData?.textMessage || "").trim().toLowerCase();
      const senderChatId = body.senderData?.chatId || "";

      // Only respond to trigger words
      if (!TRIGGER_WORDS.some(w => text.includes(w))) {
        return new Response("OK", { status: 200 });
      }

      // Fetch SLT usage and send back
      const token = await login(env.SLT_USERNAME, env.SLT_PASSWORD);
      const usage = await getUsage(token, env.SLT_SUBSCRIBER_ID);
      const message = formatMessage(usage);
      await sendWhatsApp(env, senderChatId, message);

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Error:", err.message || err);
      return new Response("Error: " + (err.message || "unknown"), { status: 500 });
    }
  },
};

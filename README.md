# MySLT WhatsApp Bot 📡

A Cloudflare Worker that integrates with Green API to bring your Sri Lanka Telecom (SLT) broadband usage right into your WhatsApp chat.

## Features

### 1. On-Demand Data Reports
Send any of the following trigger words to your bot on WhatsApp:
- `check`
- `usage`
- `data`
- `slt`
- `balance`
- `remaining`

The bot will instantly securely log in to your MySLT account and generate a beautifully formatted report showing your Standard Package, Add-ons (VAS), Bonus data, Free data, and Extra data with progress bars and expiry dates.

### 2. Automatic Background Alerts (NEW)
The bot runs a background cron job every hour (`0 * * * *`) to monitor your data usage silently. 
If **any** package hits exactly `0` remaining, it will proactively send you a WhatsApp alert.
- Uses Cloudflare KV Storage (`SLT_STATE`) to remember when it has alerted you, preventing hourly spam once a package is exhausted.

### 3. Integrated Architecture
Green API only supports setting a single webhook URL per instance. This bot serves as the main entry point and asynchronously forwards webhook events via Cloudflare Service Bindings to the `uni-mail-whatsapp` bot, allowing both services to run simultaneously on the same WhatsApp number without conflicts.

## Deployment

Deploy using Wrangler:

```bash
npx wrangler deploy
```

Ensure your `wrangler.toml` is configured with the following bindings:
- `EMAIL_BOT`: Service binding to `uni-mail-whatsapp`.
- `SLT_STATE`: KV Namespace binding.

Environment variables (Secrets):
- `SLT_USERNAME`
- `SLT_PASSWORD`
- `SLT_SUBSCRIBER_ID`
- `GREENAPI_API_URL`
- `GREENAPI_ID_INSTANCE`
- `GREENAPI_API_TOKEN`
- `GREENAPI_CHAT_ID`

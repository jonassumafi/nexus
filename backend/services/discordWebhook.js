// Discord webhook dispatch — fire-and-forget. Webhook failures must never
// crash or propagate; the only guarantee here is that a non-2xx is logged.

const WEBHOOK_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\//i;

function isValidWebhookUrl(url) {
  return typeof url === 'string' && WEBHOOK_RE.test(url);
}

async function sendWebhook(webhookUrl, embedPayload) {
  if (!isValidWebhookUrl(webhookUrl)) return { ok: false, reason: 'invalid_url' };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embedPayload] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[DiscordWebhook] ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
      return { ok: false, status: res.status, body };
    }
    return { ok: true };
  } catch (err) {
    console.error('[DiscordWebhook] dispatch failed:', err.message);
    return { ok: false, reason: 'network', error: err.message };
  }
}

module.exports = { sendWebhook, isValidWebhookUrl };

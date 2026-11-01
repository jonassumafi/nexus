// Thin wrapper over sendWebhook + discordEmbeds. All event triggers in
// route handlers call dispatch('<eventName>', payload). URL is pulled from
// NEXUS_DISCORD_WEBHOOK_URL at call time so toggling the env var takes
// effect without a restart of any downstream consumer.

const { sendWebhook } = require('./discordWebhook');
const embeds = require('./discordEmbeds');

function dispatch(eventName, payload = {}) {
  const url = process.env.NEXUS_DISCORD_WEBHOOK_URL;
  if (!url) return;
  const builder = embeds[eventName];
  if (!builder) {
    console.error(`[NexusDispatch] unknown event: ${eventName}`);
    return;
  }
  // Fire-and-forget — never await; webhook latency must not block the
  // caller's response.
  sendWebhook(url, builder(payload)).catch(err =>
    console.error(`[NexusDispatch] ${eventName} failed:`, err.message)
  );
}

module.exports = { dispatch };

// POST /bug-report — accepts a short description + up to 3 screenshots
// from an authenticated operator and emails the bundle to the admin
// address configured in .env via Resend's REST API.
//
// Deliberately no npm dep on the resend package — just native fetch.
// Keeps the install lightweight and transparent about what's sent.

const express = require('express');
const { isAuthenticated } = require('../middleware/permissions');

const router = express.Router();

const MAX_SCREENSHOTS = 3;
const MAX_BYTES_PER_IMAGE = 3 * 1024 * 1024;   // 3 MB
const MAX_DESC_CHARS      = 600;               // ~50 words soft target

router.post('/', isAuthenticated, express.json({ limit: '12mb' }), async (req, res) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const to     = process.env.BUG_REPORT_TO;
    const from   = process.env.BUG_REPORT_FROM || 'Nexus Bug Reports <onboarding@resend.dev>';

    if (!apiKey || !to) {
      return res.status(500).json({ error: 'bug-report email is not configured on the server' });
    }

    const description = String(req.body?.description || '').trim();
    const screenshots = Array.isArray(req.body?.screenshots) ? req.body.screenshots : [];

    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }
    if (description.length > MAX_DESC_CHARS) {
      return res.status(400).json({ error: `description must be ${MAX_DESC_CHARS} characters or fewer` });
    }
    if (screenshots.length > MAX_SCREENSHOTS) {
      return res.status(400).json({ error: `at most ${MAX_SCREENSHOTS} screenshots allowed` });
    }

    // Each screenshot is expected as a data: URL from the browser.
    // Decode to base64 bytes + MIME type for Resend's attachments field.
    const attachments = [];
    for (let i = 0; i < screenshots.length; i++) {
      const raw = String(screenshots[i] || '');
      const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(raw);
      if (!match) continue;
      const mime = match[1];
      const b64  = match[2];
      const byteLen = Math.ceil((b64.length * 3) / 4);
      if (byteLen > MAX_BYTES_PER_IMAGE) {
        return res.status(400).json({ error: `screenshot ${i + 1} exceeds ${MAX_BYTES_PER_IMAGE} bytes` });
      }
      const ext = mime.split('/')[1] || 'png';
      attachments.push({
        filename: `screenshot-${i + 1}.${ext}`,
        content: b64,            // Resend accepts base64 strings directly
        content_type: mime,
      });
    }

    const u = req.user || {};
    const subject = `[Nexus Bug] ${u.citizen_name || u.username || 'unknown'} — ${description.slice(0, 60)}`;
    const bodyText = [
      `Reporter : ${u.citizen_name || u.username || '—'}`,
      `Discord  : ${u.discord_id || '—'}`,
      `User ID  : ${u._id || '—'}`,
      `UA       : ${req.get('user-agent') || '—'}`,
      `Origin   : ${req.get('origin') || req.get('referer') || '—'}`,
      `Time     : ${new Date().toISOString()}`,
      '',
      '--- Description ---',
      description,
      '',
      `Attachments: ${attachments.length}`,
    ].join('\n');

    const bodyHtml = `
      <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;">
        <p><strong>Reporter:</strong> ${escapeHtml(u.citizen_name || u.username || '—')}<br>
           <strong>Discord:</strong> ${escapeHtml(String(u.discord_id || '—'))}<br>
           <strong>User ID:</strong> ${escapeHtml(String(u._id || '—'))}<br>
           <strong>User agent:</strong> ${escapeHtml(req.get('user-agent') || '—')}<br>
           <strong>Origin:</strong> ${escapeHtml(req.get('origin') || req.get('referer') || '—')}<br>
           <strong>Time:</strong> ${new Date().toISOString()}</p>
        <hr>
        <p style="white-space:pre-wrap;">${escapeHtml(description)}</p>
        <hr>
        <p style="color:#666;font-size:12px;">Attachments: ${attachments.length}</p>
      </div>`;

    const resendPayload = {
      from, to,
      subject,
      text: bodyText,
      html: bodyHtml,
      attachments,
    };

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[bug-report] Resend error', resp.status, text);
      return res.status(502).json({ error: 'email delivery failed' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[bug-report] crash:', err);
    res.status(500).json({ error: err.message });
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = router;

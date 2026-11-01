const express = require('express');
const crypto = require('crypto');
const Mission = require('../models/Mission');
const Ship = require('../models/Ship');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/permissions');
const radioModels = require('../services/radioModels');

const router = express.Router();

// ── Radio-model catalog ─────────────────────────────────────────────────
router.get('/models', isAuthenticated, (req, res) => {
  res.json(radioModels.pickerList().map(r => ({
    ...r,
    spec: radioModels.byId(r.id)?.spec,
  })));
});

// ── Player's own radio ──────────────────────────────────────────────────
// If the user hasn't been assigned one yet, randomly pick + persist.
router.get('/my-radio', isAuthenticated, async (req, res) => {
  try {
    let u = await User.findById(req.user._id);
    if (!u) return res.status(404).json({ error: 'user not found' });
    if (!u.radio_type || !radioModels.byId(u.radio_type)) {
      u.radio_type = radioModels.randomRadio();
      await u.save();
    }
    const entry = radioModels.byId(u.radio_type);
    res.json({
      radio_type: u.radio_type,
      radio: entry ? { ...entry } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Player-facing: request a radio re-roll from the admin. Fires an
// email via Resend to BUG_REPORT_TO (same channel as bug reports) so
// the admin can respond via the admin UI. Rate-limited to one request
// per user per hour to prevent spam.
const rerollRequests = new Map(); // userId → ts

router.post('/request-reroll', isAuthenticated, async (req, res) => {
  try {
    const uid = String(req.user._id);
    const now = Date.now();
    const last = rerollRequests.get(uid) || 0;
    if (now - last < 60 * 60 * 1000) {
      return res.status(429).json({ error: 'already requested recently' });
    }
    rerollRequests.set(uid, now);

    const apiKey = process.env.RESEND_API_KEY;
    const to     = process.env.BUG_REPORT_TO;
    const from   = process.env.BUG_REPORT_FROM || 'Nexus Radio <onboarding@resend.dev>';
    if (!apiKey || !to) {
      // Delivery not configured; still record the request so UI can
      // show "sent" and admin can see it later via logs.
      console.log('[reroll request]', req.user.citizen_name, 'rig:', req.user.radio_type);
      return res.json({ ok: true, delivered: false });
    }

    const reason = String(req.body?.reason || '').slice(0, 400);
    const currentRadio = radioModels.byId(req.user.radio_type);
    const subject = `[Nexus Rig] ${req.user.citizen_name || req.user.username || 'operator'} requests a re-roll`;
    const bodyText = [
      `Reporter    : ${req.user.citizen_name || req.user.username || '—'}`,
      `Discord     : ${req.user.discord_id || '—'}`,
      `User ID     : ${req.user._id}`,
      `Current rig : ${req.user.radio_type || '—'} (${currentRadio?.label || 'unknown'})`,
      `Band        : ${currentRadio?.band || '—'}`,
      '',
      '--- Reason ---',
      reason || '(no reason given)',
      '',
      `Approve by hitting PUT /api/radio/user/${req.user._id}/radio with { reroll: true } or a specific radio_type, or use the Admin panel.`,
    ].join('\n');

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text: bodyText }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[reroll request] Resend error', resp.status, text);
      return res.status(502).json({ error: 'email delivery failed' });
    }
    res.json({ ok: true, delivered: true });
  } catch (err) {
    console.error('[reroll request] crash:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin / platform-owner only: force a specific radio onto a player, or
// `{ reroll: true }` to randomly re-assign.
router.put('/user/:userId/radio', isAuthenticated, async (req, res) => {
  try {
    if (!req.user.is_platform_owner) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const u = await User.findById(req.params.userId);
    if (!u) return res.status(404).json({ error: 'user not found' });

    if (req.body?.reroll) {
      u.radio_type = radioModels.randomRadio();
    } else {
      const next = String(req.body?.radio_type || '');
      if (!radioModels.byId(next)) {
        return res.status(400).json({ error: 'unknown radio_type' });
      }
      u.radio_type = next;
    }
    await u.save();
    res.json({ radio_type: u.radio_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radio/turn-credentials
router.get('/turn-credentials', isAuthenticated, (req, res) => {
  try {
    const secret = process.env.TURN_SECRET;
    if (!secret) return res.status(500).json({ error: 'TURN_SECRET not configured' });

    const ttl = 86400;
    const timestamp = Math.floor(Date.now() / 1000) + ttl;
    const username = `${timestamp}:${req.user.discord_id}`;
    const credential = crypto
      .createHmac('sha1', secret)
      .update(username)
      .digest('base64');

    const turnServer = process.env.TURN_SERVER;
    const turnsServer = turnServer.replace('turn:', 'turns:').replace('3478', '5349');

    res.json({ urls: [turnServer, turnsServer], username, credential, ttl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radio/frequency/:missionId
// Returns mission frequency only if the requesting user has a reserved crew slot.
router.get('/frequency/:missionId', isAuthenticated, async (req, res) => {
  try {
    const mission = await Mission.findById(req.params.missionId);
    if (!mission) return res.status(404).json({ error: 'Mission not found' });

    const ships = await Ship.find({ current_mission_id: mission._id });

    const userId = req.user._id.toString();
    const discordId = req.user.discord_id;

    let hasAccess = false;
    outer: for (const ship of ships) {
      for (const roleData of Object.values(ship.crew_roles || {})) {
        for (const id of roleData.filled || []) {
          const s = String(id);
          if (s === userId || s === discordId) {
            hasAccess = true;
            break outer;
          }
        }
      }
    }

    if (!hasAccess) {
      return res.status(403).json({ error: 'ACCESS DENIED — CREW ONLY' });
    }

    res.json({ frequency: mission.frequency });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

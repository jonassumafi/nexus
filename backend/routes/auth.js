const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/permissions');
const { dispatch } = require('../services/nexusDispatch');

const router = express.Router();

// Domain-aware OAuth redirect URI. Derived from the request origin, then
// normalized so www. and apex hostnames collapse to a single canonical
// URI. This way we only have to register ONE URI per hostname in Discord's
// developer portal, and friends who happen to type www. instead of apex
// (or vice-versa) still get a working OAuth round-trip.
//
// Normalization rules:
//   • Scheme forced to https
//   • Leading "www." stripped from the host
//   • If the resulting canonical host is in our known-mapped-domains set,
//     we also allow a hard override via env (DISCORD_REDIRECT_URI) for
//     localhost / staging deployments.
function discordRedirectUri(req) {
  const explicitOrigin = req.get('origin');
  const originHost = (() => {
    try { return explicitOrigin ? new URL(explicitOrigin).host : null; } catch { return null; }
  })();
  const headerHost = req.get('x-forwarded-host') || req.get('host');
  let host = originHost || headerHost;
  if (!host) return process.env.DISCORD_REDIRECT_URI;
  // Strip www. prefix so Discord only needs one registered redirect per
  // domain. e.g. "www.nexus-missions.space" → "nexus-missions.space".
  if (host.startsWith('www.')) host = host.slice(4);
  // Localhost dev stays HTTP; everything else is forced HTTPS so Discord
  // doesn't reject a mixed scheme in production.
  const scheme = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${scheme}://${host}/auth/discord/callback`;
}

router.get('/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: discordRedirectUri(req),
    response_type: 'code',
    scope: 'identify',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

// Frontend POSTs the ?code= it received from Discord
router.post('/discord/callback', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: discordRedirectUri(req),
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;

    const profileRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const { id: discord_id, username, avatar } = profileRes.data;

    let user = await User.findOne({ discord_id });
    if (!user) {
      user = await User.create({
        discord_id,
        username,
        avatar,
        is_platform_owner: discord_id === process.env.PLATFORM_OWNER_DISCORD_ID,
      });
    } else {
      user.username = username;
      // Preserve onboarding-generated portrait URLs — only overwrite the
      // avatar if the current stored value is empty or is still a raw
      // Discord hash (i.e. not a full URL from a portrait upload).
      if (!user.avatar || !/^(https?:|data:)/i.test(user.avatar)) {
        user.avatar = avatar;
      }
      await user.save();
    }

    // 180-day expiration — the companion is a "install once, open
    // whenever you play" desktop app, not a security-sensitive web
    // session. Players shouldn't have to re-authenticate with Discord
    // for roughly six months after their initial login. Was 7d, then
    // 30d, now 180d.
    const token = jwt.sign(
      { id: user._id, discord_id: user.discord_id, username: user.username, onboarding_complete: user.onboarding_complete },
      process.env.JWT_SECRET,
      { expiresIn: '180d' }
    );

    dispatch('operatorOnline', {
      operatorName: user.citizen_name || user.username,
      rank: user.rp_rank?.title,
    });

    res.json({ token });
  } catch (err) {
    console.error('[Auth] Discord callback error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

router.get('/me', isAuthenticated, (req, res) => {
  res.json(req.user);
});

router.post('/logout', isAuthenticated, (req, res) => {
  dispatch('operatorOffline', {
    operatorName: req.user.citizen_name || req.user.username,
    rank: req.user.rp_rank?.title,
  });
  res.json({ success: true });
});

module.exports = router;

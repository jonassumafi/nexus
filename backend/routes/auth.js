const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/permissions');
const { dispatch } = require('../services/nexusDispatch');

const router = express.Router();

// Domain-aware OAuth redirect URI. Derived from the request's Origin header
// (set by the browser) or the forwarded-proto + host pair (set by cloudflared).
// Falls back to env for direct localhost calls during development. This lets
// the same backend serve multiple public hostnames (nexus.app-palette.com and
// nexus-missions.space, in our case) without env-level reconfiguration — the
// redirect URI Discord sees matches whichever domain the user actually came
// from, which Discord requires for the token exchange.
function discordRedirectUri(req) {
  const explicitOrigin = req.get('origin');
  if (explicitOrigin) return `${explicitOrigin}/auth/discord/callback`;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host  = req.get('x-forwarded-host')  || req.get('host');
  if (host) return `${proto}://${host}/auth/discord/callback`;
  return process.env.DISCORD_REDIRECT_URI;
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

    const token = jwt.sign(
      { id: user._id, discord_id: user.discord_id, username: user.username, onboarding_complete: user.onboarding_complete },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
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

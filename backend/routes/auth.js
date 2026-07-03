const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { isAuthenticated } = require('../middleware/permissions');

const router = express.Router();

router.get('/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
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
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
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
      user.avatar = avatar;
      await user.save();
    }

    const token = jwt.sign(
      { id: user._id, discord_id: user.discord_id, username: user.username, onboarding_complete: user.onboarding_complete },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token });
  } catch (err) {
    console.error('[Auth] Discord callback error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

router.get('/me', isAuthenticated, (req, res) => {
  res.json(req.user);
});

router.post('/logout', (req, res) => {
  res.json({ success: true });
});

module.exports = router;

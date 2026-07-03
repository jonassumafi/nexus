const express = require('express');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { GoogleGenAI, Modality } = require('@google/genai');
const User = require('../models/User');
const Organization = require('../models/Organization');
const PlatformConfig = require('../models/PlatformConfig');
const { isAuthenticated } = require('../middleware/permissions');
const { uploadPortrait, uploadPortraitFromBase64 } = require('../services/cloudinaryService');
const { fetchLeaderboardPage } = require('../services/rpService');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../uploads/') });

router.get('/leaderboard', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 20;
    const data = await fetchLeaderboardPage(page, perPage);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const VOICE_RANGES = {
  highpass:       [200,   500   ],
  lowpass:        [2500,  4000  ],
  resonance_freq: [1000,  2000  ],
  resonance_q:    [1.5,   4.5   ],
  distortion:     [5,     30    ],
  static_level:   [0.003, 0.012 ],
  pitch_shift:    [-1.5,  1.5   ],
  bit_crush:      [10,    16    ],
};

router.get('/voice-profile', isAuthenticated, async (req, res) => {
  try {
    const vp = req.user.voice_profile || {};
    // Check only the core 6 fields — pitch_shift and bit_crush have non-null
    // schema defaults so including them would suppress needs_generation for
    // users who haven't set a voice profile yet.
    const coreFields = ['highpass', 'lowpass', 'resonance_freq', 'resonance_q', 'distortion', 'static_level'];
    const allNull = coreFields.every(f => vp[f] == null);
    if (allNull) return res.json({ needs_generation: true });
    res.json(vp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/voice-profile', isAuthenticated, async (req, res) => {
  try {
    const fields = ['highpass', 'lowpass', 'resonance_freq', 'resonance_q', 'distortion', 'static_level', 'pitch_shift', 'bit_crush'];
    const updates = {};
    for (const f of fields) {
      const val = req.body[f];
      if (val == null) continue;
      const n = Number(val);
      if (isNaN(n)) return res.status(400).json({ error: `${f} must be a number` });
      const [min, max] = VOICE_RANGES[f];
      if (n < min || n > max) return res.status(400).json({ error: `${f} out of range (${min}–${max})` });
      updates[`voice_profile.${f}`] = n;
    }

    // ptt_key is a string preference (single character), not a number in a range
    if (req.body.ptt_key != null) {
      const k = String(req.body.ptt_key);
      if (k.length === 0 || k.length > 32) {
        return res.status(400).json({ error: 'ptt_key must be 1–32 characters' });
      }
      updates['voice_profile.ptt_key'] = k;
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true });
    res.json(user.voice_profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('org_id');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    if (req.user._id.toString() !== req.params.id && !req.user.is_platform_owner) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const allowed = ['citizen_name', 'place_of_birth', 'citizenship', 'biography', 'profile_url', 'is_freelancer'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/portrait', isAuthenticated, upload.single('portrait'), async (req, res) => {
  try {
    if (req.user._id.toString() !== req.params.id && !req.user.is_platform_owner) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const url = await uploadPortrait(req.params.id, req.file.path);
    await User.findByIdAndUpdate(req.params.id, { avatar: url });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/complete-onboarding', isAuthenticated, async (req, res) => {
  try {
    if (req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const config = await PlatformConfig.findOne();
    const startRank = config ? config.rp_ranks[0] : null;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { onboarding_complete: true, rp_rank: startRank },
      { new: true }
    );
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/onboarding', isAuthenticated, async (req, res) => {
  try {
    if (req.user.onboarding_complete) {
      return res.status(400).json({ error: 'Already onboarded' });
    }

    const { citizen_name, place_of_birth, citizenship, biography, portrait_url, org_invite_code } = req.body;

    const config = await PlatformConfig.findOne();
    const startRank = config ? config.rp_ranks[0] : null;

    const updates = {
      citizen_name,
      place_of_birth,
      citizenship,
      biography,
      onboarding_complete: true,
      rp_rank: startRank,
    };

    if (portrait_url) updates.avatar = portrait_url;

    if (org_invite_code) {
      const org = await Organization.findOne({ invite_code: org_invite_code.toUpperCase() });
      if (!org) return res.status(400).json({ error: 'Invalid invite code' });
      updates.org_id = org._id;
      updates.is_freelancer = false;
      await Organization.findByIdAndUpdate(org._id, { $inc: { member_count: 1 } });
    } else {
      updates.org_id = null;
      updates.is_freelancer = true;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });

    const token = jwt.sign(
      { id: user._id, discord_id: user.discord_id, username: user.username, onboarding_complete: true },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refine-biography', isAuthenticated, async (req, res) => {
  try {
    const { raw_biography } = req.body;
    if (!raw_biography) return res.status(400).json({ error: 'raw_biography required' });

    const systemPrompt = `Using the player's provided description of their character, generate a professional, stylistically sound, and grammatically complete two-sentence biography written for a science fiction futuristic context. The biography should feel grounded in the Star Citizen universe — referencing UEE society, space travel, corporate planets, frontier life, or other relevant lore where appropriate. Do not invent specific named events or characters not mentioned by the player. Do not use em dashes or colons. Return only the biography text, no preamble, no labels.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const geminiRes = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\nCharacter description: ' + raw_biography }] }],
    });

    const refined_biography = geminiRes.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!refined_biography) throw new Error('No text returned from Gemini');

    res.json({ refined_biography });
  } catch (err) {
    console.error('[Refine Biography] Gemini error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.post('/refine-text', isAuthenticated, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });

    const systemPrompt = `Using the provided text, generate a professional, stylistically sound, and grammatically complete narrative written for a science fiction futuristic context. The text should feel grounded in the Star Citizen universe — referencing UEE society, space travel, corporate planets, frontier life, ship histories, or other relevant lore where appropriate. The output should match roughly the length and depth of the source text and must not exceed 1000 characters. Do not invent specific named events or characters not mentioned by the player. Do not use em dashes or colons. Return only the narrative text, no preamble, no labels.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const geminiRes = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\nSource text: ' + text }] }],
    });

    const refined_text = geminiRes.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!refined_text) throw new Error('No text returned from Gemini');

    res.json({ refined_text });
  } catch (err) {
    console.error('[Refine Text] Gemini error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

router.post('/generate-portrait', isAuthenticated, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: 'description required' });

    const prompt = `Generate a science fiction character portrait for a Star Citizen-style space opera game. The character is a crew member or independent operator. Style: cinematic, dramatic lighting, detailed, realistic. Character description: ${description}. Return a single portrait image, head and shoulders, dark space background.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData);
    if (!imagePart) throw new Error('No image returned from Gemini');

    const { data: base64Data, mimeType } = imagePart.inlineData;
    const portrait_url = await uploadPortraitFromBase64(req.user.discord_id, base64Data, mimeType);

    res.json({ portrait_url });
  } catch (err) {
    console.error('[Portrait] Gemini error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

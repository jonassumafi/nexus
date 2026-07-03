const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Organization = require('../models/Organization');
const User = require('../models/User');
const Ship = require('../models/Ship');
const { isAuthenticated, isOrgCommander } = require('../middleware/permissions');

const router = express.Router();

router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { name, prefix } = req.body;
    if (!name || !prefix) return res.status(400).json({ error: 'name and prefix required' });

    const invite_code = uuidv4().replace(/-/g, '').substring(0, 6).toUpperCase();
    const org = await Organization.create({
      name,
      prefix: prefix.toUpperCase(),
      invite_code,
      commander_id: req.user._id,
      member_count: 1,
    });

    await User.findByIdAndUpdate(req.user._id, {
      org_id: org._id,
      is_org_commander: true,
    });

    res.status(201).json(org);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Organization name already taken' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const orgs = await Organization.find().populate('commander_id', 'username discord_id');
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id).populate('commander_id', 'username discord_id citizen_name');
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/join', isAuthenticated, async (req, res) => {
  try {
    const { invite_code } = req.body;
    if (!invite_code) return res.status(400).json({ error: 'invite_code required' });

    const org = await Organization.findOne({ invite_code });
    if (!org) return res.status(404).json({ error: 'Invalid invite code' });

    if (req.user.org_id) return res.status(409).json({ error: 'Already in an organization' });

    await User.findByIdAndUpdate(req.user._id, { org_id: org._id });
    await Organization.findByIdAndUpdate(org._id, { $inc: { member_count: 1 } });

    res.json({ success: true, org });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/members', isAuthenticated, async (req, res) => {
  try {
    const members = await User.find({ org_id: req.params.id })
      .select('username discord_id citizen_name avatar total_rp rp_rank is_org_commander');
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/ships', isAuthenticated, async (req, res) => {
  try {
    const ships = await Ship.find({ org_id: req.params.id }).populate('owner_id', 'username citizen_name');
    res.json(ships);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

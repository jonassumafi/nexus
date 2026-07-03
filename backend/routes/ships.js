const express = require('express');
const multer = require('multer');
const path = require('path');
const Ship = require('../models/Ship');
const ShipModel = require('../models/ShipModel');
const ShipRPLedger = require('../models/ShipRPLedger');
const MissionArchive = require('../models/MissionArchive');
const User = require('../models/User');
const ShipAccessRequest = require('../models/ShipAccessRequest');
const PlatformConfig = require('../models/PlatformConfig');
const { isAuthenticated, isPlatformOwner } = require('../middleware/permissions');
const { uploadShipModel } = require('../services/cloudinaryService');
const { emitToOrg, emitToUser } = require('../services/socketManager');

const toTitleCase = s => s.split(' ').map(w =>
  w.split('-').map(p => (p[0] || '') + p.slice(1).toLowerCase()).join('-')
).join(' ');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../uploads/') });

router.get('/models', isAuthenticated, async (req, res) => {
  try {
    const models = await ShipModel.find().populate('created_by', 'username');
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/models', isAuthenticated, isPlatformOwner, upload.single('image'), async (req, res) => {
  try {
    const { category, model_name, scorg_ship_id } = req.body;
    if (!category || !model_name) return res.status(400).json({ error: 'category and model_name required' });

    let image_url = null;
    if (req.file) {
      image_url = await uploadShipModel(category, model_name, req.file.path);
    }

    const model = await ShipModel.create({
      category,
      model_name,
      image_url,
      scorg_ship_id: scorg_ship_id ? parseInt(scorg_ship_id) : null,
      created_by: req.user._id,
    });

    res.status(201).json(model);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Web-native registration flow (separate from Discord /ships POST).
// Hard cap of 5 ships per player. Builds crew_roles from placed node_positions
// so the new ship is immediately usable in missions.
router.post('/register', isAuthenticated, async (req, res) => {
  try {
    const callsign = (req.body.ship_name || '').toUpperCase().trim();
    const ship_model = (req.body.ship_model || '').trim();

    if (!callsign) return res.status(400).json({ error: 'CALLSIGN REQUIRED' });
    if (!ship_model) return res.status(400).json({ error: 'SHIP MODEL REQUIRED' });

    const existingCount = await Ship.countDocuments({ owner_id: req.user._id });
    if (existingCount >= 5) {
      return res.status(400).json({ error: 'SHIP LIMIT REACHED — MAX 5 VESSELS' });
    }

    const duplicate = await Ship.findOne({ owner_id: req.user._id, ship_name: callsign });
    if (duplicate) {
      return res.status(400).json({ error: 'CALLSIGN ALREADY REGISTERED TO YOUR FLEET' });
    }

    const nodePositions = req.body.node_positions || [];
    const hasPilot = nodePositions.some(
      n => n.role && n.role.toLowerCase() === 'pilot'
    );
    if (!hasPilot) {
      return res.status(400).json({
        error: 'VESSEL REQUIRES A PILOT NODE — PLACE A PILOT NODE ON THE SCHEMATIC BEFORE REGISTERING'
      });
    }

    // Convert UPPERCASE palette role names to TitleCase to match existing crew system
    const toTitleCase = s => s.split(' ').map(w =>
      w.split('-').map(p => (p[0] || '') + p.slice(1).toLowerCase()).join('-')
    ).join(' ');

    const node_positions = Array.isArray(req.body.node_positions) ? req.body.node_positions : [];
    const cleanedNodes = node_positions
      .filter(n => n && typeof n.role === 'string' && typeof n.x === 'number' && typeof n.y === 'number')
      .map(n => ({ role: toTitleCase(n.role), x: n.x, y: n.y }));

    const crew_roles = {};
    for (const n of cleanedNodes) {
      if (!crew_roles[n.role]) crew_roles[n.role] = { slots: 0, filled: [] };
      crew_roles[n.role].slots += 1;
    }

    const ship = await Ship.create({
      owner_id: req.user._id,
      org_id: req.user.org_id || null,
      ship_name: callsign,
      ship_model,
      type: req.body.ship_type || '',
      description: (req.body.description || '').slice(0, 1000),
      node_positions: cleanedNodes,
      crew_roles,
      is_mission: false,
      missions_completed: 0,
      current_mission_id: null,
    });

    res.json({ success: true, ship });
  } catch (err) {
    console.error('[ShipRegister] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', isAuthenticated, async (req, res) => {
  try {
    const config = await PlatformConfig.findOne();
    const maxShips = config ? config.max_ships_per_player : 2;

    const existingCount = await Ship.countDocuments({ owner_id: req.user._id });
    if (existingCount >= maxShips) {
      return res.status(409).json({ error: `Max ${maxShips} ships allowed` });
    }

    const { ship_name, description, type, prefix, crew_roles, model_image_url, scorg_ship_id } = req.body;

    const ship = await Ship.create({
      ship_name: ship_name ? ship_name.toUpperCase() : ship_name,
      description,
      owner_id: req.user._id,
      org_id: req.user.org_id || null,
      type,
      prefix,
      crew_roles: crew_roles || {},
      model_image_url: model_image_url || null,
      scorg_ship_id: scorg_ship_id || null,
    });

    res.status(201).json(ship);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const filter = {};
    if (req.query.org_id) filter.org_id = req.query.org_id;
    if (req.query.owner_id) filter.owner_id = req.query.owner_id;
    const ships = await Ship.find(filter).populate('owner_id', 'username citizen_name discord_id');

    if (req.query.includeStats === 'true') {
      const shipIds = ships.map(s => s._id);
      const ledgerRows = await ShipRPLedger.find({ ship_id: { $in: shipIds } });
      const byShip = {};
      for (const row of ledgerRows) {
        const id = row.ship_id.toString();
        if (!byShip[id]) byShip[id] = [];
        byShip[id].push(row);
      }
      const enriched = ships.map(ship => {
        const rows = byShip[ship._id.toString()] || [];
        const lifetime_rp = rows.reduce((s, r) => s + (r.points_awarded || 0), 0);
        const avg_fill_rate = rows.length > 0
          ? Math.round(rows.reduce((s, r) => s + (r.fill_rate || 0), 0) / rows.length)
          : 0;
        return { ...ship.toObject(), stats: { lifetime_rp, avg_fill_rate, missions_analyzed: rows.length } };
      });
      return res.json(enriched);
    }

    res.json(ships);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Returns ships assignable to a mission by the requester: their own ships,
// plus ships they have an active (unexpired) loan for that are not currently
// on a mission. All other ships are excluded so the fleet picker in Stage 2
// only surfaces vessels the operator actually has access to.
router.get('/all', isAuthenticated, async (req, res) => {
  try {
    const now = new Date();
    const user = await User.findById(req.user._id).select('borrowed_ships').lean();
    const activeBorrowedIds = (user?.borrowed_ships || [])
      .filter(b => b.loan_expires_at && new Date(b.loan_expires_at) > now)
      .map(b => b.ship_id);

    const orClauses = [{ owner_id: req.user._id }];
    if (activeBorrowedIds.length > 0) {
      orClauses.push({ _id: { $in: activeBorrowedIds }, is_mission: false });
    }

    const ships = await Ship.find({ $or: orClauses })
      .populate('owner_id', 'username citizen_name')
      .sort({ created_at: -1 })
      .limit(50);
    res.json(ships);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/mine', isAuthenticated, async (req, res) => {
  try {
    const ships = await Ship.find({ owner_id: req.user._id })
      .populate('owner_id', 'username citizen_name')
      .sort({ is_mission: -1, created_at: -1 });
    res.json(ships);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Returns the caller's access requests (as requester) and active loans they've
// approved on their own ships (as owner), so the frontend can derive button
// states without extra round-trips.
router.get('/access-requests/mine', isAuthenticated, async (req, res) => {
  try {
    const uid = req.user._id;

    const [asRequester, asOwnerApproved] = await Promise.all([
      ShipAccessRequest.find({
        requester_id: uid,
        status: { $in: ['pending', 'approved'] },
      }).select('ship_id status expires_at loan_expires_at').lean(),
      ShipAccessRequest.find({
        owner_id: uid,
        status: 'approved',
      }).populate('requester_id', 'citizen_name username').select('ship_id requester_id loan_expires_at').lean(),
    ]);

    const ownerApproved = asOwnerApproved.map(r => ({
      request_id: r._id,
      ship_id: r.ship_id,
      requester_name: r.requester_id?.citizen_name || r.requester_id?.username || '—',
      loan_expires_at: r.loan_expires_at,
    }));

    res.json({ as_requester: asRequester, as_owner_approved: ownerApproved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Returns full ship objects the caller has borrowed (status=approved on their
// borrowed_ships array).
router.get('/borrowed', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('borrowed_ships').lean();
    if (!user || !user.borrowed_ships || user.borrowed_ships.length === 0) {
      return res.json([]);
    }
    const shipIds = user.borrowed_ships.map(b => b.ship_id);
    const ships = await Ship.find({ _id: { $in: shipIds } })
      .populate('owner_id', 'username citizen_name')
      .lean();

    const enriched = ships.map(ship => {
      const entry = user.borrowed_ships.find(b => b.ship_id.toString() === ship._id.toString());
      return { ...ship, loan_expires_at: entry?.loan_expires_at || null, request_id: entry?.request_id || null };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/stats', isAuthenticated, async (req, res) => {
  try {
    const rows = await ShipRPLedger.find({ ship_id: req.params.id });
    if (rows.length === 0) {
      return res.json({ avg_fill_rate: 0, lifetime_rp: 0, missions_analyzed: 0 });
    }
    const lifetime_rp = rows.reduce((s, r) => s + (r.points_awarded || 0), 0);
    const avg_fill_rate = Math.round(
      rows.reduce((s, r) => s + (r.fill_rate || 0), 0) / rows.length
    );
    res.json({
      avg_fill_rate,
      lifetime_rp,
      missions_analyzed: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/missions', isAuthenticated, async (req, res) => {
  try {
    const shipId = req.params.id;
    const archives = await MissionArchive
      .find({ ship_ids: shipId })
      .sort({ completed_at: -1 })
      .limit(20)
      .lean();

    const rows = archives.map((a) => {
      const primaryId = a.primary_ship_snapshot?.ship_id?.toString();
      const role = primaryId === shipId.toString() ? 'PRIMARY' : 'SUPPORT';
      return {
        _id: a._id,
        status: a.status,
        name: a.name,
        mission_type: a.mission_type,
        completed_at: a.completed_at,
        role,
      };
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/nodes', isAuthenticated, async (req, res) => {
  try {
    const ship = await Ship.findById(req.params.id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });

    if (ship.owner_id.toString() !== req.user._id.toString() && !req.user.is_platform_owner) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const node_positions = Array.isArray(req.body.node_positions) ? req.body.node_positions : [];
    const cleanedNodes = node_positions
      .filter(n => n && typeof n.role === 'string' && typeof n.x === 'number' && typeof n.y === 'number')
      .map(n => ({ role: toTitleCase(n.role), x: n.x, y: n.y }));

    // Rebuild crew_roles, preserving any existing filled[] entries for surviving roles
    const oldCrewRoles = ship.crew_roles || {};
    const newCrewRoles = {};
    for (const n of cleanedNodes) {
      if (!newCrewRoles[n.role]) {
        newCrewRoles[n.role] = { slots: 0, filled: (oldCrewRoles[n.role]?.filled || []).slice() };
      }
      newCrewRoles[n.role].slots += 1;
    }
    for (const role of Object.keys(newCrewRoles)) {
      const r = newCrewRoles[role];
      if (r.filled.length > r.slots) r.filled = r.filled.slice(0, r.slots);
    }

    let total = 0, filled = 0;
    for (const r of Object.values(newCrewRoles)) {
      total += r.slots || 0;
      filled += (r.filled || []).length;
    }
    const crew_fill_percentage = total > 0 ? Math.round((filled / total) * 100) : 0;

    ship.node_positions = cleanedNodes;
    ship.crew_roles = newCrewRoles;
    ship.crew_fill_percentage = crew_fill_percentage;
    ship.markModified('crew_roles');
    await ship.save();

    res.json({ success: true });
  } catch (err) {
    console.error('[Ship Nodes Update] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', isAuthenticated, async (req, res) => {
  try {
    const ship = await Ship.findById(req.params.id).populate('owner_id', 'username citizen_name');
    if (!ship) return res.status(404).json({ error: 'Ship not found' });
    res.json(ship);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const ship = await Ship.findById(req.params.id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });

    if (ship.owner_id.toString() !== req.user._id.toString() && !req.user.is_platform_owner) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const allowed = ['description', 'type', 'prefix', 'model_image_url', 'scorg_ship_id'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const updated = await Ship.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const ship = await Ship.findById(req.params.id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });

    if (ship.owner_id.toString() !== req.user._id.toString() && !req.user.is_platform_owner) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (ship.is_mission) return res.status(400).json({ error: 'SHIP ON ACTIVE MISSION' });

    await Ship.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/crew', isAuthenticated, async (req, res) => {
  try {
    const ship = await Ship.findById(req.params.id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });

    const { crew_roles } = req.body;
    if (!crew_roles) return res.status(400).json({ error: 'crew_roles required' });

    let total = 0;
    let filled = 0;
    for (const roleData of Object.values(crew_roles)) {
      total += roleData.slots || 0;
      filled += (roleData.filled || []).length;
    }
    const crew_fill_percentage = total > 0 ? Math.round((filled / total) * 100) : 0;

    const updated = await Ship.findByIdAndUpdate(
      req.params.id,
      { crew_roles, crew_fill_percentage },
      { new: true }
    );

    if (ship.org_id) {
      emitToOrg(ship.org_id, 'crew_fill_updated', { shipId: ship._id, crew_fill_percentage });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Ship Access Request actions ────────────────────────────────────────────

router.post('/:id/request-access', isAuthenticated, async (req, res) => {
  try {
    const ship = await Ship.findById(req.params.id).populate('owner_id', 'citizen_name username');
    if (!ship) return res.status(404).json({ error: 'Ship not found' });

    if (ship.owner_id._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'CANNOT REQUEST ACCESS TO YOUR OWN VESSEL' });
    }
    if (ship.is_mission) {
      return res.status(400).json({ error: 'VESSEL IS ON AN ACTIVE MISSION' });
    }

    const existing = await ShipAccessRequest.findOne({
      requester_id: req.user._id,
      ship_id: ship._id,
      status: { $in: ['pending', 'approved'] },
    });
    if (existing) return res.status(400).json({ error: 'REQUEST ALREADY ACTIVE' });

    const accessReq = await ShipAccessRequest.create({
      requester_id: req.user._id,
      owner_id: ship.owner_id._id,
      ship_id: ship._id,
    });

    emitToUser(ship.owner_id._id.toString(), 'ship:access_requested', {
      requestId: accessReq._id,
      shipId: ship._id,
      shipName: ship.ship_name,
      shipModel: ship.ship_model || '',
      requesterId: req.user._id,
      requesterName: req.user.citizen_name || req.user.username || '—',
    });

    res.json({ success: true, request: accessReq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approve-access', isAuthenticated, async (req, res) => {
  try {
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ error: 'request_id required' });

    const ship = await Ship.findById(req.params.id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });
    if (ship.owner_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const accessReq = await ShipAccessRequest.findById(request_id);
    if (!accessReq || accessReq.status !== 'pending') {
      return res.status(400).json({ error: 'REQUEST NOT FOUND OR NOT PENDING' });
    }

    const loanExpiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
    accessReq.status = 'approved';
    accessReq.loan_expires_at = loanExpiresAt;
    await accessReq.save();

    await User.findByIdAndUpdate(accessReq.requester_id, {
      $push: {
        borrowed_ships: {
          ship_id: ship._id,
          owner_id: req.user._id,
          loan_expires_at: loanExpiresAt,
          request_id: accessReq._id,
        },
      },
    });

    emitToUser(accessReq.requester_id.toString(), 'ship:access_approved', {
      requestId: accessReq._id,
      shipId: ship._id,
      shipName: ship.ship_name,
      loanExpiresAt,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/deny-access', isAuthenticated, async (req, res) => {
  try {
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ error: 'request_id required' });

    const ship = await Ship.findById(req.params.id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });
    if (ship.owner_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const accessReq = await ShipAccessRequest.findById(request_id);
    if (!accessReq || accessReq.status !== 'pending') {
      return res.status(400).json({ error: 'REQUEST NOT FOUND OR NOT PENDING' });
    }

    accessReq.status = 'denied';
    await accessReq.save();

    emitToUser(accessReq.requester_id.toString(), 'ship:access_denied', {
      requestId: accessReq._id,
      shipId: ship._id,
      shipName: ship.ship_name,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/cancel-request', isAuthenticated, async (req, res) => {
  try {
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ error: 'request_id required' });

    const accessReq = await ShipAccessRequest.findById(request_id);
    if (!accessReq || accessReq.status !== 'pending') {
      return res.status(400).json({ error: 'REQUEST NOT FOUND OR NOT PENDING' });
    }
    if (accessReq.requester_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    accessReq.status = 'withdrawn';
    await accessReq.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/withdraw-access', isAuthenticated, async (req, res) => {
  try {
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ error: 'request_id required' });

    const ship = await Ship.findById(req.params.id);
    if (!ship) return res.status(404).json({ error: 'Ship not found' });
    if (ship.owner_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    const accessReq = await ShipAccessRequest.findById(request_id);
    if (!accessReq || accessReq.status !== 'approved') {
      return res.status(400).json({ error: 'ACTIVE LOAN NOT FOUND' });
    }

    accessReq.status = 'withdrawn';
    await accessReq.save();

    await User.findByIdAndUpdate(accessReq.requester_id, {
      $pull: { borrowed_ships: { request_id: accessReq._id } },
    });

    if (ship.is_mission) {
      await Ship.findByIdAndUpdate(ship._id, { recalled_mid_mission: true });
    }

    emitToUser(accessReq.requester_id.toString(), 'ship:access_recalled', {
      requestId: accessReq._id,
      shipId: ship._id,
      shipName: ship.ship_name,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/return-ship', isAuthenticated, async (req, res) => {
  try {
    const { request_id } = req.body;
    if (!request_id) return res.status(400).json({ error: 'request_id required' });

    const accessReq = await ShipAccessRequest.findById(request_id);
    if (!accessReq || accessReq.status !== 'approved') {
      return res.status(400).json({ error: 'ACTIVE LOAN NOT FOUND' });
    }
    if (accessReq.requester_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    accessReq.status = 'withdrawn';
    await accessReq.save();

    await User.findByIdAndUpdate(req.user._id, {
      $pull: { borrowed_ships: { request_id: accessReq._id } },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

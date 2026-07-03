const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function isAuthenticated(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token && req.query.token) token = req.query.token;
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function isPlatformOwner(req, res, next) {
  if (!req.user || !req.user.is_platform_owner) {
    return res.status(403).json({ error: 'Platform owner access required' });
  }
  next();
}

function isOrgCommander(req, res, next) {
  if (!req.user || !req.user.is_org_commander) {
    return res.status(403).json({ error: 'Org commander access required' });
  }
  next();
}

module.exports = { isAuthenticated, isPlatformOwner, isOrgCommander };

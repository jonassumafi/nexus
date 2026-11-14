require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const socketManager = require('./services/socketManager');
const { syncLandingHtml, watchReleases } = require('./services/landingHtml');
const { seedPlatformConfig, migratePlatformConfig } = require('./utils/seed');
const { seedMissions, seedActivityEvents } = require('./utils/seedMissions');
const { startScheduler } = require('./jobs/scheduler');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const orgRoutes = require('./routes/organizations');
const shipRoutes = require('./routes/ships');
const missionRoutes = require('./routes/missions');
const crewRoutes = require('./routes/crew');
const rpRoutes = require('./routes/rp');
const logRoutes = require('./routes/logs');
const adminRoutes = require('./routes/admin');
const radioRoutes = require('./routes/radio');
const bugReportRoutes = require('./routes/bugReport');
const chatRoutes = require('./routes/chat');
const friendRoutes = require('./routes/friends');
const dmRoutes = require('./routes/dms');
const changelogRoutes = require('./routes/changelog');
const releaseInfoRoutes = require('./routes/releaseInfo');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Crash-detection budget. pingInterval 10 s + pingTimeout 20 s means
  // a client that lost power or had its process killed drops from
  // friends' lists within ~30 s — the budget the lifecycle spec asks
  // for. Clean quits still propagate immediately via the Electron
  // cleanup routine disconnecting the socket.
  pingInterval: 10000,
  pingTimeout:  20000,
});

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/organizations', orgRoutes);
app.use('/api/ships', shipRoutes);
app.use('/api/missions', missionRoutes);
app.use('/api/crew', crewRoutes);
app.use('/api/rp', rpRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/radio', radioRoutes);
app.use('/api/bug-report', bugReportRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/dms', dmRoutes);
app.use('/api/changelog', changelogRoutes);
app.use('/api/release-info', releaseInfoRoutes);

// Expose `io` for routes that need to compute presence hints without
// going through the socketManager singleton.
app.set('io', io);

// ─── Nexus Companion release feed (electron-updater source) ──────────────
// Serves `latest.yml` + the installer .exe from backend/releases/.
// Deployment: `npm run build` in electron/, then copy the two artifacts
// (latest.yml + Nexus Companion Setup X.Y.Z.exe) into backend/releases/.
// electron-updater on each installed client checks latest.yml every launch
// and downloads the new .exe in the background. Immutable files, so a
// long cache header is safe.
const path = require('path');
app.use('/api/releases',
  express.static(path.join(__dirname, 'releases'), {
    etag: true,
    lastModified: true,
    maxAge: '1h',       // short so a new release is picked up quickly
    index: false,       // no directory listing
  }),
);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('[DB] Connected to MongoDB:', process.env.MONGODB_URI);
    await seedPlatformConfig();
    await migratePlatformConfig();
    await seedMissions();
    await seedActivityEvents();
    socketManager.init(io);
    startScheduler();
    syncLandingHtml();
    watchReleases();

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`[Server] Nexus backend listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  });

module.exports = { app, server };

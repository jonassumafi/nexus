require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const socketManager = require('./services/socketManager');
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

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
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

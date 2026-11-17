const path = require('path');
require('dotenv').config({ override: true });
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDB = require('./config/db');
const User = require('./models/User');
const Device = require('./models/Device');
const { hashPassword, normalizeRfidUid } = require('./utils/hashUtil');
const { logInfo, logError } = require('./utils/logger');

// Route imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const rfidRoutes = require('./routes/rfidRoutes');
const visitorRoutes = require('./routes/visitorRoutes');
const otpRoutes = require('./routes/otpRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const logRoutes = require('./routes/logRoutes');
const settingsRoutes = require('./routes/settingsRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for dashboard & CDN icons
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Device-Key', 'X-Device-Token', 'X-Test-Mode']
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Serve Frontend Static Files
app.use(express.static(path.join(__dirname, '../frontend')));

// Seed Initial Admin & Device Data
const seedInitialData = async () => {
  try {
    // 1. Seed Default Administrator
    const adminEmail = 'admin@securegate.local';
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (!existingAdmin) {
      const defaultPassword = 'adminpassword123';
      const passwordHash = await hashPassword(defaultPassword);

      await User.create({
        name: 'Prof. Admin Lead',
        email: adminEmail,
        passwordHash,
        role: 'admin',
        department: 'Security Operations & IoT',
        active: true
      });
      logInfo('SEED', `Created default admin user: ${adminEmail} (password: ${defaultPassword})`);
    }

    // 2. Ensure Device Entry in MongoDB
    const devId = process.env.DEVICE_ID || 'ESP32_SECUREGATE_01';
    const existingDevice = await Device.findOne({ deviceId: devId });
    if (!existingDevice) {
      await Device.create({
        deviceId: devId,
        apiKeyHash: 'ACTIVE_PRECONFIGURED',
        name: 'ESP32 Gate Controller DevKit',
        location: 'Academic Block Entrance',
        status: 'offline',
        rfidReady: true,
        doorLocked: true
      });
      logInfo('SEED', `Initialized Device record for ${devId}`);
    }
  } catch (err) {
    logError('SEED', 'Error during initial database seed', err);
  }
};

// API Route Mounts
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rfid', rfidRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/settings', settingsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    system: 'SecureGate AI Core Service',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Single Page Application Fallbacks for Frontend Pages
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

app.get('/visitor', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/visitor.html'));
});

app.get('/verify-otp', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/verify-otp.html'));
});

app.get('/user', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/user.html'));
});

// Global 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  logError('SERVER', 'Unhandled internal exception', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Start Server after connecting to MongoDB
const startServer = async () => {
  const db = await connectDB();
  if (db) {
    await seedInitialData();
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n======================================================');
    console.log(`🛡️  SECUREGATE AI SERVER RUNNING ON PORT ${PORT}`);
    console.log(`🌐  Local URL:        http://localhost:${PORT}`);
    console.log(`📋  Admin Portal:     http://localhost:${PORT}/admin.html`);
    console.log(`👤  Visitor Portal:   http://localhost:${PORT}/visitor.html`);
    console.log(`🔑  OTP Verification: http://localhost:${PORT}/verify-otp.html`);
    console.log(`💳  RFID Terminal:    http://localhost:${PORT}/user.html`);
    console.log(`📡  Device API ID:    ${process.env.DEVICE_ID || 'ESP32_SECUREGATE_01'}`);
    console.log('======================================================\n');
  });
};

startServer();

module.exports = app;

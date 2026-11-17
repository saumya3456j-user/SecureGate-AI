const mongoose = require('mongoose');

let isConnected = false;
let retryTimer = null;

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/securegate_db';
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true
    });

    isConnected = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    console.log(`[DATABASE] MongoDB Connected: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    isConnected = false;
    console.error(`[DATABASE ERROR] MongoDB Connection Failed: ${error.message}`);
    console.error('[DATABASE HINT] Add MONGODB_URI (e.g. MongoDB Atlas cloud connection string) in your Render Environment settings.');

    // In production or cloud deployments, keep server process alive so Render health checks pass
    if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
      console.warn('[DATABASE] Retrying MongoDB connection in 15 seconds...');
      if (!retryTimer) {
        retryTimer = setTimeout(connectDB, 15000);
      }
      return null;
    }

    // In local development, also retry instead of crashing abruptly
    return null;
  }
};

module.exports = connectDB;


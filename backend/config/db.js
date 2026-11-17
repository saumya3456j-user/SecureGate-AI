const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/securegate_db', {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true
    });

    console.log(`[DATABASE] MongoDB Connected: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[DATABASE ERROR] MongoDB Connection Failed: ${error.message}`);
    console.error('[DATABASE HINT] Make sure MongoDB server is running locally or check your MONGODB_URI in backend/.env');
    process.exit(1);
  }
};

module.exports = connectDB;


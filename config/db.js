const mongoose = require('mongoose');

const connectDB = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set');
  }
  mongoose.set('strictQuery', true);
  const conn = await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 2500
  });
  return conn;
};

module.exports = connectDB;
module.exports.connectDB = connectDB;

const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const cors = require('cors');

// Default dotenv behaviour: variables already exported in the shell win.
dotenv.config({ path: path.join(__dirname, 'config', 'config.env') });

const connectDB = require('./config/db');
const User = require('./models/User');
const Provider = require('./models/Provider');

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Route mounting: one line per resource, added by later tasks.
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/providers', require('./routes/providers'));
app.use('/api/v1/bookings', require('./routes/bookings'));
app.use('/api/v1/promos', require('./routes/promos'));
app.use('/api/v1/audit', require('./routes/audit'));

const seedAdmin = async () => {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) return;
  // Goes through the same bcrypt pre-save hook as every user.
  await User.create({ name: 'Admin', telephone: '0000000000', email, password, role: 'admin' });
};

// Seed two providers only when the collection is empty.
const seedProviders = async () => {
  if (await Provider.countDocuments() > 0) return;
  await Provider.create([
    { name: 'Alpha Rentals', address: '1 Test Road', tel: '020000001', lateFeePerHour: 200, dailyRate: 1000 },
    { name: 'Beta Cars', address: '2 Test Road', tel: '020000002', lateFeePerHour: 500, dailyRate: 2500 }
  ]);
};

const start = async () => {
  await connectDB();
  await seedAdmin();
  await seedProviders();
  const PORT = process.env.PORT;
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
  process.on('unhandledRejection', (err) => {
    console.error(`Error: ${err.message}`);
    server.close(() => process.exit(1));
  });
};

// Importing the app (scripts/audit-immutability-check.js) must not open a listener or a connection.
if (require.main === module) {
  start().catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = app;

const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const cors = require('cors');

// Default dotenv behaviour: variables already exported in the shell win.
dotenv.config({ path: path.join(__dirname, 'config', 'config.env') });

const connectDB = require('./config/db');
const User = require('./models/User');

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Route mounting: one line per resource, added by later tasks.
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/providers', require('./routes/providers'));
app.use('/api/v1/bookings', require('./routes/bookings'));

const seedAdmin = async () => {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) return;
  // Goes through the same bcrypt pre-save hook as every user.
  await User.create({ name: 'Admin', telephone: '0000000000', email, password, role: 'admin' });
};

const start = async () => {
  await connectDB();
  await seedAdmin();
  const PORT = process.env.PORT;
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
  process.on('unhandledRejection', (err) => {
    console.error(`Error: ${err.message}`);
    server.close(() => process.exit(1));
  });
};

start().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});

module.exports = app;

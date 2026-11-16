const express = require('express');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const User = require('./models/User');

//Load env vars
dotenv.config({ path: './config/config.env' });

const seedUsers = async () => {
    if (!(await User.findOne({ email: 'admin@gmail.com' }))) {
        await User.create({ name: 'Admin', email: 'admin@gmail.com', password: '12345678', role: 'admin' });
    }
    if (!(await User.findOne({ email: 'user8@gmail.com' }))) {
        await User.create({ name: 'User8', email: 'user8@gmail.com', password: '12345678', role: 'user' });
    }
};

connectDB().then(seedUsers);

const app = express();

//Query parser
app.set('query parser', 'extended');

//Body parser
app.use(express.json());

//Cookie parser
app.use(cookieParser());

//Route files
const hospitals = require('./routes/hospitals');
const auth = require('./routes/auth');
const appointments = require('./routes/appointments');

app.use('/api/v1/hospitals', hospitals);
app.use('/api/v1/auth', auth);
app.use('/api/v1/appointments', appointments);

const PORT = process.env.PORT || 5000;

const server = app.listen(
    PORT,
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`)
);

process.on('unhandledRejection', (err, promise) => {
    console.log(`Error: ${err.message}`);
    server.close(() => process.exit(1));
});

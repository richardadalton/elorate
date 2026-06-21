const express = require('express');
const path    = require('path');
const os      = require('os');
const session = require('express-session');

const app  = express();
const PORT = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT) : 3000;

app.use(express.json());
app.use(session({
  secret:            process.env.SESSION_SECRET || 'elorate_dev_secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use(require('./routes/auth'));
app.use(require('./routes/leagues'));
app.use(require('./routes/players'));
app.use(require('./routes/games'));
app.use(require('./routes/records'));
app.use(require('./routes/users'));
app.use(require('./routes/admin'));

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`Pool League running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
});

module.exports = app; // for testing

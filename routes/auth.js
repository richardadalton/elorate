const express = require('express');
const bcrypt  = require('bcrypt');
const { readUsers, appendUser, getLeagues, getCache } = require('../lib/storage');

const BCRYPT_ROUNDS = 10;
const router = express.Router();

router.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !name.trim())     return res.status(400).json({ error: 'Name is required' });
  if (!email || !email.trim())   return res.status(400).json({ error: 'Email is required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const normEmail = email.trim().toLowerCase();
  const users = readUsers();
  if (users.find(u => u.email === normEmail)) {
    return res.status(400).json({ error: 'An account with that email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = {
    id:           `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name:         name.trim(),
    email:        normEmail,
    passwordHash,
    createdAt:    new Date().toISOString(),
  };
  appendUser(user);

  req.session.userId = user.id;
  res.status(201).json({ id: user.id, name: user.name, email: user.email });
});

router.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const users = readUsers();
  const user  = users.find(u => u.email === email.trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });

  req.session.userId = user.id;
  res.json({ id: user.id, name: user.name, email: user.email });
});

router.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const users = readUsers();
  const user  = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, email: user.email });
});

// GET /api/auth/memberships — map of league slug → playerId for the logged-in user
router.get('/api/auth/memberships', (req, res) => {
  if (!req.session.userId) return res.json({});
  const memberships = {};
  for (const league of getLeagues()) {
    const { players } = getCache(league);
    const player = players.find(p => p.userId === req.session.userId);
    if (player) memberships[league] = player.id;
  }
  res.json(memberships);
});

module.exports = router;

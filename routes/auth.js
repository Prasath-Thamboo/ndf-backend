// src/routes/auth.js (extraits)
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const authMiddleware = require('../middlewares/auth');

const router = express.Router();

// existing /register and /login routes kept as-is...

// GET /api/auth/me
router.get('/me', authMiddleware.verifyToken, async (req, res) => {
  try {
    // req.user est déjà peuplé par verifyToken
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// (optionnel) simple refresh token flow (statique, améliorations possibles)
router.post('/refresh', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ message: 'Missing token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: 'Invalid refresh token' });
    const newAccess = jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
    res.json({ accessToken: newAccess });
  } catch (err) {
    return res.status(401).json({ message: 'Refresh token invalid or expired' });
  }
});

module.exports = router;

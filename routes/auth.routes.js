import express from 'express';
import { body, validationResult } from 'express-validator';
import { register, login, issueTokens } from '../services/auth.service.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Middleware générique pour gérer les erreurs de validation
const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];

// Validation Register
const validateRegister = [
  body('name').trim().notEmpty().withMessage('Le nom est requis'),
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Mot de passe trop court'),
];

// Validation Login
const validateLogin = [
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('password').notEmpty().withMessage('Mot de passe requis'),
];

// Routes
router.post('/register', validate(validateRegister), async (req, res, next) => {
  try {
    const user = await register(req.body);
    res.status(201).json({ user });
  } catch (e) { next(e); }
});

router.post('/login', validate(validateLogin), async (req, res, next) => {
  try {
    const result = await login(req.body);
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token manquant' });
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const tokens = issueTokens({ _id: payload.sub, role: payload.role });
    res.json(tokens);
  } catch {
    res.status(401).json({ message: 'Refresh token invalide' });
  }
});

export default router;
import express from 'express';
import User from '../models/user.model.js';
import { authenticate, authorize } from '../middlewares/auth.js';

const router = express.Router();

// Admin: liste des utilisateurs
router.get('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const users = await User.find().select('-passwordHash');
    res.json(users);
  } catch (e) { next(e); }
});

// Admin: modifier rôle
router.patch('/:id/role', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['user','manager','admin'].includes(role)) return res.status(400).json({ message: 'Rôle invalide' });
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-passwordHash');
    res.json(user);
  } catch (e) { next(e); }
});

// Admin: activer/désactiver
router.patch('/:id/status', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { isActive }, { new: true }).select('-passwordHash');
    res.json(user);
  } catch (e) { next(e); }
});

// Admin: supprimer définitivement
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.status(204).send();
  } catch (e) { next(e); }
});

export default router;
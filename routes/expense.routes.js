import express from 'express';
import { body, validationResult } from 'express-validator';
import Expense from '../models/expense.model.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { uploadReceipt } from '../config/multer.js';

const router = express.Router();

// Middleware générique
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

// Validation création de note
const validateExpense = [
  body('title').trim().notEmpty().withMessage('Titre requis'),
  body('amount').isFloat({ min: 0 }).withMessage('Montant invalide'),
  body('date').isISO8601().withMessage('Date invalide'),
  body('category').isIn(['Travel','Meals','Office','Other']).withMessage('Catégorie invalide'),
];

// Routes
router.post('/', authenticate, authorize('user','manager','admin'), uploadReceipt.single('receipt'), validate(validateExpense), async (req,res,next) => {
  try {
    const { title, amount, category, date, currency } = req.body;
    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : '';
    const exp = await Expense.create({
      user: req.user.sub,
      title, amount, category, date, currency, receiptUrl
    });
    res.status(201).json(exp);
  } catch(e){ next(e); }
});

// ... autres routes (my, update, delete, pending, decision, admin)
export default router;
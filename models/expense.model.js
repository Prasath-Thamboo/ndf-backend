import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'EUR' },
  category: { type: String, enum: ['Travel', 'Meals', 'Office', 'Other'], default: 'Other' },
  date: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'archived'], default: 'pending' },
  managerComment: { type: String, default: '' },
  receiptUrl: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Expense', expenseSchema);
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';

const accessExp = '15m';
const refreshExp = '7d';

export const register = async ({ email, password, name }) => {
  const exists = await User.findOne({ email });
  if (exists) throw new Error('Email déjà utilisé');
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, passwordHash, name });
  return sanitizeUser(user);
};

export const login = async ({ email, password }) => {
  const user = await User.findOne({ email, isActive: true });
  if (!user) throw new Error('Identifiants invalides');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('Identifiants invalides');
  const tokens = issueTokens(user);
  return { user: sanitizeUser(user), ...tokens };
};

export const issueTokens = (user) => {
  const payload = { sub: user._id.toString(), role: user.role };
  const accessToken = jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: accessExp });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: refreshExp });
  return { accessToken, refreshToken };
};

const sanitizeUser = (u) => ({
  id: u._id.toString(),
  email: u.email,
  name: u.name,
  role: u.role,
  isActive: u.isActive,
});
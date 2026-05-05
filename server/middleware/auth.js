import jwt from 'jsonwebtoken';

export const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'infu-pass-2026');
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

export const requireRole = (role) => (req, res, next) => {
  if (req.user?.role !== role && req.user?.name !== 'Super Admin') {
    return res.status(403).json({ success: false, error: `Forbidden: Requires ${role} access` });
  }
  next();
};
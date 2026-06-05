import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/node';
import { z } from 'zod';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { assertBalanced, debitAccountFor, grossSalesAmount, suggestedSettleAccount } from './lib/ledger.js';
import { ACCOUNTS, EXPENSE_CATEGORIES, CODE_MAP } from './lib/chartOfAccounts.js';
import { resolveUnit, displayToBase, effectiveDisplay } from './lib/units.js';
import { addBatch, consumeBatches, soonestExpiry, sortBatchesFEFO, batchesTotal } from './lib/expiry.js';

const log = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: 'semivra-pos' },
  ...(process.env.NODE_ENV !== 'production' && { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } } })
});

// Optional error monitoring — completely inert unless SENTRY_DSN is set.
const SENTRY_ON = !!process.env.SENTRY_DSN;
if (SENTRY_ON) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0, // error reporting only; no perf tracing overhead
  });
  log.info('Sentry error monitoring enabled');
}

// Fail fast on missing required env vars
if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.error('❌ MONGO_URI and JWT_SECRET must be set in .env — server will not start.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// Hardened edge posture:
// - Hide Express version fingerprint
// - Trust the single upstream proxy (Railway/Vercel) so req.ip + rate-limit keys
//   reflect the real client IP, not the load balancer's.
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Hardened security headers. This is a JSON API consumed by a separate SPA origin,
// so the restrictive default CSP is relaxed to avoid breaking nothing-served-here,
// while HSTS, nosniff, frameguard, and referrer policy are enforced.
app.use(helmet({
  contentSecurityPolicy: false,            // API serves no HTML; CSP belongs on the frontend host
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow the SPA origin to read responses
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

app.use(compression());

// --- CORS CONFIG (env-driven for production, LAN auto-allow for dev) ---
const IS_PROD = process.env.NODE_ENV === 'production';
const ENV_ORIGINS = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = [
  "http://localhost:3000",
  ...ENV_ORIGINS
];

const corsOriginCheck = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  // LAN auto-allow only when not in production
  if (!IS_PROD && (origin.startsWith('http://192.168.') || origin.startsWith('http://172.') || origin.startsWith('http://10.'))) {
    return callback(null, true);
  }
  callback(new Error(`CORS blocked: ${origin}`));
};

app.use(cors({
  origin: corsOriginCheck,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true
}));

// Update Socket.io CORS to match
// ✅ KEEP THIS NEW ONE
const io = new Server(server, {
  cors: {
    origin: corsOriginCheck,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true
  }
});

// Structured request logging (skips noisy health checks)
app.use(pinoHttp({
  logger: log,
  autoLogging: { ignore: req => req.url === '/health' },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: req => ({ method: req.method, url: req.url, id: req.id }),
    res: res => ({ statusCode: res.statusCode })
  }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

// ── STANDARDISED LEDGER REFERENCE GENERATOR ─────────────────────────────────────
//
//  Format:  PREFIX-YYYY-NNNNNN
//
//  • PREFIX   — document type code  (ORD, VOID, EXP, …)
//  • YYYY     — calendar year        (sequences reset annually — standard BIR practice)
//  • NNNNNN   — 6-digit zero-padded sequential number, atomic & collision-free
//
//  For order-linked entries (ORD, VOID, ARS) the caller passes the order number
//  as `suffix` and we use  PREFIX-{orderNumber}  instead (no counter needed —
//  the order number is already the unique id).
//
//  Examples:
//    ORD-KL-2025-0001          ← sale linked to order KL-2025-0001
//    VOID-KL-2025-0001         ← void of that same order
//    ARS-KL-2025-0001          ← A/R settlement of that order
//    EXP-2025-000042           ← 42nd expense entry of 2025
//    INV-SPOIL-2025-000007     ← 7th spoilage entry of 2025
//    JRN-2025-000001           ← 1st manual journal entry of 2025
//
//  Counter keys are stored in the Counter collection as  "{PREFIX}-{YYYY}".
//  They are shared with nothing else — safe to increment even inside transactions
//  because Counter documents are upserted outside the session.
//
// mkRef — SYNCHRONOUS. Use when the source document already provides a unique ID.
//   Completion JE  →  order.orderNumber as-is   e.g. "ORD-2025-A0001"
//   Void JE        →  "VOID-ORD-2025-A0001"
//   ARS JE         →  "ARS-ORD-2025-A0001"
// Pass prefix='' to use orderNumber directly (no extra prefix needed for sales JEs).
const mkRef = (prefix, suffix) => prefix ? `${prefix}-${suffix}` : suffix;

// Escape user input before interpolating into a RegExp — prevents regex injection
// and ReDoS (catastrophic backtracking) when matching names case-insensitively.
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// bcrypt work factor — 12 rounds (OWASP-recommended minimum for 2025+).
const BCRYPT_ROUNDS = 12;

// Mongo filter for cash that has physically entered the drawer during a shift.
// Cash is tendered at the Preparing transition (amountTendered), so the drawer
// holds cash from: every Completed cash sale, PLUS any in-progress (Preparing/Ready)
// cash order that already has amountTendered recorded. Pending/Cancelled/Voided/
// Parked are excluded (no cash collected, or cash reversed).
const shiftCashFilter = (cashierName, shiftStart) => ({
  cashier: cashierName,
  paymentMethod: 'Cash',
  createdAt: { $gte: shiftStart },
  $or: [
    { status: 'Completed' },
    { status: { $in: ['Preparing', 'Ready'] }, amountTendered: { $gt: 0 } },
  ],
});

// ── DUAL-TOKEN AUTH CONFIG ───────────────────────────────────────────────────
// Access token: short-lived (15m), sent as a Bearer header, held in client memory.
// Refresh token: opaque random secret, long-lived (30d), httpOnly+Secure+SameSite
// cookie, persisted (hashed) in the RefreshSession collection so it can be revoked
// instantly on logout / privilege change. Rotated on every use.
const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_COOKIE = 'semivra_rt';

const signAccessToken = (user) => jwt.sign(
  { _id: user._id, name: user.name, userCode: user.userCode, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: ACCESS_TTL }
);

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// In production the SPA (Vercel) and API (Railway) are different sites, so the
// refresh cookie MUST be SameSite=None; Secure to be sent cross-site. That removes
// SameSite's CSRF protection, so the /api/auth/* endpoints additionally enforce an
// Origin allowlist (see requireTrustedOrigin). In dev (same-ish origin) we use Lax.
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: IS_PROD,                         // None requires Secure; HTTPS-only in prod
  sameSite: IS_PROD ? 'none' : 'lax',
  maxAge: REFRESH_TTL_MS,
  path: '/api/auth',                       // cookie only ever sent to the refresh/logout endpoints
});

// CSRF defense for the cookie-bearing auth endpoints: reject requests whose Origin
// is not on the allowlist. The access-token API is header-based (CSRF-immune); only
// these cookie endpoints need this guard.
const requireTrustedOrigin = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser / same-origin server call
  const ok = allowedOrigins.includes(origin) ||
    (!IS_PROD && (origin.startsWith('http://192.168.') || origin.startsWith('http://172.') || origin.startsWith('http://10.')));
  if (!ok) return res.status(403).json({ success: false, error: 'Untrusted origin.' });
  next();
};

// Issue a fresh access token + a new rotated refresh session, set the cookie.
const issueSession = async (res, user, meta = {}) => {
  const rawRefresh = crypto.randomBytes(48).toString('hex');
  await RefreshSession.create({
    tokenHash: hashToken(rawRefresh),
    userId: user._id,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: meta.userAgent?.slice(0, 200),
  });
  res.cookie(REFRESH_COOKIE, rawRefresh, refreshCookieOptions());
  return signAccessToken(user);
};

// Revoke every active refresh session for a user — call on password/role change
// or account deletion so existing logins can no longer silently refresh.
const revokeUserSessions = (userId) =>
  RefreshSession.updateMany({ userId, revoked: false }, { revoked: true });

// ── BOUNDARY VALIDATION ──────────────────────────────────────────────────────
// validate(schema) parses req.body against a Zod schema. Zod strips unknown keys
// by default, so this doubles as mass-assignment (BOPLA) defense: req.body is
// REPLACED with only the allowlisted, type-checked fields before it reaches any
// handler or Model.create(). Returns 422 with field errors on failure.
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      success: false,
      error: 'Validation failed.',
      details: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  req.body = result.data;
  next();
};

// Reusable field primitives
const zName  = z.string().trim().min(1).max(120);
const zMoney = z.number().finite().min(0);
const zRole  = z.enum(['superadmin', 'Manager', 'Staff', 'Cashier']).or(z.string().trim().min(1).max(40));

// Schemas for the previously raw `Model.create(req.body)` routes (mass-assignment fixes)
const loginSchema    = z.object({ name: zName, password: z.string().min(1).max(200) });
const userCreateSchema = z.object({ name: zName, password: z.string().min(6).max(200), role: zRole.optional() });
const addonSchema    = z.object({
  name: zName, price: zMoney, category: z.string().trim().max(60).optional(),
  recipe: z.array(z.object({ invId: z.string(), name: z.string(), qty: z.number(), cost: z.number().optional(), unit: z.string().optional() })).optional(),
});

// Reusable recipe-line shape
const zRecipe = z.array(z.object({
  invId: z.string().optional(), name: z.string().optional(),
  qty: z.number().optional(), cost: z.number().optional(), unit: z.string().optional(),
})).optional();

// Mass-assignment fixes: each schema OMITS server-controlled fields
// (codes, isArchived, timestamps) so a client can never set them via create().
const productSchema = z.object({
  name: zName, description: z.string().max(2000).optional(), category: z.string().trim().max(80).optional(),
  basePrice: zMoney, baseSize: z.string().max(40).optional(), baseRecipe: zRecipe,
  sizes: z.array(z.object({ sizeCode: z.string().optional(), name: z.string().optional(), price: zMoney.optional(), recipe: zRecipe })).optional(),
  addOns: z.array(z.object({ name: z.string(), price: zMoney.optional(), recipe: zRecipe })).optional(),
  image: z.string().optional(), isAvailable: z.boolean().optional(),
  modifierGroups: z.array(z.string()).optional(),
});
const comboSchema = z.object({
  name: zName, description: z.string().max(2000).optional(), price: zMoney, image: z.string().optional(),
  isActive: z.boolean().optional(),
  items: z.array(z.object({ productId: z.string().optional(), name: z.string().optional(), sizeName: z.string().optional(), quantity: z.number().int().positive().optional() })).optional(),
});
const discountSchema = z.object({
  name: zName, percentage: z.number().min(0).max(100).optional(), isSCPWD: z.boolean().optional(),
});
const roleSchema = z.object({ name: zName });
const modifierGroupSchema = z.object({
  name: zName, isRequired: z.boolean().optional(),
  minSelect: z.number().int().min(0).optional(), maxSelect: z.number().int().min(0).optional(),
  options: z.array(z.object({ name: z.string(), price: zMoney.optional(), recipe: zRecipe })).optional(),
});

// mkSeqRef — ASYNC. Use for entries that have no natural document ID.
//   Atomically increments a per-prefix-per-year counter, zero-collision.
//   e.g.  await mkSeqRef('EXP')       →  "EXP-2025-000042"
//          await mkSeqRef('INV-SPOIL') →  "INV-SPOIL-2025-000007"
const mkSeqRef = async (prefix) => {
  const year    = new Date().getFullYear();
  const key     = `${prefix}-${year}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `${key}-${counter.seq.toString().padStart(6, '0')}`;
};

// --- HEALTH CHECK (no auth, for load balancers / uptime monitors) ---
app.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState; // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const healthy = dbState === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db: states[dbState] || 'unknown',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' }
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Order rate limit exceeded. Slow down.' }
});

// Baseline throttle for the whole API surface (scraping / brute / cheap-DoS guard).
// The stricter loginLimiter / orderLimiter stack on top of this for their routes.
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,            // generous for a busy POS tablet; well above normal burst
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' }
});
app.use('/api', generalApiLimiter);


// --- MONGODB CONNECTION (single connect) ---
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000, // fail fast on an unreachable cluster instead of hanging
  socketTimeoutMS: 45000,
  maxPoolSize: 20,
})
  .then(async () => {
    log.info('Connected to MongoDB Atlas');
    try {
      const adminCount = await User.countDocuments();
      if (adminCount === 0) {
        const defaultPass = process.env.ADMIN_PASS || 'ChangeMe@2026!';
        const hashedPassword = await bcrypt.hash(defaultPass, BCRYPT_ROUNDS);
        const userCode = 'ADN-A0001';
        await User.create({ userCode, name: 'Super Admin', password: hashedPassword, role: 'superadmin' });
        log.info(`✅ Default Superadmin seeded: Code [${userCode}]`);
      }
      // Backfill: any legacy "Super Admin" user without a role gets `superadmin` set
      const backfill = await User.updateMany(
        { name: 'Super Admin', $or: [{ role: { $exists: false } }, { role: null }, { role: '' }] },
        { $set: { role: 'superadmin' } }
      );
      if (backfill.modifiedCount > 0) log.info(`✅ Backfilled role=superadmin on ${backfill.modifiedCount} legacy admin doc(s)`);
    } catch (err) {
      log.error({ err }, 'Seeding error');
    }

    // ── ONE-TIME COA MIGRATION (4-digit → 6-digit SAP codes) ──────────────────
    // Rewrites historical journal-entry line codes via CODE_MAP. Guarded by a
    // Settings flag so it runs exactly once.
    try {
      const done = await Settings.findOne({ key: 'coaV2Migrated' }).lean();
      if (!done) {
        let migrated = 0;
        for (const [oldC, newC] of Object.entries(CODE_MAP)) {
          const r = await JournalEntry.updateMany(
            { 'lines.accountCode': oldC },
            { $set: { 'lines.$[el].accountCode': newC } },
            { arrayFilters: [{ 'el.accountCode': oldC }] }
          );
          migrated += r.modifiedCount || 0;
        }
        await Settings.updateOne({ key: 'coaV2Migrated' }, { $set: { value: true } }, { upsert: true });
        log.info({ entriesTouched: migrated }, '✅ COA v2: migrated journal entry account codes 4-digit → 6-digit');
      }
    } catch (err) {
      log.error({ err }, 'COA migration error');
    }

    // Sync atomic Counters to the highest existing seq so new inserts never collide
    try {
      // Orders: ORD-YYYY-AXXXX
      const allOrders = await Order.find({}, { orderNumber: 1 }).lean();
      const orderPrefixMax = {};
      for (const o of allOrders) {
        const m = o.orderNumber?.match(/^(ORD-\d{4})-A(\d+)$/);
        if (m) orderPrefixMax[m[1]] = Math.max(orderPrefixMax[m[1]] || 0, parseInt(m[2], 10));
      }
      for (const [prefix, seq] of Object.entries(orderPrefixMax)) {
        await Counter.collection.updateOne({ _id: prefix }, { $max: { seq } }, { upsert: true });
      }

      // Users: ADN-AXXXX
      const allUsers = await User.find({}, { userCode: 1 }).lean();
      let maxUserSeq = 0;
      for (const u of allUsers) {
        const m = u.userCode?.match(/^ADN-A(\d+)$/);
        if (m) maxUserSeq = Math.max(maxUserSeq, parseInt(m[1], 10));
      }
      if (maxUserSeq > 0) await Counter.collection.updateOne({ _id: 'ADN' }, { $max: { seq: maxUserSeq } }, { upsert: true });

      // Products: XXX-AXXXX (variable category prefix)
      const allProducts = await Product.find({}, { productCode: 1 }).lean();
      const prodPrefixMax = {};
      for (const p of allProducts) {
        const m = p.productCode?.match(/^([A-Z]{3})-A(\d+)$/);
        if (m) prodPrefixMax[m[1]] = Math.max(prodPrefixMax[m[1]] || 0, parseInt(m[2], 10));
      }
      for (const [prefix, seq] of Object.entries(prodPrefixMax)) {
        await Counter.collection.updateOne({ _id: prefix }, { $max: { seq } }, { upsert: true });
      }

      log.info('Counters synced from existing data');
    } catch (err) {
      log.error({ err }, 'Counter sync error');
    }
  })
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

  // --- 🔒 NEW: JWT MIDDLEWARE 🔒 ---
  const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // Attach user info to the request
      next();
    } catch (error) {
      // 401 (not 403) for an expired/invalid token so the client silently refreshes
      // and retries — otherwise an idle session shows "Forbidden" until manual reload.
      return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired token' });
    }
  };

  // JWT-only auth (used by some routes that don't need RBAC).
  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch (err) {
      res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
    }
  };

  // Hard-gate: role === 'superadmin' ONLY — never trust name strings.
  const requireSuperAdmin = (req, res, next) => {
    if (req.user?.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Forbidden: Superadmin role required.' });
    }
    next();
  };

  // Accepts valid JWT (staff/admin) OR active QR session (customer dine-in).
  const verifyOrderAuth = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        return next();
      } catch {
        // 401 so the client refreshes + retries instead of failing an expired session.
        return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
      }
    }
    const { sessionId, table } = req.body;
    if (sessionId && table && !['Takeout', 'Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(table)) {
      const qrSession = await QRSession.findOne({ sessionId, table, isActive: true });
      if (qrSession && new Date() < qrSession.expiresAt) {
        req.qrSession = qrSession;
        return next();
      }
      return res.status(401).json({ success: false, error: 'QR session expired or invalid. Please scan again.' });
    }
    return res.status(401).json({ success: false, error: 'Unauthorized: provide a staff token or a valid QR session.' });
  };

// --- DATABASE SCHEMAS ---
const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  department: { type: String, enum: ['Kitchen', 'Bar'], default: 'Kitchen' }
}, { timestamps: true });
const Category = mongoose.model('Category', CategorySchema);
// ── MODIFIER GROUPS ─────────────────────────────────────────────────────────
// A modifier group is a required or optional selection prompt on a product.
// e.g. "Choose your milk" (required, pick 1) or "Extra shots" (optional, 0–3).
const ModifierGroupSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  isRequired: { type: Boolean, default: true },
  minSelect:  { type: Number, default: 1 },
  maxSelect:  { type: Number, default: 1 },
  options:    [{ name: String, price: { type: Number, default: 0 }, recipe: [{ invId: String, name: String, qty: Number, unit: String }] }]
}, { timestamps: true });
const ModifierGroup = mongoose.model('ModifierGroup', ModifierGroupSchema);

// ── SETTINGS ─────────────────────────────────────────────────────────────────
// Key/value store for system-wide toggles (isAcceptingQROrders, etc.)
const SettingsSchema = new mongoose.Schema({ key: { type: String, unique: true, required: true }, value: { type: mongoose.Schema.Types.Mixed } });
const Settings = mongoose.model('Settings', SettingsSchema);

// --- ADD-ONS SCHEMA & ROUTES ---
const AddOnSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, default: 'Extras' },
  recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }]
}, { timestamps: true });
const AddOn = mongoose.model('AddOn', AddOnSchema);

app.get('/api/addons', async (req, res) => {
  try {
    const addons = await AddOn.find();
    res.json({ success: true, addons });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// requireSuperAdmin: only superadmin can create or remove add-ons (menu integrity)
app.post('/api/addons', verifyToken, requireSuperAdmin, validate(addonSchema), async (req, res) => {
  try {
    const newAddOn = await AddOn.create(req.body);
    emitToAll('menuUpdated');
    res.json({ success: true, addon: newAddOn });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.delete('/api/addons/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await AddOn.findByIdAndDelete(req.params.id);
    emitToAll('menuUpdated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});
// 1. UPDATE THE PRODUCT SCHEMA (Add Recipes)
const ProductSchema = new mongoose.Schema({
  productCode: String,
  name: { type: String, required: true, index: true },
  description: String,
  category: { type: String, index: true },
  basePrice: { type: Number, required: true },
  baseSize: String,
  baseRecipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }],
  sizes: [{
    sizeCode: String,
    name: String,
    price: Number,
    recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }]
  }],
  addOns: [{ name: String, price: Number, recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }] }],
  image: String,
  isAvailable:    { type: Boolean, default: true },   // manual 86 toggle (superadmin)
  isArchived:     { type: Boolean, default: false },   // soft-delete; hidden from menu + POS
  modifierGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ModifierGroup' }]  // required/optional selection prompts
}, { timestamps: true });
const Product = mongoose.model('Product', ProductSchema);

// ── COMBO / BUNDLE (Product Promo) ───────────────────────────────────────────
// A fixed-price set of existing products sold as one line, e.g.
// "Budget Meal: Americano + Pandesal = ₱99". On completion the ERP engine
// deducts each component product's recipe so COGS and stock stay accurate.
const ComboSchema = new mongoose.Schema({
  comboCode:   String,
  name:        { type: String, required: true },
  description: String,
  price:       { type: Number, required: true },   // fixed bundle price
  image:       String,
  isActive:    { type: Boolean, default: true },
  items: [{
    productId: String,
    name:      String,
    sizeName:  String,   // optional specific size; '' = base
    quantity:  { type: Number, default: 1 },
  }],
}, { timestamps: true });
const Combo = mongoose.model('Combo', ComboSchema);

const OrderSchema = new mongoose.Schema({
  orderNumber: String,
  table: String,
  isArchived: { type: Boolean, default: false, index: true },
  status: { type: String, default: 'Pending' },
  // Parked / held tabs: saved but not yet sent to the kitchen or completed.
  isParked: { type: Boolean, default: false, index: true },
  // Idempotency key — prevents duplicate orders from retries / offline-queue replays.
  idempotencyKey: { type: String, index: true, sparse: true },
  customerName: { type: String, default: 'Guest' },
  paymentMethod: { type: String, default: 'Cash' },
  
  // Item Level Tracking
items: [{
    productId: String,
    name: String,
    price: Number,
    quantity: Number,
    selectedAddOns: [{ name: String, price: Number }],
    hasDiscount: { type: Boolean, default: true },
    department: { type: String, default: 'Kitchen' }, // <-- NEW: Routes to Kitchen or Bar
    itemStatus: { type: String, default: 'Received' }, // <-- NEW: Item-level progress
    discountPercent: { type: Number, default: 0 },
    // Combo / bundle line: deducts each component recipe on completion
    isCombo: { type: Boolean, default: false },
    comboItems: [{ productId: String, name: String, sizeName: String, quantity: Number }]
  }],
  
  // Strict Accounting Fields
  isVatInclusive: { type: Boolean, default: true }, // Enforces Rule 3 (System-wide standard)
  discountType: { type: String, default: 'None' },  // Enforces Rules 6 & 9
  discountBy: { type: String },                      // staff who applied the discount (logged-in user, not the order's cashier)

  subtotal: { type: Number, default: 0 },           // Gross Sales
  vatableSales: { type: Number, default: 0 },       // Base for VAT
  vatExemptSales: { type: Number, default: 0 },     // Base for SC/PWD
  vatRate: { type: Number, default: 0 },
  vatAmount: { type: Number, default: 0 },
  discountPercent: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  isVatExempt: { type: Boolean, default: true },
  // --- ENTERPRISE FIELDS ---
  cashier: { type: String, default: 'System', index: true },
  transactionType: { type: String, enum: ['NORMAL', 'COMPLIMENTARY', 'REFUND', 'VOID'], default: 'NORMAL' },
  isComplimentary: { type: Boolean, default: false },
  employeeName: { type: String, default: '' },          // beneficiary (who the comp is for)
  complimentaryReasonType: {
    type: String,
    enum: ['VIP_CUSTOMER','CUSTOMER_RECOVERY','FOOD_QUALITY_ISSUE','SERVICE_DELAY','EMPLOYEE_MEAL',
           'OWNER_APPROVAL','MARKETING_PROMOTION','INFLUENCER_PROMO','SYSTEM_ERROR',
           'TRAINING_ORDER','LOYALTY_REWARD','EVENT_SPONSORSHIP'],
    default: null
  },
  complimentaryReasonNote: { type: String, default: '' },
  complimentaryApprovedBy: { type: String, default: '' },
  complimentaryApprovedAt: { type: Date },
  complimentaryAmount: { type: Number, default: 0 },
  complimentaryCost:   { type: Number, default: 0 },
  complimentaryReferenceNumber: { type: String, default: '' },
  voidReason: { type: String, default: '' },
  amountTendered: { type: Number, default: 0 },
  changeDue: { type: Number, default: 0 },
  // --- DELIVERY / PICKUP FIELDS ---
  deliveryAddress: { type: String, default: '' },
  customerPhone:   { type: String, default: '' },
  deliveryFee:     { type: Number, default: 0 },
  scheduledTime:   { type: String, default: '' },
  dispatchStatus:  { type: String, enum: ['', 'Preparing', 'Out for Delivery', 'Awaiting Pickup', 'Delivered', 'Picked Up'], default: '' },
  // Customer / cashier special instructions (e.g. "no sugar", "extra shot")
  orderNotes: { type: String, default: '' },
  // Guest/cover count (for analytics — how many people at the table)
  guestCount: { type: Number, default: 1 },
  // Split-payment breakdown: [{ method, amount }]
  payments: [{ method: String, amount: Number }],
  // A/R settlement tracking (delivery partner payouts: Grab/Foodpanda/Manual Delivery)
  arSettled:        { type: Boolean, default: false },
  arSettledAt:      { type: Date },
  arSettledAmount:  { type: Number, default: 0 },
  arSettledMethod:  { type: String, default: '' },
  arSettledNote:    { type: String, default: '' }
}, { timestamps: true });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1, isArchived: 1 });
OrderSchema.index({ orderNumber: 1 }, { unique: true, sparse: true });
const Order = mongoose.model('Order', OrderSchema);

const QRSessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true },
  table: String,
  isActive: { type: Boolean, default: true },
  expiresAt: Date
});
const QRSession = mongoose.model('QRSession', QRSessionSchema);

// --- NEW ERP SCHEMAS ---
const InventorySchema = new mongoose.Schema({
  itemCode: String,
  itemName: String,
  stockQty: { type: Number, default: 0 },           // ALWAYS stored in base unit (g/ml/pcs) for recipe precision
  unit: String,                                       // base unit: 'g', 'ml', 'pcs'
  unitCost: { type: Number, default: 0 },             // ALWAYS per base unit (e.g. P0.07/ml when 1L costs P70)
  lowStockThreshold: { type: Number, default: 0 },
  // Display layer — what operators see (kg / L / pcs). storage stays in base units for recipe precision.
  displayUnit:     { type: String, default: '' },     // 'L', 'kg', 'pcs', 'g', 'ml' — falls back to `unit` when empty
  unitMultiplier:  { type: Number, default: 1 },      // base units per displayUnit (1 for g/ml/pcs; 1000 for L/kg)
  // Suggested Retail Price (per displayUnit) — optional reference for items intended for resale.
  srp:             { type: Number, default: 0 },
  // Expiry monitoring — multi-batch (FEFO)
  // expiryDate is the SOONEST expiry across all batches (main view shows this).
  expiryDate: { type: Date },
  expiryWarnDays: { type: Number, default: 7 },
  expiryBatches: [{
    qty:         { type: Number, default: 0 },      // qty in BASE units (ml/g/pcs)
    expiryDate:  { type: Date },
    receivedAt:  { type: Date, default: Date.now },
    reference:   { type: String, default: '' },
    unitCost:    { type: Number, default: 0 }       // per-base-unit cost when this batch was received
  }]
}, { timestamps: true });
InventorySchema.index({ expiryDate: 1 });
InventorySchema.index({ itemName: 1 });
const Inventory = mongoose.model('Inventory', InventorySchema);

const JournalEntrySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now, index: true },
  reference: { type: String, index: true },
  description: String,
  lines: [{
    accountCode: String,
    accountName: String,
    debit: { type: Number, default: 0 },
    credit: { type: Number, default: 0 }
  }],
  totalDebit: Number,
  totalCredit: Number
}, { timestamps: true });
const JournalEntry = mongoose.model('JournalEntry', JournalEntrySchema);

const InventoryMovementSchema = new mongoose.Schema({
  date: { type: Date, required: true }, // Normalized to start of the day
  inventoryId: String,
  itemName: String,
  unit: String,
  beginningBalance: { type: Number, default: 0 },
  purchasesIn: { type: Number, default: 0 },
  salesOut: { type: Number, default: 0 },
  systemEndingBalance: { type: Number, default: 0 },
  actualPhysicalCount: { type: Number, default: null },
  variance: { type: Number, default: 0 },
  isClosed: { type: Boolean, default: false }
});
const InventoryMovement = mongoose.model('InventoryMovement', InventoryMovementSchema);

const StockCardSchema = new mongoose.Schema({
  inventoryId: String,
  itemName: String,
  date: { type: Date, default: Date.now },
  type: String, // 'Restock', 'Sale', 'Adjustment', 'Initial'
  reference: String, // Order Number, JE ref, etc.
  qtyChange: Number, // Positive for in, Negative for out
  balanceAfter: Number,
  unitCost: Number,
  remarks: String
});
StockCardSchema.index({ inventoryId: 1 });
StockCardSchema.index({ reference: 1 });
const StockCard = mongoose.model('StockCard', StockCardSchema);

// --- SHIFT MANAGEMENT SCHEMA ---
const ShiftSchema = new mongoose.Schema({
  cashierId:       { type: String, required: true },
  cashierName:     { type: String, required: true },
  startingCash:    { type: Number, required: true, default: 0 },
  shiftStart:      { type: Date, default: Date.now },
  shiftEnd:        Date,
  salesTotal:      { type: Number, default: 0 },   // Cash sales only during this shift
  expectedCash:    Number,                          // startingCash + salesTotal
  actualCash:      Number,                          // What cashier counted at close
  variance:        Number,                          // actualCash - expectedCash
  depositedAmount: { type: Number, default: 0 },   // Total posted to bank this shift
  isReconciled:    { type: Boolean, default: false },
  status:          { type: String, default: 'Open' } // 'Open' | 'Closed' | 'Reconciled'
}, { timestamps: true });
const Shift = mongoose.model('Shift', ShiftSchema);

// ── STAFF CLOCK ENTRIES ──────────────────────────────────────────────────────
const ClockEntrySchema = new mongoose.Schema({
  staffId:         { type: String, required: true, index: true },
  staffName:       { type: String, required: true },
  clockIn:         { type: Date, default: Date.now },
  clockOut:        { type: Date },
  durationMinutes: { type: Number },        // gross minutes (clockIn → clockOut)
  breakMinutes:    { type: Number, default: 0 },  // total break minutes used this shift
  workedMinutes:   { type: Number },        // gross minus breaks (for payroll)
  breaks:          [{ start: Date, end: Date, minutes: Number }],
  date:            { type: String, index: true }, // YYYY-MM-DD (Manila)
  notes:           { type: String, default: '' }
}, { timestamps: true });
const ClockEntry = mongoose.model('ClockEntry', ClockEntrySchema);

// The owner (superadmin) is excluded from staff-facing reports — hours, shift
// history, cashier variance — since they're not a tracked employee/cashier.
// Returns their user _id strings for use in a $nin filter.
const ownerUserIds = async () => {
  const owners = await User.find({ role: 'superadmin' }, { _id: 1 }).lean();
  return owners.map(o => String(o._id));
};

// --- CHART OF ACCOUNTS ---
const AccountSchema = new mongoose.Schema({
  code:          { type: String, unique: true },
  name:          String,
  type:          String, // 'Asset' | 'Liability' | 'Income' | 'Expense'
  normalBalance: String, // 'Debit' | 'Credit'
}, { timestamps: true });
const Account = mongoose.model('Account', AccountSchema);

// --- BANK DEPOSITS ---
const BankDepositSchema = new mongoose.Schema({
  shiftId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  amount:             { type: Number, required: true },
  depositedBy:        String,
  reference:          String,  // slip number or note
  journalEntryId:     { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
  drawerBalanceAfter: Number,
  isDrawerReconciled: { type: Boolean, default: false },
}, { timestamps: true });
const BankDeposit = mongoose.model('BankDeposit', BankDepositSchema);

// Seed cash management accounts (codes match existing JournalEntry account codes)
const DEFAULT_ACCOUNTS = [
  { code: '111000', name: 'Cash on Hand',             type: 'Asset',   normalBalance: 'Debit'  },
  { code: '112000', name: 'Cash in Bank',              type: 'Asset',   normalBalance: 'Debit'  },
  { code: '410000', name: 'Sales Revenue',             type: 'Income',  normalBalance: 'Credit' },
  { code: '930000', name: 'Cash Short & Over Expense', type: 'Expense', normalBalance: 'Debit'  },
  { code: '830000', name: 'Cash Short & Over Income',  type: 'Income',  normalBalance: 'Credit' },
];
(async () => {
  for (const acct of DEFAULT_ACCOUNTS) {
    await Account.findOneAndUpdate({ code: acct.code }, acct, { upsert: true, setDefaultsOnInsert: true });
  }
})();

const UserSchema = new mongoose.Schema({
  userCode: { type: String, index: true },
  name: { type: String, required: true, index: true },
  password: { type: String, required: true },
  role: { type: String, default: 'Staff' }
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

// Refresh-token session store — enables instant server-side revocation.
// tokenHash = sha256(rawRefreshToken); the raw token lives only in the client's
// httpOnly cookie. `revoked` is set on logout/rotation; expired docs auto-purge
// via the TTL index on expiresAt.
const RefreshSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, index: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  revoked:   { type: Boolean, default: false },
  replacedBy:{ type: String },          // tokenHash of the rotated successor (audit trail)
  userAgent: { type: String },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL auto-cleanup
const RefreshSession = mongoose.model('RefreshSession', RefreshSessionSchema);

// --- NEW: CUSTOM ROLES SCHEMA & ROUTES ---
const RoleSchema = new mongoose.Schema({ name: String });
const Role = mongoose.model('Role', RoleSchema);

app.get('/api/roles', verifyToken, async (req, res) => {
  const roles = await Role.find();
  res.json({ success: true, roles });
});
app.post('/api/roles', verifyToken, requireSuperAdmin, validate(roleSchema), async (req, res) => {
  const newRole = await Role.create(req.body);
  res.json({ success: true, role: newRole });
});
app.delete('/api/roles/:id', verifyToken, async (req, res) => {
  await Role.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// 1. Minimal Audit Log Schema (New)
const AuditLogSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  action: { type: String, required: true },
  targetReference: { type: String, required: true },
  details: { type: Object },
  timestamp: { type: Date, default: Date.now }
});
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

// (Auth middleware — verifyToken, requireAuth, requireSuperAdmin, verifyOrderAuth —
//  are defined earlier, before the first route that uses them, to avoid TDZ errors.)

const DiscountSchema = new mongoose.Schema({
  name: String,        // e.g., "Senior Citizen 20%", "Employee 10%"
  percentage: Number,  // e.g., 20
  isSCPWD: { type: Boolean, default: false },
});
const Discount = mongoose.model('Discount', DiscountSchema);

const EODRecordSchema = new mongoose.Schema({
  dateString: String, // e.g., '2026-04-29'
  status: { type: String, default: 'OPEN' }, // 'OPEN' or 'LOCKED'
  lockedAt: Date,
  lockedBy: String
});
const EODRecord = mongoose.model('EODRecord', EODRecordSchema);

// Atomic sequence counter — one document per prefix, incremented with $inc to prevent race conditions
const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = mongoose.model('Counter', CounterSchema);

// --- API ROUTES ---

// --- DISCOUNT ROUTES ---
app.get('/api/discounts', verifyToken, async (req, res) => {
  try {
    const discounts = await Discount.find();
    res.json({ success: true, discounts });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.post('/api/discounts', verifyToken, validate(discountSchema), async (req, res) => {
  try {
    const newDiscount = await Discount.create(req.body);
    res.json({ success: true, discount: newDiscount });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.delete('/api/discounts/:id', verifyToken, async (req, res) => {
  try {
    await Discount.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- INVENTORY PHYSICAL COUNT & DAILY CLOSE ---

// --- 1. FETCH EOD STATUS & REAL MOVEMENTS ---
app.get('/api/inventory/eod-data', verifyToken, async (req, res) => {
  try {
    // Get local date string (e.g., "2026-04-29")
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    
    let eod = await EODRecord.findOne({ dateString: todayStr });
    if (!eod) eod = { status: 'OPEN', lockedAt: null };

    // Calculate real movements for today using StockCard
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const movements = await StockCard.aggregate([
      { $match: { date: { $gte: startOfDay } } },
      { $group: {
          _id: "$inventoryId",
          // 'In' includes Restocks, 'Out' includes Sales (which are negative, so we abs() them later)
          in: { $sum: { $cond: [{ $gt: ["$qtyChange", 0] }, "$qtyChange", 0] } },
          out: { $sum: { $cond: [{ $lt: ["$qtyChange", 0] }, "$qtyChange", 0] } }
      }}
    ]);

    const movementMap = {};
    movements.forEach(m => {
      movementMap[m._id] = { in: m.in, out: Math.abs(m.out) };
    });

    res.json({ success: true, status: eod.status, lockedAt: eod.lockedAt, movement: movementMap });
  } catch(err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- 2. SUBMIT & LOCK EOD ---
app.post('/api/inventory/count', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    
    // STRICT CHECK: Is it already locked?
    const existingEOD = await EODRecord.findOne({ dateString: todayStr }).session(session);
    if (existingEOD && existingEOD.status === 'LOCKED') {
      await session.abortTransaction(); session.endSession();
      return res.status(403).json({ success: false, error: 'ALREADY_CLOSED: You cannot submit another EOD for today.' });
    }

    const { counts, reasons, adminName } = req.body; 
    const items = await Inventory.find().session(session);

    for (const item of items) {
      if (counts[item._id] === undefined || counts[item._id] === '') continue; 
      
      const actualCount = Number(counts[item._id]);
      const variance = actualCount - item.stockQty;

      if (variance !== 0) {
        const specificReason = reasons && reasons[item._id] ? reasons[item._id] : 'Unaccounted Variance';
        
        const eodAdjRef = await mkSeqRef('EOD-ADJ');

        await StockCard.create([{
          inventoryId: item._id, itemName: item.itemName, type: 'Adjustment',
          reference: eodAdjRef, qtyChange: variance, balanceAfter: actualCount,
          remarks: `EOD Audit: ${specificReason}`
        }], { session });

        const valueAbs = Math.abs(variance) * item.unitCost;

        if (valueAbs > 0) {
          const reference = eodAdjRef;

          if (variance < 0) {
            await JournalEntry.create([{
              reference, description: `Shrinkage (${specificReason}): ${item.itemName}`,
              lines: [
                { accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: valueAbs, credit: 0 },
                { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: valueAbs }
              ], totalDebit: valueAbs, totalCredit: valueAbs
            }], { session });
          } else {
            await JournalEntry.create([{
              reference, description: `Gain (${specificReason}): ${item.itemName}`,
              lines: [
                { accountCode: '130000', accountName: 'Inventory Asset', debit: valueAbs, credit: 0 },
                { accountCode: '530000', accountName: 'Inventory Adjustment Gain', debit: 0, credit: valueAbs }
              ], totalDebit: valueAbs, totalCredit: valueAbs
            }], { session });
          }
        }
      }

      item.stockQty = actualCount;
      await item.save({ session });
    }

    // LOCK THE DAY
    await EODRecord.findOneAndUpdate(
      { dateString: todayStr },
      { status: 'LOCKED', lockedAt: new Date(), lockedBy: adminName || 'Admin' },
      { upsert: true, new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    emitToMgr('erpUpdated');
    res.json({ success: true, message: "End of day locked." });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- UNLOCK / REOPEN EOD (ADMIN ONLY) ---
app.post('/api/inventory/eod/reopen', verifyToken, async (req, res) => {
  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    
    // Find today's lock
    const eod = await EODRecord.findOne({ dateString: todayStr });
    if (!eod || eod.status === 'OPEN') return res.status(400).json({ success: false, error: 'Day is not locked.' });

    // Reopen it
    eod.status = 'OPEN';
    await eod.save();

    emitToMgr('erpUpdated'); // Tell all iPads the register is open again!
    res.json({ success: true, message: 'Day reopened successfully.' });
  } catch(err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/inventory/history/:id', verifyToken, async (req, res) => {
  try {
    const history = await StockCard.find({ inventoryId: req.params.id }).sort({ date: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Fetch ALL stock card history for the master PDF report
app.get('/api/inventory/history', verifyToken, async (req, res) => {
  try {
    const history = await StockCard.find().sort({ date: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});
// Categories
app.get('/api/categories', async (req, res) => {
  const categories = await Category.find().lean();
  res.json({ success: true, categories });
});

app.post('/api/categories', verifyToken, async (req, res) => {
  // Save the department along with the name
  const newCat = await Category.create({ 
    name: req.body.name, 
    department: req.body.department || 'Kitchen' 
  });
  emitToAll('menuUpdated');
  res.json({ success: true, category: newCat });
});

// --- NEW: UPDATE CATEGORY ROUTE ---
app.put('/api/categories/:id', verifyToken, async (req, res) => {
  try {
    const updated = await Category.findByIdAndUpdate(
      req.params.id, 
      { name: req.body.name, department: req.body.department }, 
      { new: true }
    );
    emitToAll('menuUpdated');
    res.json({ success: true, category: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});
app.delete('/api/categories/:id', verifyToken, async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  emitToAll('menuUpdated');
  res.json({ success: true });
});

// --- 📱 STRICT QR SESSION CONTROL ---
app.post('/api/sessions/generate', verifyToken, async (req, res) => {
  try {
    const { table } = req.body;
    // KILL any previously active links for this table so there's never a duplicate online
    await QRSession.updateMany({ table, isActive: true }, { isActive: false });
    
    // Generate a secure random string
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expires in exactly 10 minutes
    
    await QRSession.create({ sessionId, table, expiresAt });
    res.json({ success: true, sessionId, table });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// The customer's phone calls this to stay alive
app.post('/api/sessions/:id/heartbeat', async (req, res) => {
  try {
    const session = await QRSession.findOne({ sessionId: req.params.id, isActive: true });
    if (!session) return res.status(404).json({ success: false, error: 'Session closed or invalid' });
    
    // Check if the 10 minutes ran out
    if (new Date() > session.expiresAt) {
      session.isActive = false;
      await session.save();
      return res.status(403).json({ success: false, error: 'Session expired due to inactivity' });
    }
    
    // If they are still active, push the expiration back another 10 minutes
    session.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await session.save();
    
    res.json({ success: true, table: session.table });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Burn the link after the order is received
app.post('/api/sessions/:id/close', async (req, res) => {
  try {
    await QRSession.findOneAndUpdate({ sessionId: req.params.id }, { isActive: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Products
app.get('/api/products', async (req, res) => {
  try {
    // Exclude soft-deleted products
    const products = await Product.find({ isArchived: { $ne: true } }).populate('modifierGroups').lean();

    // Compute stockAvailable: false when any baseRecipe ingredient is at zero / missing
    // Only run the inventory lookup if at least one product has a recipe
    const hasRecipes = products.some(p => (p.baseRecipe || []).length > 0);
    if (hasRecipes) {
      const invItems = await Inventory.find({}, { _id: 1, stockQty: 1 }).lean();
      const invMap = {};
      invItems.forEach(i => { invMap[i._id.toString()] = i.stockQty; });
      products.forEach(p => {
        const recipe = p.baseRecipe || [];
        if (recipe.length === 0) { p.stockAvailable = true; return; }
        // Every linked ingredient must have stock > 0
        p.stockAvailable = recipe.every(ing => {
          if (!ing.invId) return true;                  // unlinked — don't block the product
          const qty = invMap[ing.invId];
          return qty !== undefined && qty > 0;
        });
      });
    } else {
      products.forEach(p => { p.stockAvailable = true; });
    }

    res.json({ success: true, products });
  } catch (err) {
    log.error({ err }, 'GET /api/products failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.post('/api/products', verifyToken, validate(productSchema), async (req, res) => {
  // Generate base product code (e.g., DRS-A0001)
  const catPrefix = getCategoryPrefix(req.body.category);
  req.body.productCode = await generateNextSequence(Product, catPrefix, 'productCode');
  
  // Generate size codes if they exist (e.g., DRS-A0002, DRS-A0003)
  if (req.body.sizes && req.body.sizes.length > 0) {
    for (let i = 0; i < req.body.sizes.length; i++) {
      // Temporarily save the product to reserve the code, or generate sequentially
      const nextNum = parseInt(req.body.productCode.split('-A')[1], 10) + 1 + i;
      req.body.sizes[i].sizeCode = `${catPrefix}-A${nextNum.toString().padStart(4, '0')}`;
    }
  }

  const newProduct = await Product.create(req.body);
  emitToAll('menuUpdated');
  res.json({ success: true, product: newProduct });
});

app.put('/api/products/:id', verifyToken, async (req, res) => {
  try {
    const existing = await Product.findById(req.params.id).lean();
    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (existing && req.body.basePrice !== undefined && Number(req.body.basePrice) !== Number(existing.basePrice)) {
      await AuditLog.create({
        userId: req.user ? req.user.name : 'System',
        action: 'PRODUCT_PRICE_CHANGED',
        targetReference: updatedProduct.productCode || req.params.id,
        details: { name: updatedProduct.name, oldPrice: existing.basePrice, newPrice: updatedProduct.basePrice }
      });
    }
    emitToAll('menuUpdated');
    res.json({ success: true, product: updatedProduct });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// PATCH /api/products/:id/availability — superadmin toggle (86 a product on/off)
app.patch('/api/products/:id/availability', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean')
      return res.status(400).json({ success: false, error: 'isAvailable must be true or false.' });
    const product = await Product.findByIdAndUpdate(req.params.id, { isAvailable }, { new: true });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found.' });
    await AuditLog.create({
      userId: req.user?.name || 'System',
      action: isAvailable ? 'PRODUCT_RESTORED' : 'PRODUCT_86D',
      targetReference: product.productCode || req.params.id,
      details: { name: product.name, isAvailable, changedBy: req.user?.name }
    });
    emitToAll('menuUpdated'); // customer menu + POS re-fetch immediately
    res.json({ success: true, product });
  } catch (err) {
    log.error({ err }, 'PATCH /api/products/:id/availability failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Change to PUT or handle inside DELETE for archiving
app.delete('/api/products/:id', verifyToken, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id, 
      { isArchived: true }, 
      { new: true }
    );
    
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });

    // Log the archive event
    await AuditLog.create({
      userId: req.user ? req.user.name : 'System',
      action: 'PRODUCT_ARCHIVED',
      targetReference: product.productCode || req.params.id,
      details: { name: product.name }
    });

    emitToAll('menuUpdated');
    res.json({ success: true, message: 'Product securely archived.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Orders
app.get('/api/orders', verifyToken, async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    const baseFilter = { isArchived: false, isParked: { $ne: true } };
    if (search && search.trim()) {
      const rx = { $regex: search.trim(), $options: 'i' };
      baseFilter.$or = [{ customerName: rx }, { orderNumber: rx }, { table: rx }];
    }
    const query = Order.find(baseFilter).sort({ createdAt: -1 }).lean();
    if (page && limit) {
      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
      query.skip((pageNum - 1) * limitNum).limit(limitNum);
      const [orders, total] = await Promise.all([query, Order.countDocuments(baseFilter)]);
      return res.json({ success: true, orders, total, page: pageNum, limit: limitNum });
    }
    const orders = await query;
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/orders/archives', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { search, start, end, page = 1, limit: lim = 200 } = req.query;
    const filter = { isArchived: true };
    if (search?.trim()) {
      const rx = { $regex: search.trim(), $options: 'i' };
      filter.$or = [{ customerName: rx }, { orderNumber: rx }, { cashier: rx }, { table: rx }];
    }
    if (start || end) {
      filter.createdAt = {};
      if (start) filter.createdAt.$gte = new Date(start);
      if (end) { const d = new Date(end); d.setHours(23, 59, 59, 999); filter.createdAt.$lte = d; }
    }
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(500, parseInt(lim) || 200);
    const [archives, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      Order.countDocuments(filter)
    ]);
    res.json({ success: true, archives, total, page: pageNum });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ── PARKED ORDERS / OPEN TABS ────────────────────────────────────────────────
// IMPORTANT: these literal paths MUST be registered before '/api/orders/:id',
// otherwise Express matches ':id' first and treats "parked"/"park" as an order id.
app.post('/api/orders/park', verifyToken, async (req, res) => {
  try {
    const { items, customerName, table, orderNotes, guestCount } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, error: 'Cannot park an empty cart.' });
    const subtotal = items.reduce((s, i) => s + ((i.price || 0) + (i.selectedAddOns || []).reduce((a, x) => a + Number(x.price || 0), 0)) * (i.quantity || 1), 0);
    const year = new Date().getFullYear();
    const orderNumber = await generateNextSequence(Order, `ORD-${year}`, 'orderNumber');
    const parked = await Order.create({
      orderNumber, items, customerName: customerName || 'Guest', table: table || 'Dine-In',
      orderNotes: (orderNotes || '').trim().slice(0, 300), guestCount: Math.max(1, parseInt(guestCount) || 1),
      subtotal, total: subtotal, status: 'Parked', isParked: true, cashier: req.user?.name || 'System',
    });
    res.json({ success: true, order: parked });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.get('/api/orders/parked', verifyToken, async (req, res) => {
  try {
    const parked = await Order.find({ isParked: true, isArchived: false }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, parked });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.delete('/api/orders/parked/:id', verifyToken, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, isParked: true });
    if (!order) return res.status(404).json({ success: false, error: 'Parked order not found.' });
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true, order });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// Fetch a single order by ID (Used for Customer Status Lock)
app.get('/api/orders/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "Order not found" });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });
    res.json(order); // Note: We send back just the order object so the frontend can read it directly
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post('/api/orders', orderLimiter, verifyOrderAuth, async (req, res) => {
  try {
    // 1. IDEMPOTENCY CHECK
    const idempotencyKey = req.headers['idempotency-key'];
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({ idempotencyKey });
      if (existingOrder) return res.status(200).json({ success: true, order: existingOrder, message: "Duplicate prevented." });
    }

    let { items, discountPercent = 0, discountFlat = 0, table, customerName, sessionId, isComplimentary = false, employeeName = '', orderNotes = '', guestCount = 1, payments: paymentsInput } = req.body;

    // Block QR-originated orders when kitchen has toggled off (staff POS unaffected)
    if (req.qrSession) {
      const qrSetting = await Settings.findOne({ key: 'isAcceptingQROrders' }).lean();
      const isOpen = qrSetting ? qrSetting.value !== false : true;
      if (!isOpen) return res.status(403).json({ success: false, error: 'Kitchen is currently closed. Please see staff at the counter.' });
    }
    const cashier = req.user?.name || 'System';

    let isVatExempt = true;
    // FIX 1: Safely default to Takeout if the table is null or empty
    if (!table) table = 'Takeout';

    // Kill QR session — already validated by verifyOrderAuth; burn it before processing to prevent replay
    if (req.qrSession) {
      req.qrSession.isActive = false;
      await req.qrSession.save();
    }

    if (!items || items.length === 0) {
      throw new Error("Cart is empty");
    }

    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) {
        throw new Error(`Invalid quantity for item: ${item.name || item.productId}`);
      }
      if (item.price === undefined || item.price < 0) {
        throw new Error(`Invalid price for item: ${item.name || item.productId}`);
      }
    }

    // Authoritative department stamping — look up each product's category and resolve to Kitchen/Bar.
    // Combos resolve from their component products: all-Bar → Bar, otherwise Kitchen.
    {
      const directIds = items.map(i => i.productId).filter(Boolean);
      const comboCompIds = items.filter(i => i.isCombo).flatMap(i => (i.comboItems || []).map(c => c.productId)).filter(Boolean);
      const allIds = [...new Set([...directIds, ...comboCompIds])];
      const [prods, cats] = await Promise.all([
        allIds.length ? Product.find({ _id: { $in: allIds } }, { _id: 1, category: 1 }).lean() : [],
        Category.find({}, { name: 1, department: 1 }).lean()
      ]);
      const catDeptMap = Object.fromEntries(cats.map(c => [c.name, c.department || 'Kitchen']));
      const prodCatMap = Object.fromEntries(prods.map(p => [p._id.toString(), p.category]));
      const deptOf = (pid) => { const cat = prodCatMap[pid]; return cat ? (catDeptMap[cat] || 'Kitchen') : null; };
      for (const item of items) {
        if (item.isCombo && (item.comboItems || []).length) {
          const depts = item.comboItems.map(c => deptOf(c.productId)).filter(Boolean);
          item.department = (depts.length > 0 && depts.every(d => d === 'Bar')) ? 'Bar' : 'Kitchen';
        } else {
          const d = deptOf(item.productId);
          item.department = d || (item.department || 'Kitchen');
        }
      }
    }

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    let totalGross = 0;
    let totalDiscount = 0;
    let totalVat = 0;
    
    const flatDiscount = Math.max(0, parseFloat(discountFlat) || 0);
    let discountType = 'None';
    if (isComplimentary) discountType = 'Complimentary';
    else if (isVatExempt && discountPercent > 0) discountType = 'SC/PWD';
    else if (discountPercent > 0) discountType = 'Promo';
    else if (flatDiscount > 0) discountType = 'Promo';

    const validatedItems = items.map(item => {
      item.hasDiscount = true; 
      // Calculate Add-Ons Total
      const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
      const itemBase = ((item.price || 0) + addOnTotal) * (item.quantity || 1);
      totalGross += itemBase;
      
      if (isComplimentary) {
        totalDiscount += itemBase;
      } else if (discountPercent > 0) {
        const itemDisc = itemBase * (discountPercent / 100);
        totalDiscount += itemDisc;

        // If not exempt, add VAT on top of discounted amount
        if (!isVatExempt && discountType !== 'SC/PWD') {
          totalVat += (itemBase - itemDisc) * 0.12;
        }
      } else {
        // Standard item
        if (!isVatExempt) totalVat += (itemBase * 0); // VAT DISABLED
      }
      return item;
    });

    // Flat peso discount (POS "₱ off") — applied after the per-item percent pass,
    // capped at the gross so the total never goes negative.
    if (!isComplimentary && discountPercent === 0 && flatDiscount > 0) {
      totalDiscount = Math.min(flatDiscount, totalGross);
    }

    const vatRate = 0; // VAT DISABLED
    const finalTotal = totalGross - totalDiscount + totalVat; // Add VAT on top!

    const currentYear = new Date().getFullYear();
    const orderNumber = await generateNextSequence(Order, `ORD-${currentYear}`, 'orderNumber');

    const newOrder = await Order.create({
      orderNumber, table, items: validatedItems, 
      subtotal: totalGross, 
      vatRate: vatRate, 
      vatAmount: totalVat, 
      discountPercent: isComplimentary ? 0 : discountPercent,
      discount: totalDiscount,
      total: finalTotal,
      isVatExempt, discountType, customerName,
      isComplimentary, employeeName, cashier,
      transactionType: isComplimentary ? 'COMPLIMENTARY' : 'NORMAL',
      orderNotes: (orderNotes || '').trim().slice(0, 300),
      guestCount: Math.max(1, parseInt(guestCount) || 1),
      ...(idempotencyKey && { idempotencyKey }),
      ...(paymentsInput?.length > 0 && {
        payments: paymentsInput,
        paymentMethod: paymentsInput.length === 1 ? paymentsInput[0].method : 'Split'
      }),
    });

    emitToOps('newOrder', newOrder);
    res.json({ success: true, order: newOrder });
  } catch (error) {
    console.error("Order Creation Error:", error);
    res.status(500).json({ success: false, error: 'Order failed' });
  }
});

// --- COMPLIMENTARY: APPLY ---
app.put('/api/orders/:id/complimentary', verifyToken, async (req, res) => {
  try {
    const { reasonType, reasonNote, approvedBy, forEmployee } = req.body;
    if (!reasonType) return res.status(400).json({ success: false, error: 'reasonType is required' });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'Completed') return res.status(400).json({ success: false, error: 'Completed orders cannot be marked complimentary' });

    const year = new Date().getFullYear();
    const compCount = await Order.countDocuments({ isComplimentary: true });
    const refNum = `COMP-${year}-${(compCount + 1).toString().padStart(4, '0')}`;

    order.isComplimentary = true;
    order.transactionType = 'COMPLIMENTARY';
    order.complimentaryReasonType = reasonType;
    order.complimentaryReasonNote = reasonNote || '';
    order.complimentaryApprovedBy = approvedBy || 'Manager';
    order.complimentaryApprovedAt = new Date();
    order.complimentaryAmount = order.subtotal;
    order.complimentaryReferenceNumber = refNum;
    order.employeeName = forEmployee || approvedBy || '';
    order.discountPercent = 0;
    order.discount = order.subtotal;
    order.total = 0;
    order.discountType = 'Complimentary';
    order.paymentMethod = 'Complimentary';

    await order.save();
    emitToOps('orderUpdated', order.toObject());
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- COMPLIMENTARY: REMOVE ---
app.delete('/api/orders/:id/complimentary', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'Completed') return res.status(400).json({ success: false, error: 'Cannot reverse a completed complimentary order — void it instead' });

    order.isComplimentary = false;
    order.transactionType = 'NORMAL';
    order.complimentaryReasonType = null;
    order.complimentaryReasonNote = '';
    order.complimentaryApprovedBy = '';
    order.complimentaryApprovedAt = null;
    order.complimentaryAmount = 0;
    order.complimentaryReferenceNumber = '';
    order.employeeName = '';
    order.discountPercent = 0;
    order.discount = 0;
    order.total = order.subtotal;
    order.paymentMethod = 'Cash';

    await order.save();
    emitToOps('orderUpdated', order.toObject());
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.put('/api/orders/:id', verifyToken, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { status, discountPercent, isVatExempt, paymentMethod, discountType, discountedIndices, items, amountTendered } = req.body;
    
    const order = await Order.findById(req.params.id).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false });
    }

    // Freeze previousStatus to prevent the 500 Internal Server Crash
    const previousStatus = order.status;
    const wasNotCompleted = previousStatus !== 'Completed';

    // Immutability guard: completed orders are locked; use the void workflow
    if (previousStatus === 'Completed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, error: 'Completed orders are immutable. Use the void workflow for cancellations.' });
    }

    if (status) order.status = status;
    if (paymentMethod && !order.isComplimentary) order.paymentMethod = paymentMethod;

    // Allow the Kitchen/Bar to update specific item statuses safely
    // Allow the Kitchen/Bar to update specific item statuses safely
    if (items) {
      items.forEach((incomingItem, index) => {
        if (order.items[index]) {
          if (incomingItem.itemStatus !== undefined) order.items[index].itemStatus = incomingItem.itemStatus;
          if (incomingItem.selectedAddOns !== undefined) order.items[index].selectedAddOns = incomingItem.selectedAddOns; 
          // NEW: Listen for the isolated discount from the frontend!
          if (incomingItem.discountPercent !== undefined) order.items[index].discountPercent = incomingItem.discountPercent; 
        }
      });
      order.markModified('items');
    }

    if (discountPercent !== undefined) order.discountPercent = discountPercent;
    if (isVatExempt !== undefined) order.isVatExempt = isVatExempt;
    if (discountType !== undefined) order.discountType = discountType;

    // Stamp WHO applied the discount with the logged-in user (not the order's
    // original cashier, which may be 'System' for QR/customer-created orders).
    if ((discountPercent !== undefined && discountPercent > 0) ||
        (Array.isArray(discountedIndices) && discountedIndices.length > 0)) {
      if (req.user?.name) order.discountBy = req.user.name;
    }

    if (order.isComplimentary) {
        order.discountType = 'Complimentary';
    } else if (order.discountPercent > 0 && (!order.discountType || order.discountType === 'None')) {
        order.discountType = order.isVatExempt ? 'SC/PWD' : 'Promo';
    } else if (order.discountPercent === 0) {
        order.discountType = 'None';
    }

    if (discountedIndices !== undefined) {
      order.items.forEach((item, idx) => {
        item.hasDiscount = discountedIndices.includes(idx);
      });
      order.markModified('items'); 
    }

    // --- BULLETPROOF MATH RECALCULATION ---
    let totalGross = 0;
    let totalDiscount = 0;
    let totalVat = 0;
    
    order.items.forEach(item => {
      const price = item.price || 0; 
      const qty = item.quantity || 1;
      const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
      const itemBase = (price + addOnTotal) * qty;
      
      totalGross += itemBase;
      const getsDiscount = item.hasDiscount !== false;
      const isolatedItemDiscount = item.discountPercent || 0; // The new item-level tag

      if (order.isComplimentary) {
        totalDiscount += itemBase;
      } else if (isolatedItemDiscount > 0) {
        // OVERRIDE: If this item has an isolated discount (e.g. 20% PWD), apply ONLY this discount!
        const itemDisc = itemBase * (isolatedItemDiscount / 100);
        totalDiscount += itemDisc;
        if (!order.isVatExempt) totalVat += (itemBase - itemDisc) * 0; // VAT DISABLED
      } else if (getsDiscount && order.discountPercent > 0) {
        // GLOBAL DISCOUNT: Apply only if the item doesn't have an isolated one
        if (order.isVatExempt || order.discountType === 'SC/PWD') {
          const scDisc = itemBase * (order.discountPercent / 100);
          totalDiscount += scDisc;
        } else {
          const itemDisc = itemBase * (order.discountPercent / 100);
          totalDiscount += itemDisc;
          if (!order.isVatExempt) totalVat += (itemBase - itemDisc) * 0; // VAT DISABLED
        }
      } else {
        if (!order.isVatExempt) totalVat += (itemBase * 0); // VAT DISABLED
      }
    });

    order.subtotal = Number(totalGross.toFixed(2));
    order.discount = Number(totalDiscount.toFixed(2));
    order.vatAmount = Number(totalVat.toFixed(2));
    order.vatRate = 0;
    order.total = Number((totalGross - totalDiscount + totalVat).toFixed(2));

    // Cash tendered — only for cash orders transitioning to Preparing
    if (status === 'Preparing' && amountTendered !== undefined && (order.paymentMethod === 'Cash' || paymentMethod === 'Cash')) {
      const tendered = Number(amountTendered);
      if (tendered < order.total) {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, error: `Insufficient cash: tendered ₱${tendered.toFixed(2)} but total is ₱${order.total.toFixed(2)}` });
      }
      order.amountTendered = tendered;
      order.changeDue = Number((tendered - order.total).toFixed(2));
    }

    const validation = validateOrderMath(order);
    if (!validation.valid) {
      await session.abortTransaction();
      session.endSession();
      console.error(`[VALIDATION FAILED] Order ${order.orderNumber}: ${validation.error}`);
      return res.status(400).json({ success: false, error: `SYSTEM AUDIT REJECTED: ${validation.error}` });
    }

    // --- POS GUARDRAIL: CHECK IF EOD IS LOCKED ---
    if (status === 'Completed' && wasNotCompleted) {
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      const currentEOD = await EODRecord.findOne({ dateString: todayStr }).session(session);
      
      if (currentEOD && currentEOD.status === 'LOCKED') {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ success: false, error: 'REGISTER CLOSED: EOD is locked.' });
      }
    }

    // --- THE STRICT ERP ENGINE ---
    if (status === 'Completed' && wasNotCompleted) {
      log.info(`\n[ERP ENGINE] Processing Order: ${order.orderNumber}...`);
      let totalCogs = 0;
      const stockCardBatch = [];

      // BULK PRE-FETCH all products for this order in 2 queries (fix N+1)
      const itemProductIds = order.items.map(i => i.productId).filter(Boolean);
      const itemBaseNames  = order.items.filter(i => !i.productId).map(i => i.name.replace(/\s*\(.*?\)\s*/g, '').trim());
      const [productsById, productsByName] = await Promise.all([
        itemProductIds.length ? Product.find({ _id:  { $in: itemProductIds } }).populate('modifierGroups').session(session) : [],
        itemBaseNames.length  ? Product.find({ name: { $in: itemBaseNames  } }).populate('modifierGroups').session(session) : []
      ]);
      const productMap = new Map();
      productsById.forEach(p => productMap.set(String(p._id), p));
      productsByName.forEach(p => productMap.set(`name:${p.name}`, p));

      for (const item of order.items) {
        if (item.price === undefined || item.quantity === undefined) return { valid: false, error: "Line item missing price or quantity." };

        // COMBO / BUNDLE: deduct each component product's recipe.
        if (item.isCombo && Array.isArray(item.comboItems) && item.comboItems.length) {
          for (const comp of item.comboItems) {
            const compProduct = await Product.findById(comp.productId).session(session);
            if (!compProduct) continue;
            let compRecipe = compProduct.baseRecipe || [];
            if (comp.sizeName) {
              const sz = compProduct.sizes?.find(s => s.name === comp.sizeName);
              if (sz?.recipe?.length) compRecipe = sz.recipe;
            }
            for (const ing of compRecipe) {
              if (!ing.invId) continue;
              const deductQty = (ing.qty * (comp.quantity || 1) * item.quantity);
              const invItem = await Inventory.findOneAndUpdate(
                { _id: ing.invId, stockQty: { $gte: deductQty } },
                { $inc: { stockQty: -deductQty } },
                { session, new: true }
              );
              if (!invItem) {
                await session.abortTransaction(); session.endSession();
                return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK for combo "${item.name}" — [${ing.name || ing.invId}] would drop below zero.` });
              }
              if (invItem.expiryBatches?.length > 0) {
                const r = consumeBatches(invItem.expiryBatches, deductQty);
                invItem.expiryBatches = r.batches; invItem.expiryDate = soonestExpiry(r.batches);
                await invItem.save({ session });
              }
              stockCardBatch.push({
                inventoryId: invItem._id, itemName: invItem.itemName, type: 'Sale',
                reference: mkRef('', order.orderNumber), qtyChange: -deductQty, balanceAfter: invItem.stockQty,
                remarks: `Sold via Combo (${item.name} → ${comp.name})`
              });
              totalCogs += (invItem.unitCost * deductQty);
            }
          }
          continue; // combo fully handled
        }

        let product = null;
        if (item.productId) {
          product = productMap.get(String(item.productId));
        } else {
          const baseName = item.name.replace(/\s*\(.*?\)\s*/g, '').trim();
          product = productMap.get(`name:${baseName}`);
        }

        if (!product) continue;

        let recipeToUse = product.baseRecipe || [];
        const sizeMatch = item.name.match(/\(([^)]+)\)$/); 
        if (sizeMatch) {
          const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
          if (sizeObj && sizeObj.recipe?.length > 0) recipeToUse = sizeObj.recipe;
        }

        for (const ing of recipeToUse) {
          if (!ing.invId) continue;
          const deductQty = (ing.qty * item.quantity);
          const invItem = await Inventory.findOneAndUpdate(
            { _id: ing.invId, stockQty: { $gte: deductQty } },
            { $inc: { stockQty: -deductQty } },
            { session, new: true }
          );
          if (invItem && invItem.expiryBatches && invItem.expiryBatches.length > 0) {
            // FEFO-consume from batches (audit info; stockQty is source of truth)
            const r = consumeBatches(invItem.expiryBatches, deductQty);
            invItem.expiryBatches = r.batches;
            invItem.expiryDate = soonestExpiry(r.batches);
            await invItem.save({ session });
          }
          if (!invItem) {
            const missing = await Inventory.findById(ing.invId).lean();
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK: Cannot fulfill order. [${missing?.itemName || ing.name}] would drop below zero. Please receive stock in the Procurement tab first.` });
          }
          stockCardBatch.push({
            inventoryId: invItem._id,
            itemName: invItem.itemName,
            type: 'Sale',
            reference: mkRef('', order.orderNumber),
            qtyChange: -deductQty,
            balanceAfter: invItem.stockQty,
            remarks: `Sold via ${item.name}`
          });
          totalCogs += (invItem.unitCost * deductQty);
        }
        // DEDUCT ADD-ONS + MODIFIER-OPTION INVENTORY
        for (const selectedAddOn of (item.selectedAddOns || [])) {
          // Resolve the recipe from either a product add-on OR a modifier-group option.
          // Modifier selections are stored as "Group name: Option name".
          let resolvedRecipe = product.addOns?.find(a => a.name === selectedAddOn.name)?.recipe;
          if (!resolvedRecipe && selectedAddOn.name.includes(': ')) {
            const [grpName, optName] = selectedAddOn.name.split(': ');
            const grp = (product.modifierGroups || []).find(g => g && g.name === grpName);
            resolvedRecipe = grp?.options?.find(o => o.name === optName)?.recipe;
          }
          if (resolvedRecipe && resolvedRecipe.length) {
            for (const ing of resolvedRecipe) {
              if (!ing.invId) continue;
              const deductQty = (ing.qty * item.quantity);
              const invItem = await Inventory.findOneAndUpdate(
                { _id: ing.invId, stockQty: { $gte: deductQty } },
                { $inc: { stockQty: -deductQty } },
                { session, new: true }
              );
              if (invItem && invItem.expiryBatches && invItem.expiryBatches.length > 0) {
                const r = consumeBatches(invItem.expiryBatches, deductQty);
                invItem.expiryBatches = r.batches;
                invItem.expiryDate = soonestExpiry(r.batches);
                await invItem.save({ session });
              }
              if (!invItem) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK: Add-on [${ing.name || ing.invId}] drops below zero.` });
              }
              stockCardBatch.push({
                inventoryId: invItem._id, itemName: invItem.itemName, type: 'Sale',
                reference: mkRef('', order.orderNumber), qtyChange: -deductQty, balanceAfter: invItem.stockQty,
                remarks: `Sold via Add-on (${selectedAddOn.name})`
              });
              totalCogs += (invItem.unitCost * deductQty);
            }
          }
        }
      }

      // Batch-insert all stock card entries in one round-trip
      if (stockCardBatch.length > 0) {
        await StockCard.insertMany(stockCardBatch, { session });
      }

      const reference = mkRef('', order.orderNumber);
      const lines = [];

      if (order.isComplimentary) {
        // DR 5300 Complimentary Expense / CR 4000 Sales Revenue at selling price (keeps gross visible)
        const sellingPrice = order.subtotal || 0;
        if (sellingPrice > 0) {
          lines.push({ accountCode: '540000', accountName: 'Complimentary Expense', debit: sellingPrice, credit: 0 });
          lines.push({ accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: sellingPrice });
        }
        // DR 5000 COGS / CR 1500 Inventory at cost
        if (totalCogs > 0) {
          lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: totalCogs, credit: 0 });
          lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
        }
        order.complimentaryCost = totalCogs;
      } else {
        // Split-payment: one debit line per payment; single-payment: one line as before
        const payRows = (order.payments?.length > 0)
          ? order.payments
          : [{ method: order.paymentMethod || 'Cash', amount: order.total }];
        for (const p of payRows) {
          const acct = debitAccountFor(p.method);
          lines.push({ accountCode: acct.code, accountName: acct.name, debit: p.amount, credit: 0 });
        }
        lines.push({ accountCode: '430000', accountName: 'Sales Discounts', debit: order.discount || 0, credit: 0 });

        // Non-VAT: gross receipts = net collected + discount (no VAT separation)
        const grossSalesAmount = order.total + (order.discount || 0);
        lines.push({ accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: 0, credit: grossSalesAmount });

        if (totalCogs > 0) {
          lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: totalCogs, credit: 0 });
          lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
        }
      }

      const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
      const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`Journal imbalance on ${reference}: DR=${totalDebit.toFixed(2)} CR=${totalCredit.toFixed(2)}`);
      }

      await JournalEntry.create([{
        reference,
        description: order.isComplimentary
          ? `COMP [${order.complimentaryReasonType || 'UNKNOWN'}] For: ${order.employeeName || '—'} | By: ${order.complimentaryApprovedBy || '—'} | Ref: ${order.complimentaryReferenceNumber || order.orderNumber}`
          : `Sales & COGS for Order ${order.orderNumber}`,
        lines, 
        totalDebit, 
        totalCredit 
      }], { session });

      log.info(`[ERP LEDGER] Single AUTO Entry ${reference} created.`);
      emitToMgr('erpUpdated');
    }

    // FIX: Removed the array brackets and {session} to prevent Mongoose crash
    if (status && status !== previousStatus) {
      await AuditLog.create({
        userId: req.user ? req.user.name : 'System',
        action: `ORDER_${status.toUpperCase()}`,
        targetReference: order.orderNumber,
        details: { previousStatus, newStatus: status, total: order.total, method: paymentMethod }
      });
    }

    await order.save({ session }); 
    await session.commitTransaction();
    session.endSession();

    emitToOps('orderUpdated', order);
    // Push menuUpdated so CustomerMenu instantly re-fetches products and recomputes
    // stockAvailable — catches the moment an ingredient hits zero during service.
    if (status === 'Completed') emitToAll('menuUpdated');
    res.json({ success: true, order });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[ERP CRITICAL ERROR] Failed to process order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- 🚨 SAFE VOID & REFUND ENGINE 🚨 ---
app.post('/api/orders/:id/void', verifyToken, requireSuperAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { reason } = req.body; // 'Restock' or 'Spoilage'
    // Extract admin name securely from the JWT token, NOT the request body
    const adminName = req.user.name; 
    
    const order = await Order.findById(req.params.id).session(session);
    
    if (!order) {
        await session.abortTransaction(); session.endSession();
        return res.status(404).json({ success: false, error: 'Order not found' });
    }
    if (order.status !== 'Completed') {
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ success: false, error: 'Only completed orders can be voided.' });
    }

    const orderDateStr = new Date(order.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const eodRecord = await EODRecord.findOne({ dateString: orderDateStr }).session(session);
    if (eodRecord?.status === 'LOCKED') {
      await session.abortTransaction(); session.endSession();
      return res.status(403).json({ success: false, error: `EOD locked for ${orderDateStr}. Cannot void after day is closed.` });
    }

    // Reject voids on already-settled A/R orders — would orphan a paired entry.
    // Operator must reverse the settlement manually first (or use full refund flow).
    if (order.arSettled) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ success: false, error: 'Cannot void an A/R-settled order. Reverse the settlement first or contact superadmin.' });
    }

    // Route the credit to the same cash/AR account the original entry debited.
    const _cashAcct = debitAccountFor(order.paymentMethod);
    const cashAccount = _cashAcct.code;
    const cashAccountName = _cashAcct.name;

    const lines = [];
    // Non-VAT: gross receipts = net collected + discount (no VAT separation)
    const grossSalesAmount = order.total + (order.discount || 0);

    if (!order.isComplimentary) {
      lines.push({ accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: grossSalesAmount, credit: 0 });
      lines.push({ accountCode: cashAccount, accountName: cashAccountName, debit: 0, credit: order.total });
      if (order.discount > 0) lines.push({ accountCode: '430000', accountName: 'Sales Discounts', debit: 0, credit: order.discount });
    } else {
      // Reverse the complimentary revenue recognition: DR 4000 / CR 5300 at selling price
      const sellingPrice = order.subtotal || 0;
      if (sellingPrice > 0) {
        lines.push({ accountCode: '410000', accountName: 'Sales Revenue', debit: sellingPrice, credit: 0 });
        lines.push({ accountCode: '540000', accountName: 'Complimentary Expense', debit: 0, credit: sellingPrice });
      }
    }

    let totalCogs = 0;
    for (const item of order.items) {
      let product = await Product.findById(item.productId).populate('modifierGroups').session(session);
      if (!product) continue;

      let recipeToUse = product.baseRecipe || [];
      const sizeMatch = item.name.match(/\(([^)]+)\)$/);
      if (sizeMatch) {
        const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
        if (sizeObj && sizeObj.recipe?.length > 0) recipeToUse = sizeObj.recipe;
      }

      for (const ing of recipeToUse) {
        if (!ing.invId) continue;
        const qtyUsed = ing.qty * item.quantity;

        if (reason === 'Restock') {
          const restored = await Inventory.findOneAndUpdate(
            { _id: ing.invId },
            { $inc: { stockQty: qtyUsed } },
            { session, new: true }
          );
          if (!restored) continue;
          totalCogs += (restored.unitCost * qtyUsed);
          await StockCard.create([{
            inventoryId: restored._id, itemName: restored.itemName, type: 'Adjustment',
            reference: mkRef('VOID', order.orderNumber), qtyChange: qtyUsed, balanceAfter: restored.stockQty, remarks: `Voided (${reason})`
          }], { session });
        } else {
          const invItem = await Inventory.findById(ing.invId).session(session);
          if (invItem) totalCogs += (invItem.unitCost * qtyUsed);
        }
      }

      for (const selectedAddOn of (item.selectedAddOns || [])) {
        // Resolve recipe from product add-on OR modifier-group option (symmetric with sale deduction)
        let resolvedRecipe = product.addOns?.find(a => a.name === selectedAddOn.name)?.recipe;
        if (!resolvedRecipe && selectedAddOn.name.includes(': ')) {
          const [grpName, optName] = selectedAddOn.name.split(': ');
          const grp = (product.modifierGroups || []).find(g => g && g.name === grpName);
          resolvedRecipe = grp?.options?.find(o => o.name === optName)?.recipe;
        }
        if (!resolvedRecipe?.length) continue;
        for (const ing of resolvedRecipe) {
          if (!ing.invId) continue;
          const qtyUsed = ing.qty * item.quantity;
          if (reason === 'Restock') {
            const restored = await Inventory.findOneAndUpdate(
              { _id: ing.invId },
              { $inc: { stockQty: qtyUsed } },
              { session, new: true }
            );
            if (!restored) continue;
            totalCogs += (restored.unitCost * qtyUsed);
            await StockCard.create([{
              inventoryId: restored._id, itemName: restored.itemName, type: 'Adjustment',
              reference: mkRef('VOID', order.orderNumber), qtyChange: qtyUsed, balanceAfter: restored.stockQty,
              remarks: `Voided Add-on (${selectedAddOn.name}) (${reason})`
            }], { session });
          } else {
            const invItem = await Inventory.findById(ing.invId).session(session);
            if (invItem) totalCogs += (invItem.unitCost * qtyUsed);
          }
        }
      }
    }

    if (totalCogs > 0) {
      if (reason === 'Restock') {
        lines.push({ accountCode: '130000', accountName: 'Inventory Asset', debit: totalCogs, credit: 0 });
        lines.push({
          accountCode: '510000',
          accountName: 'Cost of Goods Sold',
          debit: 0, credit: totalCogs
        });
      } else if (reason === 'Spoilage' && !order.isComplimentary) {
        lines.push({ accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: totalCogs, credit: 0 });
        lines.push({ accountCode: '510000', accountName: 'Cost of Goods Sold', debit: 0, credit: totalCogs });
      }
      // Complimentary + Spoilage: cost already expensed at completion, inventory gone, no reversal
    }

    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
    if (totalDebit > 0 && Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Journal imbalance on ${mkRef('VOID', order.orderNumber)}: DR=${totalDebit.toFixed(2)} CR=${totalCredit.toFixed(2)}`);
    }

    // If totalDebit/Credit is 0, it means the item had no BOM and wasn't complimentary. We still log the order status change.
    if (totalDebit > 0) {
        await JournalEntry.create([{ 
        reference: mkRef('VOID', order.orderNumber), 
        description: `VOID (${reason}) by ${adminName}`, 
        lines, totalDebit, totalCredit 
        }], { session });
    }

    order.status = 'Voided';
    order.voidReason = reason;
    await order.save({ session });
    
    await session.commitTransaction();
    session.endSession();

    emitToMgr('erpUpdated');
    emitToOps('orderUpdated', order);
    res.json({ success: true, order });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Void Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
app.post('/api/orders/archive', verifyToken, async (req, res) => {
  try {
    // 1. Force any hanging order to Cancelled — includes Ready (made but never
    //    handed over) and Parked (held unpaid tabs). Parked orders also lose the
    //    isParked flag so they don't linger in the parked list.
    await Order.updateMany(
      { status: { $in: ['Pending', 'Preparing', 'Ready', 'Parked'] }, isArchived: false },
      { $set: { status: 'Cancelled', isParked: false } }
    );

    // 2. Sweep EVERYTHING that is currently active into the archive
    //    (Completed, Voided, Cancelled, and the just-cancelled Parked tabs).
    await Order.updateMany(
      { isArchived: false },
      { $set: { isArchived: true, isParked: false } }
    );

    emitToAll('ordersArchived');
    res.json({ success: true });
  } catch (error) {
    console.error("Archive Error:", error);
    res.status(500).json({ success: false });
  }
});

// --- ERP ROUTES ---

// Inventory CRUD
app.get('/api/inventory', verifyToken, async (req, res) => {
  const { page, limit: lim, search } = req.query;
  const filter = search ? { itemName: { $regex: search, $options: 'i' } } : {};
  if (page) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 50);
    const [items, total] = await Promise.all([
      Inventory.find(filter).sort({ itemName: 1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      Inventory.countDocuments(filter)
    ]);
    return res.json({ success: true, items, total, page: pageNum, pages: Math.ceil(total / pageSize) });
  }
  const items = await Inventory.find(filter).sort({ itemName: 1 }).lean();
  res.json({ success: true, items });
});

app.post('/api/inventory', verifyToken, async (req, res) => {
  try {
    const existing = await Inventory.findOne({ itemName: { $regex: new RegExp(`^${escapeRegex(req.body.itemName.trim())}$`, 'i') } });
    if (existing) return res.status(400).json({ success: false, error: 'Item already exists.' });

    // Inject RML code
    req.body.itemCode = await generateNextSequence(Inventory, 'RML', 'itemCode');
    // Seed expiryBatches with the initial batch if expiry is provided
    const purchRef = await mkSeqRef('INV-PURCH');
    if (req.body.expiryDate && req.body.stockQty > 0) {
      req.body.expiryBatches = [{
        qty: req.body.stockQty,
        expiryDate: new Date(req.body.expiryDate),
        receivedAt: new Date(),
        reference: purchRef,
        unitCost: req.body.unitCost || 0
      }];
    }
    const { creditAccount: rawCreditCode } = req.body;
    const CREDIT_ACCOUNTS = { '111000': 'Cash on Hand', '112000': 'Cash in Bank', '220000': 'Accounts Payable' };
    const creditCode = CREDIT_ACCOUNTS[rawCreditCode] ? rawCreditCode : '111000';
    const creditName = CREDIT_ACCOUNTS[creditCode];

    const newItem = await Inventory.create(req.body);

    // --- AUTO-JOURNAL FOR PURCHASING INVENTORY ---
    const totalCost = newItem.stockQty * newItem.unitCost;
    if (totalCost > 0) {
      const reference = purchRef;
      const lines = [
        { accountCode: '130000', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
        { accountCode: creditCode, accountName: creditName,   debit: 0, credit: totalCost }
      ];
      await JournalEntry.create({ reference, description: `Purchased ${newItem.stockQty}${newItem.unit} of ${newItem.itemName}`, lines, totalDebit: totalCost, totalCredit: totalCost });
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- INVENTORY REVALUATION: set book Inventory (130000) = actual on-hand value ---
// Resolves negative/incorrect inventory caused by missing opening balance / purchases.
// Offset defaults to Owner's Capital (opening contribution; no P&L impact); '530000'
// books it as an Inventory Adjustment instead.
app.post('/api/inventory/revalue', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const VALID = { '310000': "Owner's Capital", '530000': 'Inventory Adjustments' };
    const offCode = VALID[req.body.offsetAccount] ? req.body.offsetAccount : '310000';
    const offName = VALID[offCode];

    const items = await Inventory.find({}, { stockQty: 1, unitCost: 1 }).lean();
    const onHand = +items.reduce((s, i) => s + (i.stockQty || 0) * (i.unitCost || 0), 0).toFixed(2);

    const agg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '130000' } },
      { $group: { _id: null, debit: { $sum: { $ifNull: ['$lines.debit', 0] } }, credit: { $sum: { $ifNull: ['$lines.credit', 0] } } } },
    ]);
    const book = +(((agg[0]?.debit || 0) - (agg[0]?.credit || 0))).toFixed(2);
    const diff = +(onHand - book).toFixed(2);
    if (Math.abs(diff) < 0.01) return res.json({ success: true, onHand, book, diff: 0, message: 'Inventory already matches on-hand value.' });

    const reference = await mkSeqRef('INV-REVAL');
    const lines = diff > 0
      ? [ { accountCode: '130000', accountName: 'Inventory Asset', debit: diff, credit: 0 }, { accountCode: offCode, accountName: offName, debit: 0, credit: diff } ]
      : [ { accountCode: offCode, accountName: offName, debit: -diff, credit: 0 }, { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: -diff } ];
    assertBalanced(lines, reference);
    await JournalEntry.create({ date: new Date(), reference, description: `Inventory revaluation to on-hand value (offset: ${offName})`, lines, totalDebit: Math.abs(diff), totalCredit: Math.abs(diff) });
    emitToMgr('erpUpdated');
    res.json({ success: true, onHand, book, diff, offset: offCode, reference });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// --- NEW: RESTOCK EXISTING INVENTORY (Weighted Average Cost) ---
app.post('/api/inventory/restock/:id', verifyToken, async (req, res) => {
  try {
    const { addedStock, totalCost, expiryDate, creditAccount: rawCreditCode } = req.body;
    const CREDIT_ACCOUNTS = { '111000': 'Cash on Hand', '112000': 'Cash in Bank', '220000': 'Accounts Payable' };
    const creditCode = CREDIT_ACCOUNTS[rawCreditCode] ? rawCreditCode : '111000';
    const creditName = CREDIT_ACCOUNTS[creditCode];
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    // WEIGHTED AVERAGE COST MATH
    const currentTotalValue = item.stockQty * item.unitCost;
    const newTotalValue = currentTotalValue + totalCost;
    const newStockQty = item.stockQty + addedStock;
    const newUnitCost = newStockQty > 0 ? newTotalValue / newStockQty : 0;

    item.stockQty = newStockQty;
    item.unitCost = newUnitCost;

    // Pre-generate a single reference for this restock (shared by StockCard + JournalEntry)
    const rstRef = await mkSeqRef('INV-RST');

    // Multi-batch expiry: append the new batch and recompute soonest expiry.
    if (expiryDate && addedStock > 0) {
      item.expiryBatches = addBatch(item.expiryBatches || [], {
        qty: addedStock,
        expiryDate: new Date(expiryDate),
        receivedAt: new Date(),
        reference: rstRef,
        unitCost: newUnitCost
      });
      item.expiryDate = soonestExpiry(item.expiryBatches);
    }

    await item.save();

    // --- NEW: WRITE THE RESTOCK TO THE STOCK CARD ---
    // This is what the EOD Engine reads to calculate the "In" column!
    await StockCard.create({
      inventoryId: item._id,
      itemName: item.itemName,
      type: 'Restock',
      reference: rstRef,
      qtyChange: addedStock, // Positive because it is entering inventory
      balanceAfter: item.stockQty,
      remarks: 'Restocked inventory'
    });

    // AUTO-JOURNAL FOR RESTOCKING
    if (totalCost > 0) {
      const reference = rstRef;
      const lines = [
        { accountCode: '130000', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
        { accountCode: creditCode, accountName: creditName,   debit: 0, credit: totalCost }
      ];
      await JournalEntry.create({ reference, description: `Restocked ${addedStock}${item.unit} of ${item.itemName}`, lines, totalDebit: totalCost, totalCredit: totalCost });
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/inventory/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    // Whitelist editable fields — stockQty must NEVER be edited here
    // (would bypass StockCard audit trail and double-entry accounting).
    // Stock changes go through restock / spoilage / order-completion flows.
    const allowed = ['itemName', 'unit', 'unitCost', 'lowStockThreshold', 'expiryDate', 'expiryWarnDays', 'displayUnit', 'unitMultiplier', 'srp'];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];

    if ('itemName' in update) {
      if (typeof update.itemName !== 'string' || !update.itemName.trim()) {
        return res.status(400).json({ success: false, error: 'Item name required.' });
      }
      update.itemName = update.itemName.trim();
      // Prevent duplicate-name collisions (case-insensitive)
      const dupe = await Inventory.findOne({
        _id: { $ne: req.params.id },
        itemName: { $regex: new RegExp(`^${update.itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      });
      if (dupe) return res.status(400).json({ success: false, error: `Another item already named "${update.itemName}".` });
    }
    if ('unitCost' in update) {
      const n = parseFloat(update.unitCost);
      if (Number.isNaN(n) || n < 0) return res.status(400).json({ success: false, error: 'Unit cost must be ≥ 0.' });
      update.unitCost = n;
    }
    if ('lowStockThreshold' in update) update.lowStockThreshold = Math.max(0, parseFloat(update.lowStockThreshold) || 0);
    if ('expiryWarnDays' in update)    update.expiryWarnDays    = Math.max(1, parseInt(update.expiryWarnDays) || 7);
    if ('expiryDate' in update) {
      if (update.expiryDate === null || update.expiryDate === '') update.expiryDate = null;
      else update.expiryDate = new Date(update.expiryDate);
    }

    const updatedItem = await Inventory.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updatedItem) return res.status(404).json({ success: false, error: 'Item not found.' });
    emitToMgr('erpUpdated');
    res.json({ success: true, item: updatedItem });
  } catch (err) {
    log.error({ err }, 'PUT /api/inventory/:id failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- EXPIRY WATCH: items expiring within N days (default 30), plus already-expired ---
app.get('/api/inventory/expiring', verifyToken, async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days) || 30);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
    cutoff.setHours(23, 59, 59, 999);

    const items = await Inventory.find({
      expiryDate: { $ne: null, $lte: cutoff },
      stockQty: { $gt: 0 } // ignore depleted items even if expiry date lingers
    }).sort({ expiryDate: 1 }).lean();

    const now = new Date();
    const expired = items.filter(i => new Date(i.expiryDate) < now);
    const expiringSoon = items.filter(i => {
      const d = new Date(i.expiryDate);
      const warnDays = i.expiryWarnDays || 7;
      const warnCutoff = new Date(); warnCutoff.setDate(warnCutoff.getDate() + warnDays);
      return d >= now && d <= warnCutoff;
    });
    const expiringLater = items.filter(i => {
      const d = new Date(i.expiryDate);
      const warnDays = i.expiryWarnDays || 7;
      const warnCutoff = new Date(); warnCutoff.setDate(warnCutoff.getDate() + warnDays);
      return d > warnCutoff;
    });

    res.json({
      success: true,
      total: items.length,
      expired,
      expiringSoon,
      expiringLater,
      cutoffDays: days
    });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- BATCH MANAGEMENT: add a new expiry batch manually ---
app.post('/api/inventory/:id/batches', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { qty, expiryDate, reference } = req.body;
    const n = parseFloat(qty);
    if (!n || n <= 0) return res.status(400).json({ success: false, error: 'qty must be > 0' });
    if (!expiryDate) return res.status(400).json({ success: false, error: 'expiryDate required' });
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const batchRef = await mkSeqRef('INV-BATCH');
    const unitCost = item.unitCost || 0;
    item.expiryBatches = addBatch(item.expiryBatches || [], {
      qty: n,
      expiryDate: new Date(expiryDate),
      receivedAt: new Date(),
      reference: batchRef,
      unitCost
    });
    item.expiryDate = soonestExpiry(item.expiryBatches);
    // A manually added batch is real stock arriving — keep stockQty in sync with
    // the batch total so they never drift, and book it like a found-stock adjustment.
    item.stockQty = +(Number(item.stockQty || 0) + n);
    await item.save();

    await StockCard.create({
      inventoryId: item._id, itemName: item.itemName, type: 'Adjustment',
      reference: batchRef, qtyChange: n, balanceAfter: item.stockQty, unitCost,
      remarks: `Manual batch added (${reference || 'no ref'})`,
    });

    const value = +(n * unitCost).toFixed(2);
    if (value > 0) {
      await JournalEntry.create({
        reference: batchRef, description: `Manual batch added: ${n}${item.unit} of ${item.itemName}`,
        lines: [
          { accountCode: '130000', accountName: 'Inventory Asset',            debit: value, credit: 0 },
          { accountCode: '530000', accountName: 'Inventory Adjustment Gain',  debit: 0, credit: value },
        ],
        totalDebit: value, totalCredit: value,
      });
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- BATCH MANAGEMENT: delete a specific batch by index (use when physical stock no longer matches) ---
app.delete('/api/inventory/:id/batches/:batchIdx', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const idx = parseInt(req.params.batchIdx, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= (item.expiryBatches || []).length) {
      return res.status(400).json({ success: false, error: 'Invalid batch index.' });
    }
    const [removed] = item.expiryBatches.splice(idx, 1);
    const removedQty = Number(removed?.qty || 0);
    const unitCost   = Number(removed?.unitCost || item.unitCost || 0);
    item.expiryDate = soonestExpiry(item.expiryBatches);
    // Removing a batch means that stock is physically gone — decrement stockQty and
    // book it as a variance/write-off so the ledger and stock card stay truthful.
    item.stockQty = +Math.max(0, Number(item.stockQty || 0) - removedQty).toFixed(4);
    await item.save();

    const delRef = await mkSeqRef('INV-BATCHDEL');
    await StockCard.create({
      inventoryId: item._id, itemName: item.itemName, type: 'Adjustment',
      reference: delRef, qtyChange: -removedQty, balanceAfter: item.stockQty, unitCost,
      remarks: 'Manual batch removed (physically depleted)',
    });

    const value = +(removedQty * unitCost).toFixed(2);
    if (value > 0) {
      await JournalEntry.create({
        reference: delRef, description: `Manual batch removed: ${removedQty}${item.unit} of ${item.itemName}`,
        lines: [
          { accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: value, credit: 0 },
          { accountCode: '130000', accountName: 'Inventory Asset',                     debit: 0, credit: value },
        ],
        totalDebit: value, totalCredit: value,
      });
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- PATCH expiry only (after a partial spoilage clears the expired batch) ---
app.patch('/api/inventory/:id/expiry', verifyToken, async (req, res) => {
  try {
    const { expiryDate, expiryWarnDays } = req.body;
    const update = {};
    if (expiryDate === null || expiryDate === '') update.expiryDate = null;
    else if (expiryDate) update.expiryDate = new Date(expiryDate);
    if (expiryWarnDays !== undefined) update.expiryWarnDays = Math.max(1, parseInt(expiryWarnDays) || 7);

    const item = await Inventory.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.delete('/api/inventory/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const item = await Inventory.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found.' });
    emitToMgr('erpUpdated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ============================================================
// INVENTORY IMPORT — Stock-take semantics (new file REPLACES current qty)
// Body: { items: [{ itemName, displayUnit, qty, unitCost? }] }
// - Existing items: stockQty replaced; diff booked as Inventory Adjustment Gain (4200) or Spoilage/Variance (5100)
// - New items: created + booked as Inventory Adjustment Gain (4200)
// Every row produces a StockCard entry + a balanced journal entry.
// ============================================================
app.post('/api/inventory/import', verifyToken, requireSuperAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'No rows in import payload.' });
    }
    if (items.length > 2000) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, error: 'Too many rows (max 2000 per import).' });
    }

    const summary = { created: 0, updated: 0, increased: 0, decreased: 0, gainValue: 0, lossValue: 0, errors: [] };

    for (let i = 0; i < items.length; i++) {
      const row = items[i] || {};
      const itemCode = String(row.itemCode || row.code || '').trim();
      const itemName = String(row.itemName || row.product || row.name || '').trim();
      // FORCED RULE: only kg / L / pcs displayed. Auto-promote g→kg, ml→L.
      let displayUnit = String(row.displayUnit || row.unit || '').trim();
      if (displayUnit.toLowerCase() === 'g')  displayUnit = 'kg';
      else if (displayUnit.toLowerCase() === 'ml') displayUnit = 'L';
      else if (displayUnit.toLowerCase() === 'l') displayUnit = 'L';
      else if (['piece','pc'].includes(displayUnit.toLowerCase())) displayUnit = 'pcs';

      const qty = parseFloat(row.qty);
      const unitCostFromExcel = row.unitCost !== undefined && row.unitCost !== '' ? parseFloat(row.unitCost) : null;
      const expiryFromExcel = row.expiryDate || row.expiry || null;

      if (!itemName) { summary.errors.push(`Row ${i+1}: missing Product name`); continue; }
      if (!displayUnit) { summary.errors.push(`Row ${i+1} (${itemName}): missing Unit`); continue; }
      if (Number.isNaN(qty) || qty < 0) { summary.errors.push(`Row ${i+1} (${itemName}): invalid Qty`); continue; }

      const { base: baseUnit, mult } = resolveUnit(displayUnit);
      const newBaseQty = qty * mult;                         // storage qty in base units
      const newCostPerBase = (unitCostFromExcel != null && unitCostFromExcel >= 0)
        ? unitCostFromExcel / mult                            // convert ₱/displayUnit → ₱/baseUnit
        : null;

      // Look up by itemCode first (more specific), then by case-insensitive name
      let existing = null;
      if (itemCode) existing = await Inventory.findOne({ itemCode }).session(session);
      if (!existing) {
        existing = await Inventory.findOne({
          itemName: { $regex: new RegExp(`^${itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        }).session(session);
      }

      // Pre-generate one reference for this import row (shared by StockCard + JournalEntry)
      const impRef = await mkSeqRef('INV-IMP');

      if (existing) {
        const oldQty = existing.stockQty || 0;
        const diff = +(newBaseQty - oldQty).toFixed(6);
        const unitCostForValuation = newCostPerBase != null ? newCostPerBase : (existing.unitCost || 0);
        const valueImpact = Math.abs(diff) * unitCostForValuation;

        // Update item: replace stockQty + (optionally) update unitCost + sync display unit
        existing.stockQty = newBaseQty;
        if (newCostPerBase != null) existing.unitCost = newCostPerBase;
        existing.displayUnit = displayUnit;
        existing.unitMultiplier = mult;
        if (baseUnit) existing.unit = baseUnit;

        // Expiry batches:
        //  - If Excel row carries an expiry: append it as a new batch with the +diff qty (only if diff > 0).
        //  - If diff < 0: FEFO-consume the absolute diff from existing batches.
        //  - If diff > 0 and no expiry on Excel row: leave batches untouched (caller assumes existing batch still applies).
        if (diff < 0) {
          const r = consumeBatches(existing.expiryBatches || [], Math.abs(diff));
          existing.expiryBatches = r.batches;
        } else if (diff > 0 && expiryFromExcel) {
          existing.expiryBatches = addBatch(existing.expiryBatches || [], {
            qty: diff,
            expiryDate: new Date(expiryFromExcel),
            receivedAt: new Date(),
            reference: impRef,
            unitCost: unitCostForValuation
          });
        }
        existing.expiryDate = soonestExpiry(existing.expiryBatches || []);
        await existing.save({ session });

        await StockCard.create([{
          inventoryId: existing._id,
          itemName: existing.itemName,
          type: 'Stock Take Import',
          reference: impRef,
          qtyChange: diff,
          balanceAfter: existing.stockQty,
          unitCost: existing.unitCost,
          remarks: `Bulk import — ${diff >= 0 ? '+' : ''}${diff} ${baseUnit}`
        }], { session });

        if (Math.abs(valueImpact) > 0.001) {
          const lines = diff >= 0
            ? [
                { accountCode: '130000', accountName: 'Inventory Asset', debit: valueImpact, credit: 0 },
                { accountCode: '530000', accountName: 'Inventory Adjustment Gain', debit: 0, credit: valueImpact }
              ]
            : [
                { accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: valueImpact, credit: 0 },
                { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: valueImpact }
              ];
          assertBalanced(lines, `IMPORT-${existing.itemName}`);
          await JournalEntry.create([{
            reference: impRef,
            description: `Stock take import — ${existing.itemName} (${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ${baseUnit} @ P${unitCostForValuation.toFixed(4)})`,
            lines, totalDebit: valueImpact, totalCredit: valueImpact
          }], { session });
        }

        summary.updated++;
        if (diff > 0) { summary.increased++; summary.gainValue += valueImpact; }
        if (diff < 0) { summary.decreased++; summary.lossValue += valueImpact; }
      } else {
        // New item — onboard via Inventory Adjustment Gain (DR 1500 / CR 4200)
        const newCode = itemCode || await generateNextSequence(Inventory, 'RML', 'itemCode');
        const initialBatches = (expiryFromExcel && newBaseQty > 0)
          ? [{ qty: newBaseQty, expiryDate: new Date(expiryFromExcel), receivedAt: new Date(), reference: impRef, unitCost: newCostPerBase || 0 }]
          : [];
        const created = await Inventory.create([{
          itemCode: newCode,
          itemName,
          stockQty: newBaseQty,
          unit: baseUnit,
          unitCost: newCostPerBase != null ? newCostPerBase : 0,
          lowStockThreshold: 0,
          displayUnit,
          unitMultiplier: mult,
          expiryBatches: initialBatches,
          expiryDate: soonestExpiry(initialBatches)
        }], { session });
        const item = created[0];
        const valueImpact = newBaseQty * (item.unitCost || 0);

        await StockCard.create([{
          inventoryId: item._id,
          itemName: item.itemName,
          type: 'Stock Take Import',
          reference: impRef,
          qtyChange: newBaseQty,
          balanceAfter: newBaseQty,
          unitCost: item.unitCost,
          remarks: `Created via bulk import (initial onboard)`
        }], { session });

        if (valueImpact > 0.001) {
          const lines = [
            { accountCode: '130000', accountName: 'Inventory Asset', debit: valueImpact, credit: 0 },
            { accountCode: '530000', accountName: 'Inventory Adjustment Gain', debit: 0, credit: valueImpact }
          ];
          assertBalanced(lines, `IMPORT-NEW-${item.itemName}`);
          await JournalEntry.create([{
            reference: impRef,
            description: `Stock take import (new item) — ${item.itemName} (${newBaseQty.toFixed(2)} ${baseUnit} @ P${item.unitCost.toFixed(4)})`,
            lines, totalDebit: valueImpact, totalCredit: valueImpact
          }], { session });
        }
        summary.created++;
        summary.increased++;
        summary.gainValue += valueImpact;
      }
    }

    await session.commitTransaction();
    session.endSession();
    emitToMgr('erpUpdated');
    res.json({ success: true, summary });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    log.error({ err }, 'inventory import failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Accounting Ledger / Journal Entries — Superadmin only
app.get('/api/journal', verifyToken, requireSuperAdmin, async (req, res) => {
  const pageNum = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, parseInt(req.query.limit) || 50);
  const [entries, total] = await Promise.all([
    JournalEntry.find().sort({ date: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
    JournalEntry.countDocuments()
  ]);
  res.json({ success: true, entries, total, page: pageNum, pages: Math.ceil(total / pageSize) });
});

app.post('/api/journal', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { description, lines } = req.body;
    
    // Calculate totals to ensure it balances
    const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    
    // Optional: backend validation for balancing
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ success: false, error: 'Debits must equal Credits' });
    }

    const reference = await mkSeqRef('JRN');

    const newEntry = await JournalEntry.create({
      reference, description, lines, totalDebit, totalCredit
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger
    res.json({ success: true, entry: newEntry });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/finance/balances', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    // Aggregate at MongoDB level — no full collection load, OOM-safe at scale
    const agg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '111000' } },
      { $group: {
          _id: null,
          totalDebit:  { $sum: { $ifNull: ['$lines.debit',  0] } },
          totalCredit: { $sum: { $ifNull: ['$lines.credit', 0] } }
      }}
    ]);
    const row = agg[0] || { totalDebit: 0, totalCredit: 0 };
    const cashOnHand = (row.totalDebit || 0) - (row.totalCredit || 0);
    res.json({ success: true, cashOnHand });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ============================================================
// EXPENSE ENTRY — operator-facing expense bookkeeping
// Categories defined in lib/chartOfAccounts.js
// ============================================================
app.get('/api/expenses/categories', verifyToken, requireSuperAdmin, async (req, res) => {
  res.json({ success: true, categories: EXPENSE_CATEGORIES });
});

app.post('/api/expenses', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { amount, categoryCode, paymentMethod, description, vendor, date } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be > 0.' });
    if (!EXPENSE_CATEGORIES.find(c => c.code === categoryCode))
      return res.status(400).json({ success: false, error: 'Invalid expense category.' });
    if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description required.' });

    // Pick the credit-side cash account
    let credAcct = { code: '111000', name: 'Cash on Hand' };
    if (paymentMethod === 'Bank Transfer' || paymentMethod === 'Cash in Bank') credAcct = { code: '112000', name: 'Cash in Bank' };
    else if (['GCash', 'Maya', 'Maribank', 'E-Wallet', 'Other E-Wallet'].includes(paymentMethod)) credAcct = { code: '113000', name: 'E-Wallet' };
    else if (paymentMethod === 'On Account') credAcct = { code: '220000', name: 'Accounts Payable' };

    const cat = EXPENSE_CATEGORIES.find(c => c.code === categoryCode);
    const acct = ACCOUNTS[categoryCode];

    const reference = await mkSeqRef('EXP');
    const entryDate = date ? new Date(date) : new Date();

    const lines = [
      { accountCode: categoryCode, accountName: acct.name, debit: amt, credit: 0 },
      { accountCode: credAcct.code, accountName: credAcct.name, debit: 0, credit: amt },
    ];
    assertBalanced(lines, reference);

    const je = await JournalEntry.create({
      reference,
      description: `${cat.label} — ${description.trim()}${vendor ? ` (${vendor.trim()})` : ''}`,
      lines,
      totalDebit: amt,
      totalCredit: amt,
      date: entryDate,
    });

    emitToMgr('erpUpdated');
    res.json({ success: true, entry: je });
  } catch (err) {
    log.error({ err }, 'POST /api/expenses failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ============================================================
// A/R SETTLEMENT — record delivery-partner payout received
// Used when Grab / Foodpanda / Manual Delivery payouts arrive
// ============================================================
app.post('/api/orders/:id/settle-ar', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { amount, paymentMethod, note } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.paymentMethod === 'Cash')
      return res.status(400).json({ success: false, error: 'Cash sales do not require A/R settlement (already booked to Cash on Hand).' });
    if (order.arSettled) return res.status(400).json({ success: false, error: 'Order already settled.' });
    if (order.status !== 'Completed') return res.status(400).json({ success: false, error: 'Order must be Completed before settlement.' });

    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Settlement amount must be > 0.' });
    if (amt > order.total + 0.01)
      return res.status(400).json({ success: false, error: `Settlement amount exceeds outstanding A/R (₱${order.total.toFixed(2)}).` });

    let debitAcct = { code: '111000', name: 'Cash on Hand' };
    if (paymentMethod === 'Bank Transfer' || paymentMethod === 'Cash in Bank') debitAcct = { code: '112000', name: 'Cash in Bank' };
    else if (['GCash', 'Maya', 'Maribank', 'E-Wallet'].includes(paymentMethod)) debitAcct = { code: '113000', name: 'E-Wallet' };

    const reference = mkRef('ARS', order.orderNumber);

    const lines = [
      { accountCode: debitAcct.code, accountName: debitAcct.name, debit: amt, credit: 0 },
      { accountCode: '120000', accountName: 'Accounts Receivable', debit: 0, credit: amt },
    ];
    assertBalanced(lines, reference);

    await JournalEntry.create({
      reference,
      description: `A/R settlement — ${order.orderNumber} via ${order.paymentMethod}${note ? ` (${note})` : ''}`,
      lines, totalDebit: amt, totalCredit: amt,
    });

    order.arSettled = true;
    order.arSettledAt = new Date();
    order.arSettledAmount = amt;
    order.arSettledMethod = paymentMethod || 'Cash on Hand';
    order.arSettledNote = note || '';
    await order.save();

    emitToMgr('erpUpdated');
    emitToOps('orderUpdated', order.toObject());
    res.json({ success: true, order });
  } catch (err) {
    log.error({ err }, 'A/R settlement failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Outstanding A/R list (delivery orders, Completed, not yet settled)
app.get('/api/finance/ar-outstanding', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await Order.find({
      status: 'Completed',
      paymentMethod: { $ne: 'Cash' },
      isComplimentary: { $ne: true }, // comps collect no money — never an A/R
      arSettled: { $ne: true }
    }, { orderNumber: 1, customerName: 1, table: 1, total: 1, paymentMethod: 1, createdAt: 1 })
      .sort({ createdAt: -1 }).limit(500).lean();
    const totalOutstanding = rows.reduce((s, r) => s + (r.total || 0), 0);
    res.json({ success: true, orders: rows, totalOutstanding });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// ACCOUNTS PAYABLE — outstanding balance + recent entries + payment
// Payables are journal lines with accountCode '220000':
//   DR 1500 Inventory / CR 2000 AP  → when goods received on credit
//   DR 2000 AP / CR 1000 Cash       → when supplier is paid
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/finance/ap-outstanding', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const agg = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000' } },
      { $group: {
        _id: null,
        totalCredit: { $sum: '$lines.credit' }, // AP incurred
        totalDebit:  { $sum: '$lines.debit'  }, // AP paid
      }}
    ]);
    const bal = agg[0] || { totalCredit: 0, totalDebit: 0 };
    const outstandingBalance = +(bal.totalCredit - bal.totalDebit).toFixed(2);

    // Recent AP journal entries (both directions)
    const recent = await JournalEntry.aggregate([
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '220000' } },
      { $group: {
        _id: '$_id',
        date:        { $first: '$date'        },
        reference:   { $first: '$reference'   },
        description: { $first: '$description' },
        credit:      { $sum: { $cond: [{ $gt: ['$lines.credit', 0] }, '$lines.credit', 0] } },
        debit:       { $sum: { $cond: [{ $gt: ['$lines.debit',  0] }, '$lines.debit',  0] } },
      }},
      { $sort: { date: -1 } },
      { $limit: 50 }
    ]);

    res.json({ success: true, outstandingBalance, recent, totalCredit: bal.totalCredit, totalDebit: bal.totalDebit });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// POST /api/finance/ap-payment — record a supplier payment (DR 2000 AP / CR cash account)
app.post('/api/finance/ap-payment', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { amount, payFromAccount, description, vendorName } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be positive.' });

    const VALID_SRC = { '111000': 'Cash on Hand', '112000': 'Cash in Bank' };
    const srcCode = VALID_SRC[payFromAccount] ? payFromAccount : '111000';
    const srcName = VALID_SRC[srcCode];

    const desc = description?.trim() || `AP payment${vendorName ? ` to ${vendorName}` : ''}`;
    const reference = await mkSeqRef('AP-PAY');

    const lines = [
      { accountCode: '220000', accountName: 'Accounts Payable', debit: amt, credit: 0 },
      { accountCode: srcCode, accountName: srcName,           debit: 0,   credit: amt },
    ];
    assertBalanced(lines, reference);
    const je = await JournalEntry.create({ date: new Date(), reference, description: desc, lines, totalDebit: amt, totalCredit: amt });

    await AuditLog.create({
      userId: req.user?.name || 'System',
      action: 'AP_PAYMENT',
      targetReference: reference,
      details: { amount: amt, payFromAccount: srcCode, vendorName, recordedBy: req.user?.name }
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger
    res.json({ success: true, journalEntry: je });
  } catch (err) {
    log.error({ err }, 'POST /api/finance/ap-payment failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ============================================================
// PROFIT & LOSS REPORT  (date range, revenue vs expense)
// ============================================================
app.get('/api/reports/pnl', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : new Date(new Date().setHours(0,0,0,0));
    const endDate = end ? new Date(end) : new Date();
    endDate.setHours(23,59,59,999);

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      { $unwind: '$lines' },
      { $group: {
          _id: '$lines.accountCode',
          accountName: { $first: '$lines.accountName' },
          totalDebit:  { $sum: { $ifNull: ['$lines.debit',  0] } },
          totalCredit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      }},
      { $sort: { _id: 1 } }
    ]);

    const revenue = [], cogs = [], opex = [];
    let totalRevenue = 0, totalCogs = 0, totalOpex = 0, totalContraRevenue = 0;

    for (const r of agg) {
      const code = r._id;
      const meta = ACCOUNTS[code];
      const balance = (r.totalCredit || 0) - (r.totalDebit || 0); // revenue = credit-balance
      const expBalance = (r.totalDebit || 0) - (r.totalCredit || 0); // expense = debit-balance

      if (!meta) continue;
      if (meta.type === 'revenue' || meta.type === 'other-income') {
        revenue.push({ code, name: meta.name, amount: +balance.toFixed(2) });
        totalRevenue += balance;
      } else if (meta.type === 'contra-revenue') {
        revenue.push({ code, name: meta.name, amount: -(+expBalance.toFixed(2)) });
        totalContraRevenue += expBalance;
      } else if (meta.type === 'expense' && meta.cogs) {
        cogs.push({ code, name: meta.name, amount: +expBalance.toFixed(2) });
        totalCogs += expBalance;
      } else if (meta.type === 'expense') {
        opex.push({ code, name: meta.name, amount: +expBalance.toFixed(2) });
        totalOpex += expBalance;
      }
    }

    const netRevenue = totalRevenue - totalContraRevenue;
    const grossProfit = netRevenue - totalCogs;
    const netIncome = grossProfit - totalOpex;

    res.json({
      success: true,
      period: { start: startDate, end: endDate },
      revenue, cogs, opex,
      totals: {
        revenue: +totalRevenue.toFixed(2),
        contraRevenue: +totalContraRevenue.toFixed(2),
        netRevenue: +netRevenue.toFixed(2),
        cogs: +totalCogs.toFixed(2),
        grossProfit: +grossProfit.toFixed(2),
        grossMargin: netRevenue > 0 ? +((grossProfit / netRevenue) * 100).toFixed(2) : 0,
        opex: +totalOpex.toFixed(2),
        netIncome: +netIncome.toFixed(2),
        netMargin: netRevenue > 0 ? +((netIncome / netRevenue) * 100).toFixed(2) : 0,
      }
    });
  } catch (err) {
    log.error({ err }, 'P&L report failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ============================================================
// MONTHLY P&L — per-account amounts bucketed by month (parent/child + ratios computed client-side)
// ============================================================
app.get('/api/reports/pnl-monthly', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = end ? new Date(end) : new Date();
    endDate.setHours(23, 59, 59, 999);

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      { $unwind: '$lines' },
      { $group: {
        _id: { code: '$lines.accountCode', ym: { $dateToString: { format: '%Y-%m', date: '$date' } } },
        name:   { $first: '$lines.accountName' },
        debit:  { $sum: { $ifNull: ['$lines.debit', 0] } },
        credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      }},
    ]);

    // Ordered list of YYYY-MM buckets spanning the range (incl. empty months).
    const months = [];
    { const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      while (d <= last) { months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() + 1); } }

    const sectionOf = (code, meta) => {
      if (!meta) return null;
      if (meta.type === 'revenue') return 'revenue';
      if (meta.type === 'other-income') return 'otherincome';
      if (meta.type === 'contra-revenue') return 'contra';
      if (meta.type === 'expense' && meta.cogs) return 'cogs';
      if (meta.type === 'expense') return String(code).startsWith('9') ? 'otherexpense' : 'opex';
      return null; // balance-sheet accounts excluded from P&L
    };

    const accounts = {};
    for (const r of agg) {
      const { code, ym } = r._id;
      const meta = ACCOUNTS[code];
      const section = sectionOf(code, meta);
      if (!section) continue;
      const amt = (section === 'revenue' || section === 'otherincome') ? (r.credit - r.debit) : (r.debit - r.credit);
      if (!accounts[code]) {
        const parentCode = meta.parent || code;
        accounts[code] = { code, name: meta.name || r.name, section, parentCode,
          parentName: ACCOUNTS[parentCode]?.name || meta.name || r.name, byMonth: {}, total: 0 };
      }
      accounts[code].byMonth[ym] = +( (accounts[code].byMonth[ym] || 0) + amt ).toFixed(2);
      accounts[code].total = +(accounts[code].total + amt).toFixed(2);
    }
    const accountList = Object.values(accounts).sort((a, b) => a.code.localeCompare(b.code));

    const blank = () => Object.fromEntries(months.map(m => [m, 0]));
    const sec = { revenue: blank(), contra: blank(), cogs: blank(), opex: blank(), otherincome: blank(), otherexpense: blank() };
    for (const a of accountList) for (const [m, v] of Object.entries(a.byMonth)) if (sec[a.section] && m in sec[a.section]) sec[a.section][m] += v;
    const netRevenue = blank(), grossProfit = blank(), netIncome = blank();
    for (const m of months) {
      netRevenue[m]  = +(sec.revenue[m] - sec.contra[m]).toFixed(2);
      grossProfit[m] = +(netRevenue[m] - sec.cogs[m]).toFixed(2);
      // Net income = gross profit − operating expenses + other income − other expenses
      netIncome[m]   = +(grossProfit[m] - sec.opex[m] + sec.otherincome[m] - sec.otherexpense[m]).toFixed(2);
      for (const k of Object.keys(sec)) sec[k][m] = +sec[k][m].toFixed(2);
    }
    const sum = (o) => +Object.values(o).reduce((s, v) => s + v, 0).toFixed(2);

    res.json({
      success: true, period: { start: startDate, end: endDate }, months, accounts: accountList,
      monthTotals: { revenue: sec.revenue, contra: sec.contra, cogs: sec.cogs, opex: sec.opex, otherincome: sec.otherincome, otherexpense: sec.otherexpense, netRevenue, grossProfit, netIncome },
      grandTotals: {
        revenue: sum(sec.revenue), contra: sum(sec.contra), netRevenue: sum(netRevenue),
        cogs: sum(sec.cogs), grossProfit: sum(grossProfit), opex: sum(sec.opex),
        otherincome: sum(sec.otherincome), otherexpense: sum(sec.otherexpense), netIncome: sum(netIncome),
      },
    });
  } catch (err) { log.error({ err }, 'pnl-monthly failed'); res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ============================================================
// BALANCE SHEET (point-in-time: as-of date)
// ============================================================
app.get('/api/reports/balance-sheet', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
    asOf.setHours(23, 59, 59, 999);

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $lte: asOf } } },
      { $unwind: '$lines' },
      { $group: {
          _id: '$lines.accountCode',
          accountName: { $first: '$lines.accountName' },
          totalDebit:  { $sum: { $ifNull: ['$lines.debit',  0] } },
          totalCredit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      }},
      { $sort: { _id: 1 } }
    ]);

    const assets = [], liabilities = [], equity = [];
    let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
    let retainedEarnings = 0; // = revenue − expense − contra-revenue, all-time

    for (const r of agg) {
      const code = r._id;
      const meta = ACCOUNTS[code];
      if (!meta) continue;
      const debit = r.totalDebit || 0;
      const credit = r.totalCredit || 0;

      if (meta.type === 'asset') {
        const bal = debit - credit;
        assets.push({ code, name: meta.name, amount: +bal.toFixed(2) });
        totalAssets += bal;
      } else if (meta.type === 'liability') {
        const bal = credit - debit;
        liabilities.push({ code, name: meta.name, amount: +bal.toFixed(2) });
        totalLiabilities += bal;
      } else if (meta.type === 'equity') {
        const bal = credit - debit;
        equity.push({ code, name: meta.name, amount: +bal.toFixed(2) });
        totalEquity += bal;
      } else if (meta.type === 'revenue' || meta.type === 'other-income') {
        retainedEarnings += (credit - debit);
      } else if (meta.type === 'contra-revenue') {
        retainedEarnings -= (debit - credit);
      } else if (meta.type === 'expense') {
        retainedEarnings -= (debit - credit);
      }
    }
    equity.push({ code: '330000', name: 'Retained Earnings (computed)', amount: +retainedEarnings.toFixed(2) });
    totalEquity += retainedEarnings;

    const totalLiabAndEquity = totalLiabilities + totalEquity;
    const balanced = Math.abs(totalAssets - totalLiabAndEquity) <= 0.01;

    res.json({
      success: true,
      asOf,
      assets, liabilities, equity,
      totals: {
        assets:      +totalAssets.toFixed(2),
        liabilities: +totalLiabilities.toFixed(2),
        equity:      +totalEquity.toFixed(2),
        liabilitiesAndEquity: +totalLiabAndEquity.toFixed(2),
        balanced
      }
    });
  } catch (err) {
    log.error({ err }, 'Balance sheet failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ============================================================
// MONTHLY BALANCE SHEET — cumulative balance as-of each month-end across a range
// ============================================================
app.get('/api/reports/balance-sheet-monthly', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = end ? new Date(end) : new Date();
    endDate.setHours(23, 59, 59, 999);

    const agg = await JournalEntry.aggregate([
      { $match: { date: { $lte: endDate } } }, // everything up to range end (balances are cumulative)
      { $unwind: '$lines' },
      { $group: {
        _id: { code: '$lines.accountCode', ym: { $dateToString: { format: '%Y-%m', date: '$date' } } },
        debit: { $sum: { $ifNull: ['$lines.debit', 0] } }, credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      }},
    ]);

    const months = [];
    { const d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      while (d <= last) { months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() + 1); } }
    const inRange = new Set(months);

    const acct = {};            // code -> { meta, changes: {ym: signedDelta} }
    const earnings = {};        // ym -> net income delta
    for (const r of agg) {
      const { code, ym } = r._id; const meta = ACCOUNTS[code]; if (!meta) continue;
      if (meta.type === 'asset') (acct[code] ??= { meta, changes: {} }).changes[ym] = (acct[code].changes[ym] || 0) + (r.debit - r.credit);
      else if (meta.type === 'liability' || meta.type === 'equity') (acct[code] ??= { meta, changes: {} }).changes[ym] = (acct[code].changes[ym] || 0) + (r.credit - r.debit);
      else {
        let d;
        if (meta.type === 'revenue' || meta.type === 'other-income') d = r.credit - r.debit;
        else d = -(r.debit - r.credit); // contra + expense reduce earnings
        earnings[ym] = (earnings[ym] || 0) + d;
      }
    }

    const allMonths = [...new Set([...Object.values(acct).flatMap(a => Object.keys(a.changes)), ...Object.keys(earnings), ...months])].sort();
    const lastM = months[months.length - 1];

    const mk = (type) => Object.entries(acct).filter(([, a]) => a.meta.type === type).map(([code, a]) => {
      const byMonth = {}; let run = 0;
      for (const ym of allMonths) { run += a.changes[ym] || 0; if (inRange.has(ym)) byMonth[ym] = +run.toFixed(2); }
      return { code, name: a.meta.name, parentCode: a.meta.parent || code, parentName: ACCOUNTS[a.meta.parent || code]?.name || a.meta.name, byMonth, total: byMonth[lastM] || 0 };
    }).sort((x, y) => x.code.localeCompare(y.code));

    const assets = mk('asset'), liabilities = mk('liability'), equity = mk('equity');
    { const byMonth = {}; let run = 0; for (const ym of allMonths) { run += earnings[ym] || 0; if (inRange.has(ym)) byMonth[ym] = +run.toFixed(2); }
      equity.push({ code: '330000', name: 'Retained Earnings (computed)', parentCode: '300000', parentName: 'Equity', byMonth, total: byMonth[lastM] || 0 }); }

    const tot = (rows) => months.reduce((o, m) => { o[m] = +rows.reduce((s, r) => s + (r.byMonth[m] || 0), 0).toFixed(2); return o; }, {});
    res.json({ success: true, period: { start: startDate, end: endDate }, months, asOf: lastM, assets, liabilities, equity,
      monthTotals: { assets: tot(assets), liabilities: tot(liabilities), equity: tot(equity) } });
  } catch (err) { log.error({ err }, 'bs-monthly failed'); res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ============================================================
// JOURNAL CSV EXPORT
// ============================================================
app.get('/api/journal/export', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    const filter = {};
    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = new Date(start);
      if (end)   { const e = new Date(end); e.setHours(23,59,59,999); filter.date.$lte = e; }
    }
    const entries = await JournalEntry.find(filter).sort({ date: 1, reference: 1 }).lean();

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };

    let csv = 'Date,Reference,Description,AccountCode,AccountName,Debit,Credit\n';
    for (const e of entries) {
      const dateStr = new Date(e.date).toISOString().slice(0, 10);
      for (const line of e.lines) {
        csv += [
          esc(dateStr), esc(e.reference), esc(e.description),
          esc(line.accountCode), esc(line.accountName),
          (line.debit || 0).toFixed(2), (line.credit || 0).toFixed(2)
        ].join(',') + '\n';
      }
    }

    const fileName = `journal_${start || 'all'}_to_${end || 'now'}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csv);
  } catch (err) {
    log.error({ err }, 'Journal export failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- SOCKET.IO ---
// ── SOCKET ROOMS ─────────────────────────────────────────────────────────────
// Clients call  socket.emit('joinRoom', role)  after login.
// Rooms: 'cashier' (staff + all roles), 'manager' (superadmin only), 'kitchen' (kitchen display)
// Helpers so server code stays clean:
const emitToOps  = (evt, data) => io.to('cashier').to('kitchen').emit(evt, data);   // operational events
const emitToAll  = (evt, data) => io.emit(evt, data);                               // menu / archive — everyone
const emitToMgr  = (evt, data) => io.to('manager').emit(evt, data);                 // ledger/ERP — superadmin only

io.on('connection', (socket) => {
  log.info({ sid: socket.id }, 'Device connected');

  // Client sends its role after auth so we place it in the right room
  socket.on('joinRoom', (role) => {
    // Every authenticated user joins 'cashier' (they all need order updates)
    socket.join('cashier');
    if (role === 'superadmin') socket.join('manager');
    if (role === 'kitchen')    socket.join('kitchen');
    log.info({ sid: socket.id, role }, 'Joined rooms');
  });

  socket.on('updateOrderStatus', async ({ orderId, status }) => {
    // Database update intentionally removed — HTTP PUT handles all mutations.
    // This stub is kept so old clients don't throw an unhandled-event warning.
  });

  socket.on('disconnect', () => {
    log.info({ sid: socket.id }, 'Device disconnected');
  });
});



// --- AUTO-CODE GENERATORS (Make sure these are defined BEFORE the routes) ---
const getCategoryPrefix = (categoryName) => {
  const clean = categoryName.toUpperCase().replace(/[^A-Z]/g, '');
  if (clean.length < 3) return (clean + 'XXX').substring(0, 3);
  return clean[0] + clean[1] + clean[clean.length - 1]; 
};

const generateNextSequence = async (_Model, prefix, _fieldName) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `${prefix}-A${counter.seq.toString().padStart(4, '0')}`;
};

// --- MIDNIGHT AUTO-ARCHIVE SYSTEM ---
function scheduleMidnightArchive() {
  const now = new Date();
  
  // 1. Calculate precise time to Midnight in the Philippines (Asia/Manila)
  const manilaDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const manilaMidnight = new Date(manilaDate);
  manilaMidnight.setHours(24, 0, 0, 0); 
  const msToMidnight = manilaMidnight.getTime() - manilaDate.getTime();

  // 2. Set the countdown timer
  setTimeout(async () => {
    // Superadmin-controlled toggle: when autoCloseEnabled is explicitly false,
    // skip the automatic cancel/archive/lock and leave the day open for a manual
    // close. The timer still reschedules for the next midnight.
    const acSetting = await Settings.findOne({ key: 'autoCloseEnabled' }).lean();
    if (acSetting && acSetting.value === false) {
      log.info('  Midnight reached (PH Time): auto-close is DISABLED — leaving the day open for manual close.');
      scheduleMidnightArchive();
      return;
    }
    log.info('  Midnight reached (PH Time): Auto-closing the day...');

    try {
      // Step A: Force any hanging order to Cancelled — Pending/Preparing/Ready
      //         plus Parked (held unpaid tabs); clear isParked so none linger.
      await Order.updateMany(
        { status: { $in: ['Pending', 'Preparing', 'Ready', 'Parked'] }, isArchived: false },
        { $set: { status: 'Cancelled', isParked: false } }
      );

      // Step B: Sweep everything active into the archive (incl. the just-cancelled
      //         Parked tabs and any existing Cancelled/Voided orders).
      await Order.updateMany({ isArchived: false }, { $set: { isArchived: true, isParked: false } });
      emitToAll('ordersArchived'); // Tell all iPads/phones to clear their screens

      // Step C: Take the Midnight Inventory Snapshot
      const allItems = await Inventory.find();
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0); 
      for (const item of allItems) {
        await InventoryMovement.create({
          date: todayDate,
          inventoryId: item._id,
          itemName: item.itemName,
          systemEndingBalance: item.stockQty,
        });
      }

      // Step D: 🚨 LOCK THE REGISTER IN THE EOD RECORD 🚨
      const closedDateStr = manilaDate.toLocaleDateString('en-CA'); // YYYY-MM-DD
      await EODRecord.findOneAndUpdate(
        { dateString: closedDateStr },
        { status: 'LOCKED', lockedAt: new Date(), lockedBy: 'SYSTEM AUTO-CLOSE' },
        { upsert: true, new: true }
      );

      log.info(`  Register locked automatically for ${closedDateStr}`);
      emitToMgr('erpUpdated'); // Refreshes the Admin UI to show "EOD Locked"

      // Step E: Telegram daily summary webhook (set TELEGRAM_WEBHOOK_URL in .env)
      if (process.env.TELEGRAM_WEBHOOK_URL) {
        try {
          const todayStart = new Date(closedDateStr + 'T00:00:00.000');
          const todayOrds  = await Order.find({ isArchived: true, createdAt: { $gte: todayStart } }).lean();
          const completed  = todayOrds.filter(o => o.status === 'Completed' && !o.isComplimentary);
          const revenue    = completed.reduce((s, o) => s + (o.total || 0), 0);
          const cashSales  = completed.filter(o => o.paymentMethod === 'Cash').reduce((s, o) => s + (o.total || 0), 0);
          const voids      = todayOrds.filter(o => o.status === 'Voided').length;
          const prodCount  = {};
          completed.forEach(o => (o.items || []).forEach(i => { const n = (i.name || '').replace(/\s*\(.*?\)\s*/g, '').trim(); prodCount[n] = (prodCount[n] || 0) + i.quantity; }));
          const topProd    = Object.entries(prodCount).sort(([, a], [, b]) => b - a)[0];
          const msg = [
            `📊 *${closedDateStr} — Daily Summary*`,
            `💰 Revenue: ₱${revenue.toFixed(2)}`,
            `📦 Orders: ${completed.length} completed${voids > 0 ? `, ${voids} voided` : ''}`,
            `💵 Cash: ₱${cashSales.toFixed(2)} | Non-Cash: ₱${(revenue - cashSales).toFixed(2)}`,
            topProd ? `🏆 Top item: ${topProd[0]} (${topProd[1]}x)` : '',
          ].filter(Boolean).join('\n');
          await fetch(process.env.TELEGRAM_WEBHOOK_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: msg, parse_mode: 'Markdown' })
          });
          log.info('Telegram daily summary sent');
        } catch (tErr) { log.warn({ err: tErr }, 'Telegram webhook failed (non-fatal)'); }
      }

    } catch (error) {
      console.error("Auto-Archive Error:", error);
    }

    // 3. Schedule it again for tomorrow!
    scheduleMidnightArchive();
  }, msToMidnight);
}

// --- 🛡️ STRICT ORDER VALIDATION ENGINE (VAT-INCLUSIVE) 🛡️ ---
// ---   STRICT ORDER VALIDATION ENGINE (VAT-EXCLUSIVE)   ---
const validateOrderMath = (order) => {
  const TOLERANCE = 0.05;

  if (order.subtotal === undefined || order.total === undefined || order.vatAmount === undefined) {
    return { valid: false, error: "Missing critical financial fields (Subtotal, Total, or VAT)." };
  }

  let expectedGross = 0;
  let expectedDiscount = 0;
  let expectedVat = 0;

  for (const item of order.items) {
    if (item.price === undefined || item.quantity === undefined) return { valid: false, error: "Line item missing price or quantity." };
    
    const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
    const itemBase = (item.price + addOnTotal) * item.quantity;
    expectedGross += itemBase;

    const getsDiscount = item.hasDiscount !== false;
    const isolatedItemDiscount = item.discountPercent || 0; // The new item-level tag

    if (order.isComplimentary) {
      expectedDiscount += itemBase; 
    } else if (isolatedItemDiscount > 0) {
      // OVERRIDE: If this item has an isolated discount (e.g. 20% PWD), apply ONLY this discount!
      const itemDisc = itemBase * (isolatedItemDiscount / 100);
      expectedDiscount += itemDisc;
      if (!order.isVatExempt) expectedVat += (itemBase - itemDisc) * 0; // VAT DISABLED
    } else if (getsDiscount && order.discountPercent > 0) {
      // GLOBAL DISCOUNT: Apply only if the item doesn't have an isolated one
      if (order.isVatExempt || order.discountType === 'SC/PWD') {
        expectedDiscount += itemBase * (order.discountPercent / 100);
      } else {
        const itemDisc = itemBase * (order.discountPercent / 100);
        expectedDiscount += itemDisc;
        if (!order.isVatExempt) expectedVat += (itemBase - itemDisc) * 0; // VAT DISABLED
      }
    } else {
      if (!order.isVatExempt) expectedVat += (itemBase * 0); // VAT DISABLED
    }
  }

  if (Math.abs(expectedGross - order.subtotal) > TOLERANCE) return { valid: false, error: `Gross mismatch. Expected P${expectedGross.toFixed(2)}, got P${order.subtotal}` };
  if (Math.abs(expectedVat - order.vatAmount) > TOLERANCE) return { valid: false, error: `VAT invalid. Expected P${expectedVat.toFixed(2)}, got P${order.vatAmount}` };
  const expectedTotal = expectedGross - expectedDiscount + expectedVat;
  if (Math.abs(expectedTotal - order.total) > TOLERANCE) return { valid: false, error: `Total invalid. Expected P${expectedTotal.toFixed(2)}, got P${order.total}` };
  
  return { valid: true };
};
// Start the timer when the server boots up
scheduleMidnightArchive();

// --- SHIFT MANAGEMENT ROUTES ---

// Open a new shift (called on login, records starting cash)
app.post('/api/shifts/start', verifyToken, async (req, res) => {
  try {
    const { startingCash } = req.body;
    // Close any dangling open shifts for this cashier
    await Shift.updateMany(
      { cashierId: String(req.user._id), status: 'Open' },
      { status: 'Closed', shiftEnd: new Date() }
    );
    const shift = await Shift.create({
      cashierId:    String(req.user._id),
      cashierName:  req.user.name,
      startingCash: parseFloat(startingCash) || 0,
    });
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Close shift — records actual cash count and calculates variance
app.post('/api/shifts/end', verifyToken, async (req, res) => {
  try {
    const { actualCash } = req.body;
    const shift = await Shift.findOne({ cashierId: String(req.user._id), status: 'Open' });
    if (!shift) return res.status(404).json({ success: false, error: 'No open shift found.' });

    // Cash sales only (GCash/Card stay with the POS partner, not the register).
    const cashOrders = await Order.find(shiftCashFilter(req.user.name, shift.shiftStart));
    const salesTotal   = cashOrders.reduce((sum, o) => sum + o.total, 0);
    const expectedCash = shift.startingCash + salesTotal;
    const actual       = parseFloat(actualCash) || 0;

    shift.shiftEnd     = new Date();
    shift.salesTotal   = salesTotal;
    shift.expectedCash = expectedCash;
    shift.actualCash   = actual;
    shift.variance     = actual - expectedCash;
    shift.status       = 'Closed';
    await shift.save();

    // Variance journal entry (Cash Short & Over)
    const variance = shift.variance;
    if (Math.abs(variance) > 0.001) {
      const varLines = variance < 0
        ? [ // Short: cashier is missing money
            { accountCode: '930000', accountName: 'Cash Short & Over Expense', debit: Math.abs(variance), credit: 0 },
            { accountCode: '111000', accountName: 'Cash on Hand', debit: 0, credit: Math.abs(variance) },
          ]
        : [ // Over: cashier has extra money
            { accountCode: '111000', accountName: 'Cash on Hand', debit: variance, credit: 0 },
            { accountCode: '830000', accountName: 'Cash Short & Over Income', debit: 0, credit: variance },
          ];
      await JournalEntry.create({
        reference: await mkSeqRef('SHIFT-VAR'),
        description: `Variance adjustment — ${shift.cashierName} (${variance >= 0 ? 'Over' : 'Short'} ₱${Math.abs(variance).toFixed(2)})`,
        lines: varLines,
        totalDebit: Math.abs(variance),
        totalCredit: Math.abs(variance),
      });
    }

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (variance entry)
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- BANK DEPOSIT ROUTES ---
app.post('/api/bank-deposits', verifyToken, async (req, res) => {
  try {
    const { shiftId, amount, reference } = req.body;
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0)
      return res.status(400).json({ success: false, error: 'Invalid deposit amount.' });

    const shift = await Shift.findById(shiftId);
    if (!shift) return res.status(404).json({ success: false, error: 'Shift not found.' });
    if (shift.status === 'Open')
      return res.status(400).json({ success: false, error: 'Close the shift before posting a deposit.' });

    const cashOnHand = (shift.actualCash || 0) - (shift.depositedAmount || 0);
    const maxDeposit = cashOnHand - shift.startingCash;

    if (depositAmount > cashOnHand + 0.01)
      return res.status(400).json({ success: false, error: `Amount exceeds Cash on Hand (₱${cashOnHand.toFixed(2)}).` });
    if (depositAmount > maxDeposit + 0.01)
      return res.status(400).json({ success: false, error: `Cannot reduce drawer below starting fund (₱${shift.startingCash.toFixed(2)}).` });

    const depRef = reference ? reference : await mkSeqRef('DEP');
    const je = await JournalEntry.create({
      reference: depRef,
      description: `Bank deposit — ${shift.cashierName}${reference ? ` (${reference})` : ''}`,
      lines: [
        { accountCode: '112000', accountName: 'Cash in Bank', debit: depositAmount, credit: 0 },
        { accountCode: '111000', accountName: 'Cash on Hand',  debit: 0, credit: depositAmount },
      ],
      totalDebit: depositAmount,
      totalCredit: depositAmount,
    });

    shift.depositedAmount = (shift.depositedAmount || 0) + depositAmount;
    const drawerBalanceAfter = (shift.actualCash || 0) - shift.depositedAmount;
    const isReconciled = Math.abs(drawerBalanceAfter - shift.startingCash) < 0.01;
    if (isReconciled) { shift.isReconciled = true; shift.status = 'Reconciled'; }
    await shift.save();

    const deposit = await BankDeposit.create({
      shiftId: shift._id,
      amount: depositAmount,
      depositedBy: req.user.name,
      reference: depRef,
      journalEntryId: je._id,
      drawerBalanceAfter,
      isDrawerReconciled: isReconciled,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (bank deposit)
    res.json({ success: true, deposit, shift, drawerBalanceAfter, isReconciled });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/bank-deposits', verifyToken, async (req, res) => {
  try {
    const filter = req.query.shiftId ? { shiftId: req.query.shiftId } : {};
    const deposits = await BankDeposit.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, deposits });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/accounts', verifyToken, async (req, res) => {
  try {
    const accounts = await Account.find().sort({ code: 1 });
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Get active shift for the logged-in cashier
app.get('/api/shifts/current', verifyToken, async (req, res) => {
  try {
    const shift = await Shift.findOne({ cashierId: String(req.user._id), status: 'Open' });
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- PARTIAL DELIVERY ROUTE ---
// Sets status to 'Partially Delivered' without triggering ERP (inventory deduction deferred to Completed)
app.post('/api/orders/:id/partial-delivery', verifyToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (!['Ready', 'Preparing'].includes(order.status)) {
      return res.status(400).json({ success: false, error: 'Order must be Ready or Preparing to partially deliver.' });
    }
    order.status = 'Partially Delivered';
    await order.save();
    emitToOps('orderUpdated', order);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- USER / ADMIN ROUTES ---

app.post('/api/users/login', loginLimiter, validate(loginSchema), async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ success: false, message: 'Name and password are required.' });
    const user = await User.findOne({ name });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid name or password' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
      const token = await issueSession(res, user, { userAgent: req.headers['user-agent'] });
      res.json({ success: true, token, user: { _id: user._id, name: user.name, userCode: user.userCode, role: user.role } });
    } else {
      res.status(401).json({ success: false, message: 'Invalid name or password' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Silent refresh — exchange a valid refresh cookie for a new access token.
// Rotates the refresh token (single-use): the old session is revoked and a new
// cookie is issued. A revoked/expired/unknown token clears the cookie and 401s.
app.post('/api/auth/refresh', requireTrustedOrigin, async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) return res.status(401).json({ success: false, error: 'No refresh session.' });

    const session = await RefreshSession.findOne({ tokenHash: hashToken(raw) });
    if (!session || session.revoked || session.expiresAt < new Date()) {
      res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
      return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    }

    const user = await User.findById(session.userId).select('-password');
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
      return res.status(401).json({ success: false, error: 'User no longer exists.' });
    }

    // NON-ROTATING refresh: validate the existing session and mint a fresh access
    // token, keeping the SAME refresh cookie. (We deliberately don't rotate on every
    // refresh — rapid reloads fire concurrent refreshes and rotation would treat the
    // in-flight duplicate as token reuse and log the user out.) Slide the expiry so
    // active sessions stay alive; logout/password/role changes still revoke server-side.
    session.expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await session.save();
    res.cookie(REFRESH_COOKIE, raw, refreshCookieOptions());

    const newToken = signAccessToken(user);
    res.json({ success: true, token: newToken, user: { _id: user._id, name: user.name, userCode: user.userCode, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// Logout — revoke the current refresh session and clear the cookie.
// This is the real teardown the old localStorage-only logout never provided.
app.post('/api/auth/logout', requireTrustedOrigin, async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await RefreshSession.updateOne({ tokenHash: hashToken(raw) }, { revoked: true });
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/users', verifyToken, async (req, res) => {
  const users = await User.find().select('-password').sort({ userCode: 1 });
  res.json({ success: true, users });
});
app.post('/api/users', verifyToken, requireSuperAdmin, validate(userCreateSchema), async (req, res) => {
  try {
    const existing = await User.findOne({ name: { $regex: new RegExp(`^${escapeRegex(req.body.name.trim())}$`, 'i') } });
    if (existing) return res.status(400).json({ success: false, error: 'User already exists' });
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    const userCode = await generateNextSequence(User, 'ADN', 'userCode');
    
    // THE FIX: Add the role from the request body!
    const role = req.body.role || 'Staff'; // Default to cashier if none provided
    
    const newUser = await User.create({ name: req.body.name, password: hashedPassword, userCode, role });
    res.json({ success: true, user: { _id: newUser._id, name: newUser.name, userCode: newUser.userCode, role: newUser.role } });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.put('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const updateData = { name: req.body.name };

    // Only hash and update the password if they actually typed a new one
    if (req.body.password && req.body.password.trim() !== '') {
      updateData.password = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
    if (updateData.password) await revokeUserSessions(req.params.id); // force re-login after password change
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.patch('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, password, role } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (role) updates.role = role;
    if (password && password.trim()) updates.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    if (updates.password || updates.role) await revokeUserSessions(req.params.id); // privilege change → re-login
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.delete('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  await revokeUserSessions(req.params.id); // kill any active sessions for the deleted account
  res.json({ success: true });
});

// Staff self-service password change (any authenticated user, no superadmin required)
// Requires current password for verification — prevents session hijacking.
app.patch('/api/users/me/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ success: false, error: 'Both currentPassword and newPassword are required.' });
    if (newPassword.length < 6)
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(403).json({ success: false, error: 'Current password is incorrect.' });

    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await user.save();

    // Invalidate all existing sessions (other devices), then re-issue one for the
    // current device so the user who just changed their password stays logged in here.
    await revokeUserSessions(user._id);
    const token = await issueSession(res, user, { userAgent: req.headers['user-agent'] });

    await AuditLog.create({
      userId: user.name,
      action: 'PASSWORD_CHANGED',
      targetReference: user.userCode || user._id.toString(),
      details: { changedBy: user.name }
    });

    res.json({ success: true, message: 'Password changed successfully.', token });
  } catch (err) {
    log.error({ err }, 'PATCH /api/users/me/password failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- SHIFT HISTORY ---
app.get('/api/shifts', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit: lim = 20, cashier } = req.query;
    const filter = { cashierId: { $nin: await ownerUserIds() } }; // hide the owner's shifts
    if (cashier) filter.cashierName = { $regex: cashier, $options: 'i' };
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 20);
    const [shifts, total] = await Promise.all([
      Shift.find(filter).sort({ shiftStart: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      Shift.countDocuments(filter)
    ]);

    // For OPEN shifts, salesTotal hasn't been finalised yet (that happens at end).
    // Compute live cash sales so the cashier sees their running total in history.
    for (const s of shifts) {
      if (s.status === 'Open') {
        const cashOrders = await Order.find(shiftCashFilter(s.cashierName, s.shiftStart), { total: 1 }).lean();
        s.salesTotal = cashOrders.reduce((sum, o) => sum + (o.total || 0), 0);
        s.expectedCash = (s.startingCash || 0) + s.salesTotal;
        s.isLive = true; // flag for the UI
      }
    }

    res.json({ success: true, shifts, total, page: pageNum, pages: Math.ceil(total / pageSize) });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- SPOILAGE / WASTE LOGGING ---
app.post('/api/inventory/spoilage/:id', verifyToken, async (req, res) => {
  try {
    const { qty, reason, note } = req.body;
    const spoilQty = parseFloat(qty);
    if (!spoilQty || spoilQty <= 0) return res.status(400).json({ success: false, error: 'Invalid quantity.' });
    if (!reason) return res.status(400).json({ success: false, error: 'Reason is required.' });

    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found.' });
    if (item.stockQty < spoilQty) return res.status(400).json({ success: false, error: 'Cannot spoil more than available stock.' });

    const spoilageCost = spoilQty * (item.unitCost || 0);
    item.stockQty = +(item.stockQty - spoilQty).toFixed(6);
    // FEFO-consume from batches (oldest first — typical spoilage pattern)
    if (item.expiryBatches && item.expiryBatches.length > 0) {
      const r = consumeBatches(item.expiryBatches, spoilQty);
      item.expiryBatches = r.batches;
    }
    item.expiryDate = soonestExpiry(item.expiryBatches || []);
    // If spoilage zeros out the item, also clear any remaining batches
    if (item.stockQty <= 0.0001) {
      item.expiryBatches = [];
      item.expiryDate = null;
    }
    await item.save();

    const spoilRef = await mkSeqRef('INV-SPOIL');

    await StockCard.create({
      inventoryId: item._id,
      itemName: item.itemName,
      type: 'Spoilage',
      reference: spoilRef,
      qtyChange: -spoilQty,
      balanceAfter: item.stockQty,
      unitCost: item.unitCost,
      remarks: `${reason}${note ? ': ' + note : ''}`
    });

    if (spoilageCost > 0.001) {
      await JournalEntry.create({
        reference: spoilRef,
        description: `Spoilage/Waste — ${spoilQty}${item.unit} of ${item.itemName} (${reason})`,
        lines: [
          { accountCode: '535000', accountName: 'Spoilage, Variance & Waste Expense', debit: spoilageCost, credit: 0 },
          { accountCode: '130000', accountName: 'Inventory Asset', debit: 0, credit: spoilageCost }
        ],
        totalDebit: spoilageCost,
        totalCredit: spoilageCost
      });
    }

    emitToMgr('erpUpdated');
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ── ANALYTICS DASHBOARD ENDPOINT ─────────────────────────────────────────────
// Moves heavy computations off the browser so the dashboard stays fast
// even with 12+ months of order history.
// GET /api/audit-logs — superadmin only, paginated, filterable by action + date range
app.get('/api/audit-logs', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit: lim = 30, action, start, end } = req.query;
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 30);

    const filter = {};
    if (action && action !== 'all') filter.action = action;
    if (start || end) {
      filter.timestamp = {};
      if (start) filter.timestamp.$gte = new Date(start);
      if (end)   { const d = new Date(end); d.setHours(23,59,59,999); filter.timestamp.$lte = d; }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ timestamp: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).lean(),
      AuditLog.countDocuments(filter)
    ]);
    res.json({ success: true, logs, total, page: pageNum, pages: Math.ceil(total / pageSize) });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

app.get('/api/analytics/dashboard', verifyToken, async (req, res) => {
  try {
    const now        = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day30ago   = new Date(now.getTime() - 30 * 86400000);
    const day60ago   = new Date(now.getTime() - 60 * 86400000);

    // ── Run DB aggregations in parallel (no full table scan into memory) ──────
    const [todayAgg, allTimeAgg, dailyAgg, topProductsAgg, orders30d, orders7d, inventoryItems] =
      await Promise.all([

      // 1. Today's KPIs
      Order.aggregate([
        { $match: { status: 'Completed', createdAt: { $gte: todayStart } } },
        { $group: {
          _id: null,
          gross:      { $sum: '$subtotal' },
          revNonComp: { $sum: { $cond: ['$isComplimentary', 0, '$total'] } },
          discounts:  { $sum: { $cond: ['$isComplimentary', '$subtotal', { $ifNull: ['$discount', 0] }] } },
          comp:       { $sum: { $cond: ['$isComplimentary', '$subtotal', 0] } },
          count:      { $sum: 1 },
          nonCompCount: { $sum: { $cond: ['$isComplimentary', 0, 1] } },
        }}
      ]),

      // 2. All-time totals
      Order.aggregate([
        { $match: { status: 'Completed' } },
        { $group: {
          _id: null,
          revenue: { $sum: { $cond: ['$isComplimentary', 0, '$total'] } },
          comp:    { $sum: { $cond: ['$isComplimentary', '$subtotal', 0] } },
          orders:  { $sum: 1 },
        }}
      ]),

      // 3. Daily revenue — last 60 days (grouped in Manila time)
      Order.aggregate([
        { $match: { status: 'Completed', createdAt: { $gte: day60ago } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Manila' } },
          net:  { $sum: { $cond: ['$isComplimentary', 0, '$total'] } },
        }},
        { $sort: { _id: 1 } },
      ]),

      // 4. Product tallies by raw name (size-variant merge happens in JS below,
      //    since $replaceAll cannot take a $regexFind object as its `find`).
      Order.aggregate([
        { $match: { status: 'Completed', isComplimentary: { $ne: true } } },
        { $unwind: '$items' },
        { $group: {
          _id:     '$items.name',
          qty:     { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: [{ $ifNull: ['$items.price', 0] }, { $ifNull: ['$items.quantity', 0] }] } },
        }},
      ]),

      // 5. Last-30d orders with items (for raw-material velocity)
      Order.find(
        { status: 'Completed', createdAt: { $gte: day30ago } },
        { items: 1, createdAt: 1 }
      ).lean(),

      // 6. Last-7d orders with items
      Order.find(
        { status: 'Completed', createdAt: { $gte: new Date(now.getTime() - 7 * 86400000) } },
        { items: 1, createdAt: 1 }
      ).lean(),

      // 7. Inventory (needed for velocity + stock KPIs) — include unit fields so the
      //    UI can display kg/L/pcs correctly (effectiveDisplay needs unit/displayUnit/unitMultiplier).
      Inventory.find({}, { itemName: 1, stockQty: 1, unitCost: 1, unit: 1, displayUnit: 1, unitMultiplier: 1 }).lean(),
    ]);

    // ── Today KPIs ─────────────────────────────────────────────────────────────
    const td = todayAgg[0] || {};
    const todayGross    = td.gross || 0;
    const todayRevenue  = td.revNonComp || 0;
    const todayDiscounts= td.discounts || 0;
    const todayComp     = td.comp || 0;
    const todayCount    = td.count || 0;
    const todayAvg      = (td.nonCompCount || 0) > 0 ? todayRevenue / td.nonCompCount : 0;

    // ── All-time totals ─────────────────────────────────────────────────────────
    const at = allTimeAgg[0] || {};
    const totalAllTimeRevenue       = at.revenue || 0;
    const totalAllTimeComplimentary = at.comp    || 0;
    const totalAllTimeOrders        = at.orders  || 0;

    // ── Daily revenue list ─────────────────────────────────────────────────────
    let bestDay = { date: 'N/A', revenue: 0 };
    const dailyRevenue = dailyAgg.map(({ _id, net }) => {
      const label = new Date(_id + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (net > bestDay.revenue) bestDay = { date: label, revenue: net };
      return { date: label, revenue: net };
    });

    // ── Top products: merge size variants ("Latte (Large)" → "Latte") then take top 5 ──
    const tpMerged = {};
    for (const r of topProductsAgg) {
      const base = (r._id || 'Unknown').replace(/\s*\(.*?\)\s*$/, '').trim() || 'Unknown';
      if (!tpMerged[base]) tpMerged[base] = { name: base, qty: 0, revenue: 0 };
      tpMerged[base].qty += r.qty || 0;
      tpMerged[base].revenue += r.revenue || 0;
    }
    const topProducts = Object.values(tpMerged).sort((a, b) => b.qty - a.qty).slice(0, 5);

    // ── Raw-material velocity (weighted ADU: 70% last-7d, 30% last-30d) ────────
    // These use small time-scoped order sets — not the full history
    const [products] = await Promise.all([
      Product.find({}, { name: 1, baseRecipe: 1, sizes: 1 }).lean(),
    ]);

    const computeUsage = (subset) => {
      const usage = {};
      subset.forEach(o => {
        (o.items || []).forEach(orderItem => {
          let product = products.find(p => p._id.toString() === (orderItem.productId || '').toString());
          if (!product) {
            const base = (orderItem.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
            product = products.find(p => p.name === base);
          }
          if (!product) return;
          let recipe = product.baseRecipe || [];
          const sm = (orderItem.name || '').match(/\(([^)]+)\)$/);
          if (sm) {
            const sz = (product.sizes || []).find(s => s.name === sm[1]);
            if (sz?.recipe?.length) recipe = sz.recipe;
          }
          recipe.forEach(ing => {
            if (!usage[ing.name]) {
              const inv = inventoryItems.find(i => i.itemName.toLowerCase() === (ing.name || '').toLowerCase());
              usage[ing.name] = { name: ing.name, qtyUsed: 0, unit: ing.unit, currentStock: inv ? inv.stockQty : 0 };
            }
            usage[ing.name].qtyUsed += (ing.qty || 0) * (orderItem.quantity || 0);
          });
        });
      });
      return usage;
    };

    const daysElapsed30 = Math.max(1, Math.min(30, orders30d.length > 0 ? 30 : 1));
    const daysElapsed7  = Math.max(1, Math.min(7,  orders7d.length  > 0 ? 7  : 1));

    const u7  = computeUsage(orders7d);
    const u30 = computeUsage(orders30d);
    const allIng = new Set([...Object.keys(u7), ...Object.keys(u30)]);
    const rawMaterial = {};
    allIng.forEach(name => {
      const r7  = u7[name],  r30 = u30[name];
      const adu7  = r7  ? r7.qtyUsed  / daysElapsed7  : 0;
      const adu30 = r30 ? r30.qtyUsed / daysElapsed30 : 0;
      const wAdu  = adu7 * 0.7 + adu30 * 0.3;
      const ref   = r7 || r30;
      rawMaterial[name] = { name, unit: ref.unit, currentStock: ref.currentStock, qtyUsed: (r30 || r7).qtyUsed, weightedAdu: wAdu, adu7, adu30, trend: adu30 > 0 ? (adu7 - adu30) / adu30 : 0 };
    });

    const rmEntries = Object.values(rawMaterial);
    const mostUsedStock = rmEntries.filter(i => i.weightedAdu > 0).sort((a, b) => b.weightedAdu - a.weightedAdu).slice(0, 5)
      .map(i => ({ ...i, dailyAvg: i.weightedAdu, daysLeft: i.weightedAdu > 0 ? Math.floor(i.currentStock / i.weightedAdu) : Infinity, weeklyNeed: Math.ceil(i.weightedAdu * 7), monthlyNeed: Math.ceil(i.weightedAdu * 30), reorderPoint: Math.ceil(i.weightedAdu * 3) }));

    const lowestStock = inventoryItems
      .map(item => { const u = rmEntries.find(e => e.name.toLowerCase() === item.itemName.toLowerCase()); const adu = u ? u.weightedAdu : 0; return { ...item, adu, daysOfSupply: adu > 0 ? item.stockQty / adu : (item.stockQty <= 0 ? 0 : Infinity) }; })
      .filter(i => i.daysOfSupply < Infinity).sort((a, b) => a.daysOfSupply - b.daysOfSupply).slice(0, 5);

    const highestStock = inventoryItems
      .map(item => { const u = rmEntries.find(e => e.name.toLowerCase() === item.itemName.toLowerCase()); const adu = u ? u.weightedAdu : 0; const dos = adu > 0 ? item.stockQty / adu : (item.stockQty > 0 ? Infinity : 0); return { ...item, adu, daysOfSupply: dos, tiedUpCapital: item.stockQty * (item.unitCost || 0) }; })
      .filter(i => i.daysOfSupply > 30 && i.stockQty > 0).sort((a, b) => b.tiedUpCapital - a.tiedUpCapital).slice(0, 5);

    res.json({
      success: true,
      today: { gross: todayGross, revenue: todayRevenue, count: todayCount, avg: todayAvg, discounts: todayDiscounts, comp: todayComp },
      allTime: { revenue: totalAllTimeRevenue, comp: totalAllTimeComplimentary, orders: totalAllTimeOrders },
      dailyRevenue,
      bestDay,
      topProducts,
      mostUsedStock,
      lowestStock,
      highestStock,
    });
  } catch (err) {
    log.error({ err }, 'analytics/dashboard error');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ── MODIFIER GROUP CRUD ──────────────────────────────────────────────────────
app.get('/api/modifier-groups', verifyToken, async (req, res) => {
  try { res.json({ success: true, groups: await ModifierGroup.find().lean() }); }
  catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.post('/api/modifier-groups', verifyToken, requireSuperAdmin, validate(modifierGroupSchema), async (req, res) => {
  try { const group = await ModifierGroup.create(req.body); emitToAll('menuUpdated'); res.json({ success: true, group }); }
  catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.put('/api/modifier-groups/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try { const group = await ModifierGroup.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }); emitToAll('menuUpdated'); res.json({ success: true, group }); }
  catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.delete('/api/modifier-groups/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try { await ModifierGroup.findByIdAndDelete(req.params.id); emitToAll('menuUpdated'); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── COMBO / BUNDLE CRUD (Product Promos) ─────────────────────────────────────
app.get('/api/combos', async (req, res) => {
  try {
    const combos = await Combo.find(req.query.all ? {} : { isActive: true }).lean();
    res.json({ success: true, combos });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.post('/api/combos', verifyToken, requireSuperAdmin, validate(comboSchema), async (req, res) => {
  try {
    if (!req.body.name || !(req.body.price > 0)) return res.status(400).json({ success: false, error: 'Name and a positive price are required.' });
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) return res.status(400).json({ success: false, error: 'A combo needs at least one component product.' });
    req.body.comboCode = await generateNextSequence(Combo, 'CMB', 'comboCode');
    const combo = await Combo.create(req.body);
    emitToAll('menuUpdated');
    res.json({ success: true, combo });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.put('/api/combos/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try { const combo = await Combo.findByIdAndUpdate(req.params.id, req.body, { new: true }); emitToAll('menuUpdated'); res.json({ success: true, combo }); }
  catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.delete('/api/combos/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try { await Combo.findByIdAndDelete(req.params.id); emitToAll('menuUpdated'); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});


// Expand an order line into per-product report lines.
//  • Non-combo: one line for the matched product (size-aware recipe + add-on revenue).
//  • Combo: one line per component — the bundle price is allocated across components
//    by their standalone selling price, and COGS comes from each component's recipe.
// Keeps combo sales visible in product/category analytics.
function reportLinesForItem(item, prods, prodMap, invMap) {
  const recipeCost = (recipe) => (recipe || []).reduce((s, ing) => {
    const iv = invMap[ing.invId]; return s + (iv ? (ing.qty || 0) * (iv.unitCost || 0) : 0);
  }, 0);
  const qty = item.quantity || 0;

  if (item.isCombo && (item.comboItems || []).length) {
    const comps = item.comboItems.map(c => {
      const p = prodMap[c.productId] || prods.find(pr => pr.name === c.name);
      let stand = p?.basePrice || 0;
      let recipe = p?.baseRecipe || [];
      if (c.sizeName && p?.sizes) { const sz = p.sizes.find(s => s.name === c.sizeName); if (sz) { stand = sz.price || stand; if (sz.recipe?.length) recipe = sz.recipe; } }
      return { product: p, name: c.name, cqty: (c.quantity || 1), stand, recipe };
    });
    const weightTotal = comps.reduce((s, c) => s + c.stand * c.cqty, 0);
    const comboRevenue = (item.price || 0) * qty;
    return comps.map(c => {
      const share = weightTotal > 0 ? (c.stand * c.cqty) / weightTotal : 1 / comps.length;
      return {
        name: c.name || 'Unknown', category: c.product?.category || 'Uncategorized',
        qty: c.cqty * qty, revenue: comboRevenue * share, cogs: recipeCost(c.recipe) * c.cqty * qty,
      };
    });
  }

  const base = (item.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
  const prod = prodMap[item.productId] || prods.find(p => p.name === base);
  const aoT = (item.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
  let recipe = prod?.baseRecipe || [];
  const sm = (item.name || '').match(/\(([^)]+)\)$/);
  if (sm && prod?.sizes) { const sz = prod.sizes.find(s => s.name === sm[1]); if (sz?.recipe?.length) recipe = sz.recipe; }
  return [{
    name: base || 'Unknown', category: prod?.category || 'Uncategorized',
    qty, revenue: ((item.price || 0) + aoT) * qty, cogs: recipeCost(recipe) * qty,
  }];
}

// ── REPORT: MENU ENGINEERING (Stars / Plowhorses / Puzzles / Dogs) ───────────
app.get('/api/reports/menu-engineering', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = { status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = new Date(start);
      if (end) { const d = new Date(end); d.setHours(23,59,59,999); match.createdAt.$lte = d; }
    }
    const [ordersData, prods, invItems] = await Promise.all([
      Order.find(match, { items: 1 }).lean(),
      Product.find({}, { _id: 1, name: 1, category: 1, basePrice: 1, baseRecipe: 1, sizes: 1 }).lean(),
      Inventory.find({}, { _id: 1, unitCost: 1 }).lean(),
    ]);
    const prodMap = Object.fromEntries(prods.map(p => [p._id.toString(), p]));
    const invMap = Object.fromEntries(invItems.map(i => [i._id.toString(), i]));
    const stat = {};
    for (const o of ordersData) {
      for (const it of (o.items || [])) {
        for (const line of reportLinesForItem(it, prods, prodMap, invMap)) {
          const key = line.name;
          if (!stat[key]) stat[key] = { name: key, qty: 0, revenue: 0, cogs: 0 };
          stat[key].qty += line.qty;
          stat[key].revenue += line.revenue;
          stat[key].cogs += line.cogs;
        }
      }
    }
    const rows = Object.values(stat).map(s => ({
      ...s, profit: s.revenue - s.cogs, margin: s.revenue > 0 ? (s.revenue - s.cogs) / s.revenue * 100 : 0,
    }));
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const avgQty = rows.length ? totalQty / rows.length : 0;
    const avgMargin = rows.length ? rows.reduce((s, r) => s + r.margin, 0) / rows.length : 0;
    rows.forEach(r => {
      const hiVol = r.qty >= avgQty, hiMargin = r.margin >= avgMargin;
      r.quadrant = hiVol && hiMargin ? 'Star' : hiVol && !hiMargin ? 'Plowhorse' : !hiVol && hiMargin ? 'Puzzle' : 'Dog';
    });
    rows.sort((a, b) => b.revenue - a.revenue);
    res.json({ success: true, items: rows, avgQty, avgMargin });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── REPORT: CASHIER VARIANCE TREND ───────────────────────────────────────────
app.get('/api/reports/cashier-variance', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const ownerIds = await ownerUserIds();
    const agg = await Shift.aggregate([
      { $match: { status: { $in: ['Closed', 'Reconciled'] }, variance: { $ne: null }, cashierId: { $nin: ownerIds } } },
      { $group: {
        _id: '$cashierName',
        shifts: { $sum: 1 },
        totalVariance: { $sum: '$variance' },
        avgVariance: { $avg: '$variance' },
        shortCount: { $sum: { $cond: [{ $lt: ['$variance', 0] }, 1, 0] } },
        worstShort: { $min: '$variance' },
      }},
      { $sort: { avgVariance: 1 } },
    ]);
    res.json({ success: true, cashiers: agg.map(c => ({ cashierName: c._id || 'Unknown', ...c })) });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── REPORT: PURCHASE ORDER SUGGESTION (from low stock + velocity) ────────────
app.get('/api/reports/purchase-order', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days) || 7); // cover N days of supply
    const since = new Date(Date.now() - 30 * 86400000);
    const [inv, orders, products] = await Promise.all([
      Inventory.find({}, { itemName: 1, stockQty: 1, unit: 1, unitCost: 1, lowStockThreshold: 1, displayUnit: 1, unitMultiplier: 1 }).lean(),
      Order.find({ status: 'Completed', createdAt: { $gte: since } }, { items: 1 }).lean(),
      Product.find({}, { _id: 1, name: 1, baseRecipe: 1, sizes: 1 }).lean(),
    ]);
    const prodMap = Object.fromEntries(products.map(p => [p._id.toString(), p]));
    // 30-day usage per inventory id
    const usage = {};
    for (const o of orders) {
      for (const it of (o.items || [])) {
        const base = (it.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
        const prod = prodMap[it.productId] || products.find(p => p.name === base);
        if (!prod) continue;
        let recipe = prod.baseRecipe || [];
        const sm = (it.name || '').match(/\(([^)]+)\)$/);
        if (sm) { const sz = prod.sizes?.find(s => s.name === sm[1]); if (sz?.recipe?.length) recipe = sz.recipe; }
        for (const ing of recipe) { if (ing.invId) usage[ing.invId] = (usage[ing.invId] || 0) + (ing.qty || 0) * (it.quantity || 0); }
      }
    }
    const lines = inv.map(i => {
      const adu = (usage[i._id.toString()] || 0) / 30; // avg daily usage (base units)
      const target = adu * days;
      // Display in kg/L/pcs — auto-promote g/ml so the PO never shows base units.
      const { displayUnit, mult } = effectiveDisplay(i);
      const needBase = Math.max(0, target - i.stockQty);
      const lowFlag = i.lowStockThreshold > 0 && i.stockQty <= i.lowStockThreshold;
      return {
        itemName: i.itemName, currentStock: +(i.stockQty / mult).toFixed(2), displayUnit,
        avgDailyUse: +(adu / mult).toFixed(3), suggestedOrder: +(needBase / mult).toFixed(2),
        estCost: +((needBase) * (i.unitCost || 0)).toFixed(2), lowStock: lowFlag,
      };
    }).filter(l => l.suggestedOrder > 0 || l.lowStock).sort((a, b) => (b.lowStock - a.lowStock) || (b.suggestedOrder - a.suggestedOrder));
    const totalEstCost = lines.reduce((s, l) => s + l.estCost, 0);
    res.json({ success: true, coverDays: days, lines, totalEstCost });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── SETTINGS ROUTES ──────────────────────────────────────────────────────────
app.get('/api/settings', verifyToken, async (req, res) => {
  try {
    const rows = await Settings.find().lean();
    res.json({ success: true, settings: Object.fromEntries(rows.map(s => [s.key, s.value])) });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.patch('/api/settings/:key', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { value } = req.body;
    const setting = await Settings.findOneAndUpdate({ key: req.params.key }, { value }, { upsert: true, new: true });
    emitToAll('settingsUpdated', { key: req.params.key, value });
    res.json({ success: true, setting });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── GROSS PROFIT BY CATEGORY ─────────────────────────────────────────────────
app.get('/api/reports/profit-by-category', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = { status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = new Date(start);
      if (end) { const d = new Date(end); d.setHours(23,59,59,999); match.createdAt.$lte = d; }
    }
    const [ordersData, prods, invItems] = await Promise.all([
      Order.find(match, { items: 1 }).lean(),
      Product.find({}, { _id: 1, name: 1, category: 1, basePrice: 1, baseRecipe: 1, sizes: 1 }).lean(),
      Inventory.find({}, { _id: 1, unitCost: 1 }).lean(),
    ]);
    const prodMap  = Object.fromEntries(prods.map(p => [p._id.toString(), p]));
    const invMap   = Object.fromEntries(invItems.map(i => [i._id.toString(), i]));
    const stats    = {};
    for (const order of ordersData) {
      for (const item of (order.items || [])) {
        for (const line of reportLinesForItem(item, prods, prodMap, invMap)) {
          const cat = line.category || 'Uncategorized';
          if (!stats[cat]) stats[cat] = { category: cat, revenue: 0, estimatedCOGS: 0, items: 0 };
          stats[cat].revenue += line.revenue;
          stats[cat].estimatedCOGS += line.cogs;
          stats[cat].items++;
        }
      }
    }
    const result = Object.values(stats).map(c => ({
      ...c,
      grossProfit: c.revenue - c.estimatedCOGS,
      margin: c.revenue > 0 ? ((c.revenue - c.estimatedCOGS) / c.revenue) * 100 : 0
    })).sort((a, b) => b.revenue - a.revenue);
    res.json({ success: true, categories: result });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── SALES BY PAYMENT METHOD ───────────────────────────────────────────────────
app.get('/api/reports/sales-by-payment', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = { status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = new Date(start);
      if (end) { const d = new Date(end); d.setHours(23,59,59,999); match.createdAt.$lte = d; }
    }
    const result = await Order.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, total: { $sum: '$total' }, subtotal: { $sum: '$subtotal' }, discount: { $sum: '$discount' } } },
      { $sort: { total: -1 } }
    ]);
    const grandTotal = result.reduce((s, r) => s + (r.total || 0), 0);
    res.json({ success: true, grandTotal, breakdown: result.map(r => ({ method: r._id, count: r.count, total: r.total, subtotal: r.subtotal, discount: r.discount, pct: grandTotal > 0 ? (r.total / grandTotal * 100) : 0 })) });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── REPORT: SALES SUMMARY BY CHANNEL (Cash / E-Wallet / Bank / Delivery) ──────
// Per-order rows (client can roll up to per-day). Splits each order's payment(s)
// into the four channels, keeping the per-method detail (GCash/Maya/Grab/...).
const paymentChannel = (method) => {
  if (!method || method === 'Cash') return 'cash';
  if (method === 'Bank Transfer') return 'bank';
  if (['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(method)) return 'delivery';
  return 'ewallet'; // GCash, Maya, Maribank, E-Wallet, Other E-Wallet, etc.
};
app.get('/api/reports/sales-summary', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { start, end } = req.query;
    const match = { status: 'Completed', isComplimentary: { $ne: true } };
    if (start || end) {
      match.createdAt = {};
      if (start) match.createdAt.$gte = new Date(start);
      if (end) { const d = new Date(end); d.setHours(23, 59, 59, 999); match.createdAt.$lte = d; }
    }
    const orders = await Order.find(match, { orderNumber: 1, total: 1, paymentMethod: 1, payments: 1, createdAt: 1 })
      .sort({ createdAt: 1 }).lean();

    const rows = orders.map(o => {
      const ch = { cash: 0, ewallet: 0, bank: 0, delivery: 0 };
      const methods = {};
      const splits = (o.payments && o.payments.length)
        ? o.payments
        : [{ method: o.paymentMethod || 'Cash', amount: o.total || 0 }];
      for (const p of splits) {
        const amt = Number(p.amount) || 0;
        const m = p.method || 'Cash';
        ch[paymentChannel(m)] += amt;
        methods[m] = (methods[m] || 0) + amt;
      }
      return { date: o.createdAt, orderNumber: o.orderNumber, ...ch, methods, total: Number(o.total) || 0 };
    });

    const totals = rows.reduce((t, r) => {
      t.cash += r.cash; t.ewallet += r.ewallet; t.bank += r.bank; t.delivery += r.delivery; t.total += r.total;
      for (const [m, a] of Object.entries(r.methods)) t.methods[m] = (t.methods[m] || 0) + a;
      return t;
    }, { cash: 0, ewallet: 0, bank: 0, delivery: 0, total: 0, methods: {} });

    res.json({ success: true, rows, totals });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── REFUND FLOW ───────────────────────────────────────────────────────────────
app.post('/api/orders/:id/refund', verifyToken, requireSuperAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { reason, refundAmount } = req.body;
    if (!reason?.trim()) return res.status(400).json({ success: false, error: 'Reason required.' });
    const order = await Order.findById(req.params.id).session(session);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    if (order.status !== 'Completed') return res.status(400).json({ success: false, error: 'Can only refund Completed orders.' });
    if (order.transactionType === 'REFUND') return res.status(400).json({ success: false, error: 'Already refunded.' });
    const amt = parseFloat(refundAmount) || order.total;
    if (amt <= 0 || amt > order.total + 0.01) return res.status(400).json({ success: false, error: `Refund amount must be between ₱0.01 and ₱${order.total.toFixed(2)}.` });
    const reference = mkRef('REFUND', order.orderNumber);
    const creditAcct = debitAccountFor(order.paymentMethod);
    const lines = [
      { accountCode: '410000', accountName: 'Sales Revenue (Non-VAT)', debit: amt,  credit: 0   },
      { accountCode: creditAcct.code, accountName: creditAcct.name,  debit: 0,    credit: amt },
    ];
    assertBalanced(lines, reference);
    await JournalEntry.create([{ date: new Date(), reference, description: `Refund — ${order.orderNumber}: ${reason}`, lines, totalDebit: amt, totalCredit: amt }], { session });
    order.transactionType = 'REFUND';
    order.voidReason = `REFUND: ${reason}`;
    await order.save({ session });
    await AuditLog.create({ userId: req.user?.name, action: 'ORDER_REFUNDED', targetReference: order.orderNumber, details: { reason, refundAmount: amt, refundedBy: req.user?.name } });
    await session.commitTransaction(); session.endSession();
    emitToOps('orderUpdated', order); emitToMgr('erpUpdated');
    res.json({ success: true, order });
  } catch (err) {
    await session.abortTransaction(); session.endSession();
    log.error({ err }, 'POST /api/orders/:id/refund failed');
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// ── STAFF CLOCK-IN / CLOCK-OUT ────────────────────────────────────────────────
app.post('/api/clock/in', verifyToken, async (req, res) => {
  try {
    const existing = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (existing) return res.status(400).json({ success: false, error: 'Already clocked in.' });
    const manilaDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    const entry = await ClockEntry.create({ staffId: req.user._id.toString(), staffName: req.user.name, date: manilaDate });
    res.json({ success: true, entry });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
// Total break minutes already completed in this shift (excludes an in-progress break).
const completedBreakMinutes = (entry) =>
  (entry.breaks || []).reduce((s, b) => s + (b.end ? (b.minutes || 0) : 0), 0);
const openBreak = (entry) => (entry.breaks || []).find(b => b.start && !b.end);
const BREAK_CAP_MIN = 60; // staff get up to 1 hour of break per shift

app.post('/api/clock/out', verifyToken, async (req, res) => {
  try {
    const { notes } = req.body;
    const entry = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (!entry) return res.status(400).json({ success: false, error: 'Not clocked in.' });
    const now = new Date();
    // If still on break, close it out first.
    const ob = openBreak(entry);
    if (ob) { ob.end = now; ob.minutes = Math.round((now - ob.start) / 60000); entry.markModified('breaks'); }
    entry.clockOut = now;
    entry.durationMinutes = Math.round((now - entry.clockIn) / 60000);
    entry.breakMinutes = completedBreakMinutes(entry);
    entry.workedMinutes = Math.max(0, entry.durationMinutes - entry.breakMinutes);
    if (notes) entry.notes = notes;
    await entry.save();
    res.json({ success: true, entry });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// Start a break. Blocked if not clocked in, already on break, or the 1-hour cap is used up.
app.post('/api/clock/break/start', verifyToken, async (req, res) => {
  try {
    const entry = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (!entry) return res.status(400).json({ success: false, error: 'Not clocked in.' });
    if (openBreak(entry)) return res.status(400).json({ success: false, error: 'Already on break.' });
    const used = completedBreakMinutes(entry);
    if (used >= BREAK_CAP_MIN) return res.status(400).json({ success: false, error: 'Your 1-hour break is already used up. You can only end your shift.' });
    entry.breaks.push({ start: new Date() });
    entry.markModified('breaks');
    await entry.save();
    res.json({ success: true, entry, breakRemainingMinutes: BREAK_CAP_MIN - used });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// End the current break (resume work).
app.post('/api/clock/break/end', verifyToken, async (req, res) => {
  try {
    const entry = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (!entry) return res.status(400).json({ success: false, error: 'Not clocked in.' });
    const ob = openBreak(entry);
    if (!ob) return res.status(400).json({ success: false, error: 'Not currently on break.' });
    const now = new Date();
    ob.end = now;
    ob.minutes = Math.round((now - ob.start) / 60000);
    entry.markModified('breaks');
    await entry.save();
    res.json({ success: true, entry, breakUsedMinutes: completedBreakMinutes(entry) });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

app.get('/api/clock/status', verifyToken, async (req, res) => {
  try {
    const entry = await ClockEntry.findOne({ staffId: req.user._id.toString(), clockOut: { $exists: false } });
    if (!entry) return res.json({ success: true, isClockedIn: false, entry: null });
    const ob = openBreak(entry);
    const breakUsedMinutes = completedBreakMinutes(entry);
    res.json({
      success: true, isClockedIn: true, entry,
      onBreak: !!ob,
      breakStartedAt: ob ? ob.start : null,
      breakUsedMinutes,
      breakRemainingMinutes: Math.max(0, BREAK_CAP_MIN - breakUsedMinutes),
      breakCapMinutes: BREAK_CAP_MIN,
    });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});
app.get('/api/clock/entries', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit: lim = 30, date, staff } = req.query;
    const filter = { staffId: { $nin: await ownerUserIds() } }; // hide the owner
    if (date) filter.date = date;
    if (staff) filter.staffName = { $regex: staff, $options: 'i' };
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, parseInt(lim) || 30);
    const [entries, total] = await Promise.all([
      ClockEntry.find(filter).sort({ clockIn: -1 }).skip((pageNum-1)*pageSize).limit(pageSize).lean(),
      ClockEntry.countDocuments(filter)
    ]);
    res.json({ success: true, entries, total, page: pageNum });
  } catch (err) { res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message }); }
});

// ── REVOLVING FUND SCHEMAS ────────────────────────────────────────────────────
const RevolvingFundSchema = new mongoose.Schema({
  name:           { type: String, required: true },   // e.g. "Kasa Lokal Petty Cash"
  initialAmount:  { type: Number, required: true },   // the fixed float amount
  currentBalance: { type: Number, required: true },   // live running balance
  description:    { type: String, default: '' },      // purpose / notes
  isActive:       { type: Boolean, default: true },
  createdBy:      { type: String },
}, { timestamps: true });

const RevolvingFund = mongoose.model('RevolvingFund', RevolvingFundSchema);

const RevolvingFundTxSchema = new mongoose.Schema({
  fundId:      { type: mongoose.Schema.Types.ObjectId, ref: 'RevolvingFund', required: true, index: true },
  type:        { type: String, enum: ['disbursement', 'replenishment', 'adjustment'], required: true },
  amount:      { type: Number, required: true },       // always positive
  description: { type: String, required: true },
  categoryCode:{ type: String, default: '760000' },      // expense account for disbursements
  performedBy: { type: String },
  date:        { type: Date, default: Date.now },
  balanceAfter:{ type: Number },                       // snapshot of fund balance after this tx
  journalRef:  { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry' },
}, { timestamps: true });

const RevolvingFundTx = mongoose.model('RevolvingFundTx', RevolvingFundTxSchema);

// ── REVOLVING FUND ROUTES ─────────────────────────────────────────────────────

// GET all funds (superadmin only)
app.get('/api/revolving-funds', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const funds = await RevolvingFund.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, funds });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// POST create a new fund (superadmin only)
app.post('/api/revolving-funds', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, initialAmount, description, sourceAccount } = req.body;
    if (!name || !initialAmount || Number(initialAmount) <= 0)
      return res.status(400).json({ success: false, error: 'Fund name and a positive initial amount are required.' });

    // "Paid from" — the cash account the fund is seeded out of (not from thin air).
    const validSources = { '111000': 'Cash on Hand', '112000': 'Cash in Bank' };
    const srcCode = validSources[sourceAccount] ? sourceAccount : '111000';
    const srcName = validSources[srcCode];
    const amt = Number(initialAmount);

    const fund = await RevolvingFund.create({
      name, initialAmount: amt,
      currentBalance: amt,
      description: description || '',
      createdBy: req.user?.name,
    });

    // Opening journal entry: DR 1050 Petty Cash / CR <chosen source account>
    const je = await JournalEntry.create({
      date: new Date(), description: `Revolving Fund established: ${name} (from ${srcName})`,
      lines: [
        { accountCode: '114000', accountName: 'Petty Cash / Revolving Fund', debit: amt, credit: 0 },
        { accountCode: srcCode, accountName: srcName,                      debit: 0, credit: amt },
      ],
      totalDebit: amt, totalCredit: amt,
      reference: await mkSeqRef('RF-OPEN'),
    });

    // Record opening tx
    await RevolvingFundTx.create({
      fundId: fund._id, type: 'replenishment',
      amount: Number(initialAmount),
      description: 'Fund opened — initial amount',
      performedBy: req.user?.name, balanceAfter: Number(initialAmount),
      journalRef: je._id,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (fund opened)
    res.json({ success: true, fund });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// POST disburse from a fund (any staff — they need to log what they spend)
app.post('/api/revolving-funds/:id/disburse', verifyToken, async (req, res) => {
  try {
    const fund = await RevolvingFund.findById(req.params.id);
    if (!fund || !fund.isActive) return res.status(404).json({ success: false, error: 'Fund not found.' });

    const { amount, description, categoryCode } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Amount must be a positive number.' });
    if (!description?.trim()) return res.status(400).json({ success: false, error: 'Description is required.' });
    if (amt > fund.currentBalance)
      return res.status(400).json({ success: false, error: `Insufficient fund balance. Available: ₱${fund.currentBalance.toFixed(2)}` });

    const expCode = categoryCode || '760000';
    const { ACCOUNTS } = await import('./lib/chartOfAccounts.js');
    const expName  = ACCOUNTS[expCode]?.name || 'Other Operating Expenses';

    fund.currentBalance = +(fund.currentBalance - amt).toFixed(2);
    await fund.save();

    // DR expense / CR 1050 Petty Cash
    const je = await JournalEntry.create({
      date: new Date(), description: `Revolving Fund disbursement — ${fund.name}: ${description}`,
      lines: [
        { accountCode: expCode, accountName: expName,                    debit: amt, credit: 0 },
        { accountCode: '114000',  accountName: 'Petty Cash / Revolving Fund', debit: 0, credit: amt },
      ],
      totalDebit: amt, totalCredit: amt,
      reference: await mkSeqRef('RF-OUT'),
    });

    const tx = await RevolvingFundTx.create({
      fundId: fund._id, type: 'disbursement', amount: amt,
      description, categoryCode: expCode,
      performedBy: req.user?.name,
      balanceAfter: fund.currentBalance,
      journalRef: je._id,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (fund disbursement)
    res.json({ success: true, fund, tx });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// POST replenish a fund back to its initial amount (superadmin only)
app.post('/api/revolving-funds/:id/replenish', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const fund = await RevolvingFund.findById(req.params.id);
    if (!fund || !fund.isActive) return res.status(404).json({ success: false, error: 'Fund not found.' });

    const { amount, note, sourceAccount } = req.body;
    // sourceAccount: '111000' = Cash on Hand (default), '112000' = Cash in Bank
    const validSources = { '111000': 'Cash on Hand', '112000': 'Cash in Bank' };
    const srcCode = validSources[sourceAccount] ? sourceAccount : '111000';
    const srcName = validSources[srcCode];

    // If amount not specified, replenish back to full initialAmount
    const shortfall = +(fund.initialAmount - fund.currentBalance).toFixed(2);
    const amt = amount ? Number(amount) : shortfall;

    if (amt <= 0) return res.status(400).json({ success: false, error: 'Fund is already full — nothing to replenish.' });

    fund.currentBalance = +(fund.currentBalance + amt).toFixed(2);
    await fund.save();

    // DR 1050 Petty Cash / CR sourceAccount
    const je = await JournalEntry.create({
      date: new Date(),
      description: `Revolving Fund replenishment — ${fund.name} (from ${srcName})${note ? ': ' + note : ''}`,
      lines: [
        { accountCode: '114000', accountName: 'Petty Cash / Revolving Fund', debit: amt, credit: 0 },
        { accountCode: srcCode,  accountName: srcName,                      debit: 0, credit: amt },
      ],
      totalDebit: amt, totalCredit: amt,
      reference: await mkSeqRef('RF-IN'),
    });

    const tx = await RevolvingFundTx.create({
      fundId: fund._id, type: 'replenishment', amount: amt,
      description: note || `Replenished ₱${amt.toFixed(2)} — balance restored`,
      performedBy: req.user?.name,
      balanceAfter: fund.currentBalance,
      journalRef: je._id,
    });

    emitToMgr('erpUpdated'); // auto-refresh the general ledger (fund replenishment)
    res.json({ success: true, fund, tx });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// GET transaction history for a fund
app.get('/api/revolving-funds/:id/transactions', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const total = await RevolvingFundTx.countDocuments({ fundId: req.params.id });
    const txs   = await RevolvingFundTx.find({ fundId: req.params.id })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({ success: true, txs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// PATCH deactivate a fund (superadmin only)
app.patch('/api/revolving-funds/:id/close', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const fund = await RevolvingFund.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!fund) return res.status(404).json({ success: false, error: 'Fund not found.' });
    res.json({ success: true, fund });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- DISPATCH STATUS UPDATE ---
app.patch('/api/orders/:id/dispatch', verifyToken, async (req, res) => {
  try {
    const { dispatchStatus } = req.body;
    const order = await Order.findByIdAndUpdate(req.params.id, { dispatchStatus }, { new: true });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });
    emitToOps('orderUpdated', order);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: IS_PROD ? 'Internal server error' : err.message });
  }
});

// --- 404 FALLBACK (unmatched routes) ---
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found.' });
});

// --- CENTRALIZED ERROR HANDLER ---
// Catches synchronous throws, CORS rejections, and anything passed to next(err).
// In production it never leaks stack traces, query strings, or internal messages.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (/^CORS blocked/.test(err.message || '') ? 403 : 500);
  log.error({ err, url: req.url, method: req.method }, 'Unhandled request error');
  if (SENTRY_ON && status >= 500) Sentry.captureException(err);
  res.status(status).json({
    success: false,
    error: IS_PROD ? 'An unexpected error occurred.' : (err.message || 'Internal error'),
  });
});

// --- SERVER START ---
const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  log.info({ port: PORT }, 'API server running');
});

const shutdown = async (signal, exitCode = 0) => {
  log.info({ signal }, 'Shutting down gracefully');
  server.close(async () => {
    await mongoose.connection.close();
    log.info('MongoDB connection closed. Server stopped.');
    process.exit(exitCode);
  });
  setTimeout(() => { log.error('Forced shutdown after timeout'); process.exit(1); }, 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// A process that has hit an uncaught exception is in an undefined state — log,
// drain in-flight traffic via the normal shutdown path, then let the supervisor
// (Railway / pm2 / Docker restart policy) start a fresh, clean process.
const fatalExit = (kind) => (err) => {
  log.fatal({ err }, kind);
  if (SENTRY_ON) { try { Sentry.captureException(err); } catch { /* never block exit */ } }
  // Best-effort graceful drain; force-exit guard inside shutdown() caps the wait.
  try { shutdown(kind, 1); } catch { process.exit(1); }
};
process.on('uncaughtException', fatalExit('uncaughtException'));
process.on('unhandledRejection', fatalExit('unhandledRejection'));
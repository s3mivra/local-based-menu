import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

// Fail fast on missing required env vars
if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.error('❌ MONGO_URI and JWT_SECRET must be set in .env — server will not start.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

app.use(compression());

// --- UPDATED CORS CONFIG ---
const allowedOrigins = [
  "http://localhost:3000",
  "http://192.168.100.2:3000",
  "http://172.19.32.1:3000",      
  "http://172.20.10.6:3000",
  "http://10.201.1.204:3000", // <-- Add your new local IP here!
  "http://192.168.30.131:3000",
  "http://192.168.254.116:3000",
  "http://192.168.68.127:3000",
  process.env.FRONTEND_URL
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow if no origin (mobile app/curl), OR in allowedOrigins, 
    // OR if it's a local network IP starting with 192.168 or 172.
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://192.168.') || origin.startsWith('http://172.')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: true
}));

// Update Socket.io CORS to match
// ✅ KEEP THIS NEW ONE
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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


// --- MONGODB CONNECTION (single connect) ---
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB Atlas');
    try {
      const adminCount = await User.countDocuments();
      if (adminCount === 0) {
        const defaultPass = process.env.ADMIN_PASS || 'ChangeMe@2026!';
        const hashedPassword = await bcrypt.hash(defaultPass, 10);
        const userCode = 'ADN-A0001';
        await User.create({ userCode, name: 'Super Admin', password: hashedPassword, role: 'superadmin' });
        console.log(`✅ Default Superadmin seeded: Code [${userCode}]`);
      }
    } catch (err) {
      console.error('Seeding error:', err);
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

      console.log('✅ Counters synced from existing data.');
    } catch (err) {
      console.error('Counter sync error:', err);
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
      return res.status(403).json({ success: false, message: 'Forbidden: Invalid or expired token' });
    }
  };

  // --- NEW: RBAC MIDDLEWARE (Optional but recommended) ---
  // const requireAdmin = (req, res, next) => {
  //   if (req.user.role !== 'Admin') {
  //     return res.status(403).json({ success: false, message: 'Forbidden: Requires Admin privileges' });
  //   }
  //   next();
  // };
// --- DATABASE SCHEMAS ---
const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  department: { type: String, enum: ['Kitchen', 'Bar'], default: 'Kitchen' }
}, { timestamps: true });
const Category = mongoose.model('Category', CategorySchema);
// --- ADD-ONS SCHEMA & ROUTES ---
const AddOnSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, default: 'Extras' },
  recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }]
}, { timestamps: true });
const AddOn = mongoose.model('AddOn', AddOnSchema);

app.get('/api/addons', async (req, res) => {
  const addons = await AddOn.find();
  res.json({ success: true, addons });
});

app.post('/api/addons', verifyToken, async (req, res) => {
  const newAddOn = await AddOn.create(req.body);
  io.emit('menuUpdated');
  res.json({ success: true, addon: newAddOn });
});

app.delete('/api/addons/:id', verifyToken, async (req, res) => {
  await AddOn.findByIdAndDelete(req.params.id);
  io.emit('menuUpdated');
  res.json({ success: true });
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
  image: String
}, { timestamps: true });
const Product = mongoose.model('Product', ProductSchema);

const OrderSchema = new mongoose.Schema({
  orderNumber: String,
  table: String,
  isArchived: { type: Boolean, default: false, index: true },
  status: { type: String, default: 'Pending' },
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
    discountPercent: { type: Number, default: 0 }
  }],
  
  // Strict Accounting Fields
  isVatInclusive: { type: Boolean, default: true }, // Enforces Rule 3 (System-wide standard)
  discountType: { type: String, default: 'None' },  // Enforces Rules 6 & 9
  
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
  changeDue: { type: Number, default: 0 }
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
  stockQty: { type: Number, default: 0 },
  unit: String, // e.g., 'kg', 'pcs', 'liters'
  unitCost: { type: Number, default: 0 }
}, { timestamps: true });
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
  { code: '1000', name: 'Cash on Hand',             type: 'Asset',   normalBalance: 'Debit'  },
  { code: '1010', name: 'Cash in Bank',              type: 'Asset',   normalBalance: 'Debit'  },
  { code: '4000', name: 'Sales Revenue',             type: 'Income',  normalBalance: 'Credit' },
  { code: '5010', name: 'Cash Short & Over Expense', type: 'Expense', normalBalance: 'Debit'  },
  { code: '4020', name: 'Cash Short & Over Income',  type: 'Income',  normalBalance: 'Credit' },
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

// --- NEW: CUSTOM ROLES SCHEMA & ROUTES ---
const RoleSchema = new mongoose.Schema({ name: String });
const Role = mongoose.model('Role', RoleSchema);

app.get('/api/roles', verifyToken, async (req, res) => {
  const roles = await Role.find();
  res.json({ success: true, roles });
});
app.post('/api/roles', verifyToken, async (req, res) => {
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

// 2. JWT Middleware (New)
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

// Hard-gate: role === 'superadmin' ONLY — never trust name strings
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Forbidden: Superadmin role required.' });
  }
  next();
};

// Accepts valid JWT (staff/admin) OR active QR session (customer dine-in)
const verifyOrderAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch {
      return res.status(403).json({ success: false, error: 'Invalid or expired token.' });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/discounts', verifyToken, async (req, res) => {
  try {
    const newDiscount = await Discount.create(req.body);
    res.json({ success: true, discount: newDiscount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/discounts/:id', verifyToken, async (req, res) => {
  try {
    await Discount.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
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
        
        await StockCard.create([{
          inventoryId: item._id, itemName: item.itemName, type: 'Adjustment',
          reference: 'EOD-COUNT', qtyChange: variance, balanceAfter: actualCount,
          remarks: `EOD Audit: ${specificReason}`
        }], { session });

        const valueAbs = Math.abs(variance) * item.unitCost;
        
        if (valueAbs > 0) {
          const entryCount = await JournalEntry.countDocuments();
          const reference = `ADJ-${(entryCount + 1).toString().padStart(4, '0')}`;
          
          if (variance < 0) {
            await JournalEntry.create([{
              reference, description: `Shrinkage (${specificReason}): ${item.itemName}`,
              lines: [
                { accountCode: '5100', accountName: 'Spoilage & Variance Expense', debit: valueAbs, credit: 0 },
                { accountCode: '1500', accountName: 'Inventory Asset', debit: 0, credit: valueAbs }
              ], totalDebit: valueAbs, totalCredit: valueAbs
            }], { session });
          } else {
            await JournalEntry.create([{
              reference, description: `Gain (${specificReason}): ${item.itemName}`,
              lines: [
                { accountCode: '1500', accountName: 'Inventory Asset', debit: valueAbs, credit: 0 },
                { accountCode: '4200', accountName: 'Inventory Adjustment Gain', debit: 0, credit: valueAbs }
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

    io.emit('erpUpdated');
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

    io.emit('erpUpdated'); // Tell all iPads the register is open again!
    res.json({ success: true, message: 'Day reopened successfully.' });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/inventory/history/:id', verifyToken, async (req, res) => {
  try {
    const history = await StockCard.find({ inventoryId: req.params.id }).sort({ date: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch ALL stock card history for the master PDF report
app.get('/api/inventory/history', verifyToken, async (req, res) => {
  try {
    const history = await StockCard.find().sort({ date: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
  io.emit('menuUpdated');
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
    io.emit('menuUpdated');
    res.json({ success: true, category: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete('/api/categories/:id', verifyToken, async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  io.emit('menuUpdated');
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
    res.status(500).json({ success: false, error: err.message });
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
  const products = await Product.find().lean(); // Lightning fast, raw JSON
  res.json({ success: true, products });
});

app.post('/api/products', verifyToken, async (req, res) => {
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
  io.emit('menuUpdated');
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
    io.emit('menuUpdated');
    res.json({ success: true, product: updatedProduct });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

    io.emit('menuUpdated');
    res.json({ success: true, message: 'Product securely archived.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Orders
app.get('/api/orders', verifyToken, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const query = Order.find({ isArchived: false }).sort({ createdAt: -1 }).lean();
    if (page && limit) {
      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
      query.skip((pageNum - 1) * limitNum).limit(limitNum);
      const [orders, total] = await Promise.all([query, Order.countDocuments({ isArchived: false })]);
      return res.json({ success: true, orders, total, page: pageNum, limit: limitNum });
    }
    const orders = await query;
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/orders/archives', verifyToken, requireSuperAdmin, async (req, res) => {
  const archives = await Order.find({ isArchived: true }).sort({ createdAt: -1 });
  res.json({ success: true, archives });
});

// Fetch a single order by ID (Used for Customer Status Lock)
app.get('/api/orders/:id', async (req, res) => {
  try {
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

    let { items, discountPercent = 0, table, customerName, sessionId, isComplimentary = false, employeeName = '' } = req.body;
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

    // Authoritative department stamping — look up each product's category and resolve to Kitchen/Bar
    const productIds = items.map(i => i.productId).filter(Boolean);
    if (productIds.length > 0) {
      const [prods, cats] = await Promise.all([
        Product.find({ _id: { $in: productIds } }, { _id: 1, category: 1 }).lean(),
        Category.find({}, { name: 1, department: 1 }).lean()
      ]);
      const catDeptMap = Object.fromEntries(cats.map(c => [c.name, c.department || 'Kitchen']));
      const prodCatMap = Object.fromEntries(prods.map(p => [p._id.toString(), p.category]));
      for (const item of items) {
        const catName = prodCatMap[item.productId];
        item.department = catName ? (catDeptMap[catName] || 'Kitchen') : (item.department || 'Kitchen');
      }
    }

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    let totalGross = 0;
    let totalDiscount = 0;
    let totalVat = 0;
    
    let discountType = 'None';
    if (isComplimentary) discountType = 'Complimentary';
    else if (isVatExempt && discountPercent > 0) discountType = 'SC/PWD';
    else if (discountPercent > 0) discountType = 'Promo';

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
      transactionType: isComplimentary ? 'COMPLIMENTARY' : 'NORMAL'
    });

    io.emit('newOrder', newOrder);
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
    io.emit('orderUpdated', order.toObject());
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
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
    io.emit('orderUpdated', order.toObject());
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
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
      console.log(`\n[ERP ENGINE] Processing Order: ${order.orderNumber}...`);
      let totalCogs = 0; 

      for (const item of order.items) {
        if (item.price === undefined || item.quantity === undefined) return { valid: false, error: "Line item missing price or quantity." };
        
        let product = null;
        if (item.productId) {
          product = await Product.findById(item.productId).session(session);
        } else {
          const baseName = item.name.replace(/\s*\(.*?\)\s*/g, '').trim();
          product = await Product.findOne({ name: baseName }).session(session);
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
          if (!invItem) {
            const missing = await Inventory.findById(ing.invId).lean();
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK: Cannot fulfill order. [${missing?.itemName || ing.name}] would drop below zero. Please receive stock in the Procurement tab first.` });
          }
          await StockCard.create([{
            inventoryId: invItem._id,
            itemName: invItem.itemName,
            type: 'Sale',
            reference: order.orderNumber,
            qtyChange: -deductQty,
            balanceAfter: invItem.stockQty,
            remarks: `Sold via ${item.name}`
          }], { session });
          totalCogs += (invItem.unitCost * deductQty);
        }
        // 👇 PASTE THIS RIGHT BELOW THE RECIPE LOOP
        // DEDUCT ADD-ONS INVENTORY
        for (const selectedAddOn of (item.selectedAddOns || [])) {
          const productAddOn = product.addOns?.find(a => a.name === selectedAddOn.name);
          if (productAddOn && productAddOn.recipe) {
            for (const ing of productAddOn.recipe) {
              if (!ing.invId) continue;
              const deductQty = (ing.qty * item.quantity);
              const invItem = await Inventory.findOneAndUpdate(
                { _id: ing.invId, stockQty: { $gte: deductQty } },
                { $inc: { stockQty: -deductQty } },
                { session, new: true }
              );
              if (!invItem) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ success: false, error: `INSUFFICIENT STOCK: Add-on [${ing.name || ing.invId}] drops below zero.` });
              }
              await StockCard.create([{
                inventoryId: invItem._id, itemName: invItem.itemName, type: 'Sale',
                reference: order.orderNumber, qtyChange: -deductQty, balanceAfter: invItem.stockQty,
                remarks: `Sold via Add-on (${selectedAddOn.name})`
              }], { session });
              totalCogs += (invItem.unitCost * deductQty);
            }
          }
        }
      }

      let debitAccountCode = '1000';
      let debitAccountName = 'Cash on Hand';
      
      const pm = order.paymentMethod;
      if (pm === 'Bank Transfer') {
        debitAccountCode = '1010';
        debitAccountName = 'Cash in Bank';
      } else if (['E-Wallet', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(pm)) { 
        debitAccountCode = '1015';
        debitAccountName = 'E-Wallet'; 
      } else if (['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(pm)) {
        // Delivery partners don't pay you immediately. This is Accounts Receivable!
        debitAccountCode = '1200';
        debitAccountName = 'Accounts Receivable';
      }

      const reference = `${order.orderNumber.replace('#','')}`;
      const lines = [];

      if (order.isComplimentary) {
        // DR 5300 Complimentary Expense / CR 4000 Sales Revenue at selling price (keeps gross visible)
        const sellingPrice = order.subtotal || 0;
        if (sellingPrice > 0) {
          lines.push({ accountCode: '5300', accountName: 'Complimentary Expense', debit: sellingPrice, credit: 0 });
          lines.push({ accountCode: '4000', accountName: 'Sales Revenue', debit: 0, credit: sellingPrice });
        }
        // DR 5000 COGS / CR 1500 Inventory at cost
        if (totalCogs > 0) {
          lines.push({ accountCode: '5000', accountName: 'Cost of Goods Sold', debit: totalCogs, credit: 0 });
          lines.push({ accountCode: '1500', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
        }
        order.complimentaryCost = totalCogs;
      } else {
        lines.push({ accountCode: debitAccountCode, accountName: debitAccountName, debit: order.total, credit: 0 });
        lines.push({ accountCode: '4150', accountName: 'Sales Discounts', debit: order.discount || 0, credit: 0 });

        const grossSalesAmount = order.total + (order.discount || 0) - order.vatAmount;
        lines.push({ accountCode: '4000', accountName: 'Sales Revenue', debit: 0, credit: grossSalesAmount });
        lines.push({ accountCode: '2100', accountName: 'VAT Payable', debit: 0, credit: order.vatAmount || 0 });

        if (totalCogs > 0) {
          lines.push({ accountCode: '5000', accountName: 'Cost of Goods Sold', debit: totalCogs, credit: 0 });
          lines.push({ accountCode: '1500', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
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

      console.log(`[ERP LEDGER] Single AUTO Entry ${reference} created.`);
      io.emit('erpUpdated');
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

    io.emit('orderUpdated', order);
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

    let cashAccount = '1000';
    const pm = order.paymentMethod;
    if (pm === 'Bank Transfer') cashAccount = '1010';
    if (['E-Wallet', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(pm)) cashAccount = '1015';
    if (['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(pm)) cashAccount = '1200';

    const lines = [];
    const grossSalesAmount = order.total + (order.discount || 0) - order.vatAmount;
    
    if (!order.isComplimentary) {
      lines.push({ accountCode: '4000', accountName: 'Sales Revenue', debit: grossSalesAmount, credit: 0 });
      lines.push({ accountCode: '2100', accountName: 'VAT Payable', debit: order.vatAmount || 0, credit: 0 });
      lines.push({ accountCode: cashAccount, accountName: 'Cash on Hand', debit: 0, credit: order.total });
      if (order.discount > 0) lines.push({ accountCode: '4150', accountName: 'Sales Discounts', debit: 0, credit: order.discount });
    } else {
      // Reverse the complimentary revenue recognition: DR 4000 / CR 5300 at selling price
      const sellingPrice = order.subtotal || 0;
      if (sellingPrice > 0) {
        lines.push({ accountCode: '4000', accountName: 'Sales Revenue', debit: sellingPrice, credit: 0 });
        lines.push({ accountCode: '5300', accountName: 'Complimentary Expense', debit: 0, credit: sellingPrice });
      }
    }

    let totalCogs = 0;
    for (const item of order.items) {
      let product = await Product.findById(item.productId).session(session);
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
            reference: `VOID-${order.orderNumber}`, qtyChange: qtyUsed, balanceAfter: restored.stockQty, remarks: `Voided (${reason})`
          }], { session });
        } else {
          const invItem = await Inventory.findById(ing.invId).session(session);
          if (invItem) totalCogs += (invItem.unitCost * qtyUsed);
        }
      }

      for (const selectedAddOn of (item.selectedAddOns || [])) {
        const productAddOn = product.addOns?.find(a => a.name === selectedAddOn.name);
        if (!productAddOn?.recipe) continue;
        for (const ing of productAddOn.recipe) {
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
              reference: `VOID-${order.orderNumber}`, qtyChange: qtyUsed, balanceAfter: restored.stockQty,
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
        lines.push({ accountCode: '1500', accountName: 'Inventory Asset', debit: totalCogs, credit: 0 });
        lines.push({
          accountCode: '5000',
          accountName: 'Cost of Goods Sold',
          debit: 0, credit: totalCogs
        });
      } else if (reason === 'Spoilage' && !order.isComplimentary) {
        lines.push({ accountCode: '5100', accountName: 'Spoilage & Variance Expense', debit: totalCogs, credit: 0 });
        lines.push({ accountCode: '5000', accountName: 'Cost of Goods Sold', debit: 0, credit: totalCogs });
      }
      // Complimentary + Spoilage: cost already expensed at completion, inventory gone, no reversal
    }

    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
    if (totalDebit > 0 && Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Journal imbalance on VOID-${order.orderNumber}: DR=${totalDebit.toFixed(2)} CR=${totalCredit.toFixed(2)}`);
    }

    // If totalDebit/Credit is 0, it means the item had no BOM and wasn't complimentary. We still log the order status change.
    if (totalDebit > 0) {
        await JournalEntry.create([{ 
        reference: `VOID-${order.orderNumber}`, 
        description: `VOID (${reason}) by ${adminName}`, 
        lines, totalDebit, totalCredit 
        }], { session });
    }

    order.status = 'Voided';
    order.voidReason = reason;
    await order.save({ session });
    
    await session.commitTransaction();
    session.endSession();

    io.emit('erpUpdated');
    io.emit('orderUpdated', order);
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
    // 1. Force any hanging kitchen orders to Cancelled
    await Order.updateMany(
      { status: { $in: ['Pending', 'Preparing'] } },
      { $set: { status: 'Cancelled' } }
    );
    
    // 2. Sweep EVERYTHING that is currently active into the archive
    await Order.updateMany(
      { isArchived: false },
      { $set: { isArchived: true } }
    );

    io.emit('ordersArchived');
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
    const existing = await Inventory.findOne({ itemName: { $regex: new RegExp(`^${req.body.itemName.trim()}$`, 'i') } });
    if (existing) return res.status(400).json({ success: false, error: 'Item already exists.' });

    // Inject RML code
    req.body.itemCode = await generateNextSequence(Inventory, 'RML', 'itemCode');
    const newItem = await Inventory.create(req.body);
    
    // --- AUTO-JOURNAL FOR PURCHASING INVENTORY ---
    const totalCost = newItem.stockQty * newItem.unitCost;
    if (totalCost > 0) {
      const entryCount = await JournalEntry.countDocuments();
      const reference = `PURCH-${(entryCount + 1).toString().padStart(4, '0')}`;
      const lines = [
        { accountCode: '1500', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
        { accountCode: '1000', accountName: 'Cash on Hand', debit: 0, credit: totalCost }
      ];
      await JournalEntry.create({ reference, description: `Purchased ${newItem.stockQty}${newItem.unit} of ${newItem.itemName}`, lines, totalDebit: totalCost, totalCredit: totalCost });
    }

    io.emit('erpUpdated');
    res.json({ success: true, item: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- NEW: RESTOCK EXISTING INVENTORY (Weighted Average Cost) ---
app.post('/api/inventory/restock/:id', verifyToken, async (req, res) => {
  try {
    const { addedStock, totalCost } = req.body;
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    // WEIGHTED AVERAGE COST MATH
    const currentTotalValue = item.stockQty * item.unitCost;
    const newTotalValue = currentTotalValue + totalCost;
    const newStockQty = item.stockQty + addedStock;
    const newUnitCost = newStockQty > 0 ? newTotalValue / newStockQty : 0;

    item.stockQty = newStockQty;
    item.unitCost = newUnitCost;
    await item.save();

    // --- NEW: WRITE THE RESTOCK TO THE STOCK CARD ---
    // This is what the EOD Engine reads to calculate the "In" column!
    await StockCard.create({
      inventoryId: item._id,
      itemName: item.itemName,
      type: 'Restock',
      reference: 'MANUAL-RESTOCK',
      qtyChange: addedStock, // Positive because it is entering inventory
      balanceAfter: item.stockQty,
      remarks: 'Restocked inventory'
    });

    // AUTO-JOURNAL FOR RESTOCKING
    if (totalCost > 0) {
      const entryCount = await JournalEntry.countDocuments();
      const reference = `PURCH-${(entryCount + 1).toString().padStart(4, '0')}`;
      const lines = [
        { accountCode: '1500', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
        { accountCode: '1000', accountName: 'Cash on Hand', debit: 0, credit: totalCost }
      ];
      await JournalEntry.create({ reference, description: `Restocked ${addedStock}${item.unit} of ${item.itemName}`, lines, totalDebit: totalCost, totalCredit: totalCost });
    }

    io.emit('erpUpdated');
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/inventory/:id', verifyToken, async (req, res) => {
  const updatedItem = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, item: updatedItem });
});

app.delete('/api/inventory/:id', verifyToken, async (req, res) => {
  await Inventory.findByIdAndDelete(req.params.id);
  res.json({ success: true });
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

    const entryCount = await JournalEntry.countDocuments();
    const currentYear = new Date().getFullYear();
    const reference = await generateNextSequence(JournalEntry, `JRN-${currentYear}`, 'reference');

    const newEntry = await JournalEntry.create({
      reference, description, lines, totalDebit, totalCredit
    });

    res.json({ success: true, entry: newEntry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/finance/balances', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const entries = await JournalEntry.find();
    let cashOnHand = 0;
    
    entries.forEach(entry => {
       entry.lines.forEach(line => {
          // Asset Accounts: Balance = Debit - Credit
          if (line.accountCode === '1000') {
            cashOnHand += (line.debit || 0) - (line.credit || 0);
          }
       });
    });
    
    res.json({ success: true, cashOnHand });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// --- SOCKET.IO ---
io.on('connection', (socket) => {
  console.log(`📡 Device Connected: ${socket.id}`);

  socket.on('updateOrderStatus', async ({ orderId, status }) => {
    // We intentionally removed the database update here!
    // The HTTP PUT route now strictly handles the database saving and ERP logic,
    // which prevents the socket from "racing" and breaking the inventory deductions.
  });

  socket.on('disconnect', () => {
    console.log(`🛑 Device Disconnected: ${socket.id}`);
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
    console.log('  Midnight reached (PH Time): Auto-closing the day...');
    
    try {
      // Step A: Force any hanging orders (Pending/Preparing/Ready) to Cancelled
      await Order.updateMany(
        { status: { $in: ['Pending', 'Preparing', 'Ready'] }, isArchived: false }, 
        { $set: { status: 'Cancelled' } }
      );

      // Step B: Sweep everything active into the archive
      await Order.updateMany({ isArchived: false }, { $set: { isArchived: true } });
      io.emit('ordersArchived'); // Tell all iPads/phones to clear their screens

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

      console.log(`  Register locked automatically for ${closedDateStr}`);
      io.emit('erpUpdated'); // Refreshes the Admin UI to show "EOD Locked"
      
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// Close shift — records actual cash count and calculates variance
app.post('/api/shifts/end', verifyToken, async (req, res) => {
  try {
    const { actualCash } = req.body;
    const shift = await Shift.findOne({ cashierId: String(req.user._id), status: 'Open' });
    if (!shift) return res.status(404).json({ success: false, error: 'No open shift found.' });

    // Cash sales only (GCash/Card stay with the POS partner, not the register)
    const cashOrders = await Order.find({
      cashier:       req.user.name,
      status:        'Completed',
      paymentMethod: 'Cash',
      createdAt:     { $gte: shift.shiftStart }
    });
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
            { accountCode: '5010', accountName: 'Cash Short & Over Expense', debit: Math.abs(variance), credit: 0 },
            { accountCode: '1000', accountName: 'Cash on Hand', debit: 0, credit: Math.abs(variance) },
          ]
        : [ // Over: cashier has extra money
            { accountCode: '1000', accountName: 'Cash on Hand', debit: variance, credit: 0 },
            { accountCode: '4020', accountName: 'Cash Short & Over Income', debit: 0, credit: variance },
          ];
      await JournalEntry.create({
        reference: `VAR-${shift._id}`,
        description: `Variance adjustment — ${shift.cashierName} (${variance >= 0 ? 'Over' : 'Short'} ₱${Math.abs(variance).toFixed(2)})`,
        lines: varLines,
        totalDebit: Math.abs(variance),
        totalCredit: Math.abs(variance),
      });
    }

    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

    const je = await JournalEntry.create({
      reference: `DEP-${Date.now()}`,
      description: `Bank deposit — ${shift.cashierName}${reference ? ` (${reference})` : ''}`,
      lines: [
        { accountCode: '1010', accountName: 'Cash in Bank', debit: depositAmount, credit: 0 },
        { accountCode: '1000', accountName: 'Cash on Hand',  debit: 0, credit: depositAmount },
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
      reference: reference || '',
      journalEntryId: je._id,
      drawerBalanceAfter,
      isDrawerReconciled: isReconciled,
    });

    res.json({ success: true, deposit, shift, drawerBalanceAfter, isReconciled });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/bank-deposits', verifyToken, async (req, res) => {
  try {
    const filter = req.query.shiftId ? { shiftId: req.query.shiftId } : {};
    const deposits = await BankDeposit.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, deposits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/accounts', verifyToken, async (req, res) => {
  try {
    const accounts = await Account.find().sort({ code: 1 });
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get active shift for the logged-in cashier
app.get('/api/shifts/current', verifyToken, async (req, res) => {
  try {
    const shift = await Shift.findOne({ cashierId: String(req.user._id), status: 'Open' });
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    io.emit('orderUpdated', order);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- USER / ADMIN ROUTES ---

app.post('/api/users/login', loginLimiter, async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ success: false, message: 'Name and password are required.' });
    const user = await User.findOne({ name });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid name or password' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
      const token = jwt.sign(
        { _id: user._id, name: user.name, userCode: user.userCode, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '12h' }
      );
      res.json({ success: true, token, user: { _id: user._id, name: user.name, userCode: user.userCode, role: user.role } });
    } else {
      res.status(401).json({ success: false, message: 'Invalid name or password' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/users', verifyToken, async (req, res) => {
  const users = await User.find().select('-password').sort({ userCode: 1 });
  res.json({ success: true, users });
});
app.post('/api/users', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const existing = await User.findOne({ name: { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') } });
    if (existing) return res.status(400).json({ success: false, error: 'User already exists' });
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const userCode = await generateNextSequence(User, 'ADN', 'userCode');
    
    // THE FIX: Add the role from the request body!
    const role = req.body.role || 'Staff'; // Default to cashier if none provided
    
    const newUser = await User.create({ name: req.body.name, password: hashedPassword, userCode, role });
    res.json({ success: true, user: { _id: newUser._id, name: newUser.name, userCode: newUser.userCode, role: newUser.role } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const updateData = { name: req.body.name };

    // Only hash and update the password if they actually typed a new one
    if (req.body.password && req.body.password.trim() !== '') {
      updateData.password = await bcrypt.hash(req.body.password, 10);
    }

    const updated = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { name, password, role } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (role) updates.role = role;
    if (password && password.trim()) updates.password = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// --- SERVER START ---
const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
});

const shutdown = async (signal) => {
  console.log(`\n${signal} received — shutting down gracefully...`);
  server.close(async () => {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed. Server stopped.');
    process.exit(0);
  });
  setTimeout(() => { console.error('⏱ Forced shutdown after timeout'); process.exit(1); }, 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

// ... (imports remain the same)

const app = express();
const server = http.createServer(app);

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
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

// Update Socket.io CORS to match
// ✅ KEEP THIS NEW ONE
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));


// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB Atlas');
    
    // --- SUPER ADMIN SEEDER ---
    try {
      const adminCount = await User.countDocuments();
      if (adminCount === 0) {
        const defaultPass = process.env.ADMIN_PASS || 'fallback123';
        
        // Hash the password before saving!
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(defaultPass, saltRounds);
        
        const userCode = await generateNextSequence(User, 'ADN', 'userCode');
        await User.create({ userCode, name: 'Super Admin', password: hashedPassword });
        console.log(`🌱 Default Admin seeded: Code [${userCode}]`);
      }
    } catch (err) {
      console.error("Seeding error:", err);
    }
  })
// --- DATABASE SCHEMAS ---
const CategorySchema = new mongoose.Schema({ name: String });
const Category = mongoose.model('Category', CategorySchema);

// 1. UPDATE THE PRODUCT SCHEMA (Add Recipes)
const ProductSchema = new mongoose.Schema({
  productCode: String,
  name: String,
  description: String,
  category: String,
  basePrice: Number,
  baseSize: String,
  baseRecipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }],
  sizes: [{ 
    sizeCode: String,
    name: String, 
    price: Number, 
    recipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }] 
  }],
  image: String
});
const Product = mongoose.model('Product', ProductSchema);

const OrderSchema = new mongoose.Schema({
  orderNumber: String,
  table: String,
  status: { type: String, default: 'Pending' },
  customerName: { type: String, default: 'Guest' },
  paymentMethod: { type: String, default: 'Cash' },
  
  // Item Level Tracking
  items: [{ 
    productId: String, 
    name: String, 
    price: Number, 
    quantity: Number,
    hasDiscount: { type: Boolean, default: true }
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
  isVatExempt: { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false },
  // --- NEW ENTERPRISE FIELDS ---
  cashier: { type: String, default: 'System' },
  isComplimentary: { type: Boolean, default: false },
  employeeName: { type: String, default: '' },
  voidReason: { type: String, default: '' } // Tracks if a void was 'Spoiled' or 'Restocked'
}, { timestamps: true });
const Order = mongoose.model('Order', OrderSchema);

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
  date: { type: Date, default: Date.now },
  reference: String, // e.g., 'JE-001' or Order Number
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
const StockCard = mongoose.model('StockCard', StockCardSchema);

const UserSchema = new mongoose.Schema({
  userCode: String,
  name: String,
  password: String
}, { timestamps: true });
const User = mongoose.model('User', UserSchema);

const DiscountSchema = new mongoose.Schema({
  name: String,        // e.g., "Senior Citizen 20%", "Employee 10%"
  percentage: Number,  // e.g., 20
});
const Discount = mongoose.model('Discount', DiscountSchema);

const EODRecordSchema = new mongoose.Schema({
  dateString: String, // e.g., '2026-04-29'
  status: { type: String, default: 'OPEN' }, // 'OPEN' or 'LOCKED'
  lockedAt: Date,
  lockedBy: String
});
const EODRecord = mongoose.model('EODRecord', EODRecordSchema);

// --- API ROUTES ---

// --- DISCOUNT ROUTES ---
app.get('/api/discounts', async (req, res) => {
  try {
    const discounts = await Discount.find();
    res.json({ success: true, discounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/discounts', async (req, res) => {
  try {
    const newDiscount = await Discount.create(req.body);
    res.json({ success: true, discount: newDiscount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/discounts/:id', async (req, res) => {
  try {
    await Discount.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- INVENTORY PHYSICAL COUNT & DAILY CLOSE ---

// --- 1. FETCH EOD STATUS & REAL MOVEMENTS ---
app.get('/api/inventory/eod-data', async (req, res) => {
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
app.post('/api/inventory/count', async (req, res) => {
  try {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    
    // STRICT CHECK: Is it already locked?
    const existingEOD = await EODRecord.findOne({ dateString: todayStr });
    if (existingEOD && existingEOD.status === 'LOCKED') {
      return res.status(403).json({ success: false, error: 'ALREADY_CLOSED: You cannot submit another EOD for today.' });
    }

    const { counts, reasons, adminName } = req.body; 

    const items = await Inventory.find();

    for (const item of items) {
      if (counts[item._id] === undefined || counts[item._id] === '') continue; 
      
      const actualCount = Number(counts[item._id]);
      const variance = actualCount - item.stockQty;

      if (variance !== 0) {
        const specificReason = reasons && reasons[item._id] ? reasons[item._id] : 'Unaccounted Variance';

        await StockCard.create({
          inventoryId: item._id, itemName: item.itemName, type: 'Adjustment',
          reference: 'EOD-COUNT', qtyChange: variance, balanceAfter: actualCount,
          remarks: `EOD Audit: ${specificReason}`
        });

        const valueAbs = Math.abs(variance) * item.unitCost;
        if (valueAbs > 0) {
          const entryCount = await JournalEntry.countDocuments();
          const reference = `ADJ-${(entryCount + 1).toString().padStart(4, '0')}`;
          
          if (variance < 0) {
            await JournalEntry.create({
              reference, description: `Shrinkage (${specificReason}): ${item.itemName}`,
              lines: [
                { accountCode: '5100', accountName: 'Spoilage & Variance Expense', debit: valueAbs, credit: 0 },
                { accountCode: '1500', accountName: 'Inventory Asset', debit: 0, credit: valueAbs }
              ], totalDebit: valueAbs, totalCredit: valueAbs
            });
          } else {
            await JournalEntry.create({
              reference, description: `Gain (${specificReason}): ${item.itemName}`,
              lines: [
                { accountCode: '1500', accountName: 'Inventory Asset', debit: valueAbs, credit: 0 },
                { accountCode: '4200', accountName: 'Inventory Adjustment Gain', debit: 0, credit: valueAbs }
              ], totalDebit: valueAbs, totalCredit: valueAbs
            });
          }
        }
      }
      item.stockQty = actualCount;
      await item.save();
    }

    // LOCK THE DAY
    await EODRecord.findOneAndUpdate(
      { dateString: todayStr },
      { status: 'LOCKED', lockedAt: new Date(), lockedBy: adminName || 'Admin' },
      { upsert: true, new: true }
    );

    io.emit('erpUpdated');
    res.json({ success: true, message: "End of day locked." });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/inventory/history/:id', async (req, res) => {
  try {
    const history = await StockCard.find({ inventoryId: req.params.id }).sort({ date: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch ALL stock card history for the master PDF report
app.get('/api/inventory/history', async (req, res) => {
  try {
    const history = await StockCard.find().sort({ date: -1 });
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// Categories
app.get('/api/categories', async (req, res) => {
  const categories = await Category.find();
  res.json({ success: true, categories });
});

app.post('/api/categories', async (req, res) => {
  const newCat = await Category.create({ name: req.body.name });
  io.emit('menuUpdated');
  res.json({ success: true, category: newCat });
});

app.delete('/api/categories/:id', async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  io.emit('menuUpdated');
  res.json({ success: true });
});

// Products
app.get('/api/products', async (req, res) => {
  const products = await Product.find();
  res.json({ success: true, products });
});

app.post('/api/products', async (req, res) => {
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

app.put('/api/products/:id', async (req, res) => {
  const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
  io.emit('menuUpdated');
  res.json({ success: true, product: updatedProduct });
});

app.delete('/api/products/:id', async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  io.emit('menuUpdated');
  res.json({ success: true });
});

// Orders
app.get('/api/orders', async (req, res) => {
  const orders = await Order.find({ isArchived: false }).sort({ createdAt: -1 });
  res.json({ success: true, orders });
});

app.get('/api/orders/archives', async (req, res) => {
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

app.post('/api/orders', async (req, res) => {
  try {
    // ADD isComplimentary, employeeName, and cashier here
    const { items, discountPercent = 0, isVatExempt = false, table = 'Takeout', customerName, isComplimentary = false, employeeName = '', cashier = 'Admin' } = req.body;

    if (!items || items.length === 0) throw new Error("Cart is empty");

    let totalGross = 0;
    let totalDiscount = 0;
    let totalVat = 0;
    
    let discountType = 'None';
    if (isComplimentary) discountType = 'Complimentary';
    else if (isVatExempt && discountPercent > 0) discountType = 'SC/PWD';
    else if (discountPercent > 0) discountType = 'Promo';

    const validatedItems = items.map(item => {
      item.hasDiscount = true; 
      const itemBase = item.price * item.quantity;
      totalGross += itemBase;
      
      if (isComplimentary) {
        totalDiscount += itemBase; 
      } else if (discountPercent > 0) {
        if (isVatExempt || discountType === 'SC/PWD') {
          const vatExemptBase = itemBase / 1.12;
          const scDisc = vatExemptBase * (discountPercent / 100);
          totalDiscount += (itemBase - (vatExemptBase - scDisc));
        } else {
          const itemDisc = itemBase * (discountPercent / 100);
          totalDiscount += itemDisc;
          const itemNet = itemBase - itemDisc;
          if (!isVatExempt) totalVat += (itemNet - (itemNet / 1.12));
        }
      } else {
        if (!isVatExempt) totalVat += (itemBase - (itemBase / 1.12));
      }
      return item;
    });

    const vatRate = (isVatExempt || isComplimentary) ? 0 : 0.12;
    const finalTotal = totalGross - totalDiscount;

    const currentYear = new Date().getFullYear();
    const orderNumber = await generateNextSequence(Order, `ORD-${currentYear}`, 'orderNumber');

    const newOrder = await Order.create({
      orderNumber, table, items: validatedItems, 
      subtotal: totalGross, vatRate: vatRate, vatAmount: totalVat, 
      discountPercent: isComplimentary ? 100 : discountPercent, 
      discount: totalDiscount, total: finalTotal, 
      isVatExempt, discountType, customerName,
      isComplimentary, employeeName, cashier // <-- Save the new data
    });

    io.emit('newOrder', newOrder);
    res.json({ success: true, order: newOrder });
  } catch (error) {
    console.error("Order Creation Error:", error);
    res.status(500).json({ success: false, error: 'Order failed' });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const { status, discountPercent, isVatExempt, paymentMethod, discountType, discountedIndices } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false });

    const wasNotCompleted = order.status !== 'Completed';
    if (status) order.status = status;
    if (paymentMethod) order.paymentMethod = paymentMethod;

    if (discountPercent !== undefined) order.discountPercent = discountPercent;
    if (isVatExempt !== undefined) order.isVatExempt = isVatExempt;
    if (discountType !== undefined) order.discountType = discountType;

    // Ensure discountType is accurate based on isVatExempt if not explicitly provided
    if(order.discountPercent > 0 && (!order.discountType || order.discountType === 'None')) {
        order.discountType = order.isVatExempt ? 'SC/PWD' : 'Promo';
    } else if (order.discountPercent === 0) {
        order.discountType = 'None';
    }

    // Update which items have the discount toggled on
    if (discountedIndices !== undefined) {
      order.items.forEach((item, idx) => {
        item.hasDiscount = discountedIndices.includes(idx);
      });
    }

    // --- 🧹 BULLETPROOF MATH RECALCULATION (VAT-INCLUSIVE) ---
    let totalGross = 0;
    let totalDiscount = 0;
    let totalVat = 0;

    order.items.forEach(item => {
      const itemBase = item.price * item.quantity;
      totalGross += itemBase;

      const getsDiscount = item.hasDiscount !== false;

      if (order.isComplimentary) {
        totalDiscount += itemBase;
      } else if (getsDiscount && order.discountPercent > 0) {
        if (order.isVatExempt || order.discountType === 'SC/PWD') {
          const vatExemptBase = itemBase / 1.12;
          const scDisc = vatExemptBase * (order.discountPercent / 100);
          totalDiscount += (itemBase - (vatExemptBase - scDisc));
        } else {
          const itemDisc = itemBase * (order.discountPercent / 100);
          totalDiscount += itemDisc;
          const itemNet = itemBase - itemDisc;
          if (!order.isVatExempt) totalVat += (itemNet - (itemNet / 1.12));
        }
      } else {
        if (!order.isVatExempt) totalVat += (itemBase - (itemBase / 1.12));
      }
    });

    order.subtotal = Number(totalGross.toFixed(2));
    order.discount = Number(totalDiscount.toFixed(2));
    order.vatAmount = Number(totalVat.toFixed(2));
    order.vatRate = (order.isVatExempt || order.isComplimentary) ? 0 : 0.12;
    order.total = Number((totalGross - totalDiscount).toFixed(2));

    // Notice: The 400 Bad Request validator has been permanently deleted from here!

    // --- 🛑 POS GUARDRAIL: CHECK IF EOD IS LOCKED ---
    if (status === 'Completed' && wasNotCompleted) {
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      const currentEOD = await EODRecord.findOne({ dateString: todayStr });
      
      if (currentEOD && currentEOD.status === 'LOCKED') {
        return res.status(403).json({ 
          success: false, 
          error: 'REGISTER CLOSED: EOD has already been locked for today. An Admin must reopen the day to process this order.' 
        });
      }
    }

    // --- 🔥 THE STRICT ERP ENGINE 🔥 ---
    if (status === 'Completed' && wasNotCompleted) {
      console.log(`\n[ERP ENGINE] Processing Order: ${order.orderNumber} via ${order.paymentMethod}...`);
      let totalCogs = 0; 

      for (const item of order.items) {
        let product = null;
        if (item.productId) {
          product = await Product.findById(item.productId);
        } else {
          const baseName = item.name.replace(/\s*\(.*?\)\s*/g, '').trim();
          product = await Product.findOne({ name: baseName });
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
          const invItem = await Inventory.findById(ing.invId);
          if (invItem) {
            const deductQty = (ing.qty * item.quantity);
            invItem.stockQty -= deductQty;
            await invItem.save();
            
            // --- NEW: WRITE THE SALE TO THE STOCK CARD ---
            await StockCard.create({
              inventoryId: invItem._id,
              itemName: invItem.itemName,
              type: 'Sale', 
              reference: order.orderNumber,
              qtyChange: -deductQty, 
              balanceAfter: invItem.stockQty,
              remarks: `Sold via ${item.name}`
            });

            totalCogs += (invItem.unitCost * deductQty); 
          }
        }
      }

      // --- DYNAMIC PAYMENT ROUTING ---
      let debitAccountCode = '1000';
      let debitAccountName = 'Cash on Hand';
      
      if (order.paymentMethod === 'E-Wallet') { 
        debitAccountCode = '1015';
        debitAccountName = 'E-Wallet'; 
      } else if (order.paymentMethod === 'Bank Transfer') {
        debitAccountCode = '1010';
        debitAccountName = 'Cash in Bank';
      }

      // --- 4. THE PERFECT COMBINED JOURNAL ENTRY ---
      const reference = `${order.orderNumber.replace('#','')}`;
      const lines = [];

      if (order.isComplimentary) {
        // Debit Expense, Credit Inventory (No Cash/Revenue involved)
        lines.push({ accountCode: '6100', accountName: 'Complimentary Expense', debit: totalCogs, credit: 0 });
        lines.push({ accountCode: '1500', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
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

      await JournalEntry.create({ reference, description: `Sales & COGS for Order ${order.orderNumber}`, lines, totalDebit, totalCredit });
      console.log(`[ERP LEDGER] Single AUTO Entry ${reference} created successfully.`);
      
      io.emit('erpUpdated');
    }

    await order.save();
    io.emit('orderUpdated', order);
    res.json({ success: true, order });
    
  } catch (error) {
    console.error("[ERP CRITICAL ERROR] Failed to process order:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- 🚨 SAFE VOID & REFUND ENGINE 🚨 ---
app.post('/api/orders/:id/void', async (req, res) => {
  try {
    const { reason, adminName } = req.body; 
    const order = await Order.findById(req.params.id);
    
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status !== 'Completed') return res.status(400).json({ success: false, error: 'Only completed orders can be financially voided.' });

    // 1. Reverse the Revenue (Give money back)
    let cashAccount = '1000';
    if (order.paymentMethod === 'E-Wallet') cashAccount = '1015';
    if (order.paymentMethod === 'Bank Transfer') cashAccount = '1010';

    const lines = [];
    const grossSalesAmount = order.total + (order.discount || 0) - order.vatAmount;
    
    if (!order.isComplimentary) {
      lines.push({ accountCode: '4000', accountName: 'Sales Revenue', debit: grossSalesAmount, credit: 0 });
      lines.push({ accountCode: '2100', accountName: 'VAT Payable', debit: order.vatAmount || 0, credit: 0 });
      lines.push({ accountCode: cashAccount, accountName: 'Cash on Hand', debit: 0, credit: order.total });
      if (order.discount > 0) lines.push({ accountCode: '4150', accountName: 'Sales Discounts', debit: 0, credit: order.discount });
    } else {
      lines.push({ accountCode: '6100', accountName: 'Complimentary Expense', debit: 0, credit: order.subtotal });
    }

    // 2. Handle Inventory
    let totalCogs = 0;
    for (const item of order.items) {
      let product = await Product.findById(item.productId);
      if (!product) continue;
      
      let recipeToUse = product.baseRecipe || [];
      const sizeMatch = item.name.match(/\(([^)]+)\)$/); 
      if (sizeMatch) {
        const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
        if (sizeObj && sizeObj.recipe?.length > 0) recipeToUse = sizeObj.recipe;
      }

      for (const ing of recipeToUse) {
        const invItem = await Inventory.findById(ing.invId);
        if (invItem) {
          const qtyUsed = ing.qty * item.quantity;
          totalCogs += (invItem.unitCost * qtyUsed);
          
          if (reason === 'Restock') {
            invItem.stockQty += qtyUsed;
            await invItem.save();
            await StockCard.create({
              inventoryId: invItem._id, itemName: invItem.itemName, type: 'Adjustment', 
              reference: `VOID-${order.orderNumber}`, qtyChange: qtyUsed, balanceAfter: invItem.stockQty, remarks: 'Voided - Not Made'
            });
          }
        }
      }
    }

    if (totalCogs > 0) {
      if (reason === 'Restock') {
        lines.push({ accountCode: '1500', accountName: 'Inventory Asset', debit: totalCogs, credit: 0 });
        if (!order.isComplimentary) lines.push({ accountCode: '5000', accountName: 'Cost of Goods Sold', debit: 0, credit: totalCogs });
      } else if (reason === 'Spoilage') {
        lines.push({ accountCode: '5100', accountName: 'Spoilage & Variance Expense', debit: totalCogs, credit: 0 });
        if (!order.isComplimentary) lines.push({ accountCode: '5000', accountName: 'Cost of Goods Sold', debit: 0, credit: totalCogs });
      }
    }

    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

    await JournalEntry.create({ reference: `VOID-${order.orderNumber}`, description: `VOID (${reason}) by ${adminName}`, lines, totalDebit, totalCredit });

    order.status = 'Voided';
    order.voidReason = reason;
    await order.save();
    
    io.emit('erpUpdated');
    io.emit('orderUpdated', order);
    res.json({ success: true, order });

  } catch (error) {
    console.error("Void Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// --- UNLOCK / REOPEN EOD (ADMIN ONLY) ---
app.post('/api/inventory/eod/reopen', async (req, res) => {
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

app.post('/api/orders/archive', async (req, res) => {
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
app.get('/api/inventory', async (req, res) => {
  const items = await Inventory.find().sort({ itemName: 1 });
  res.json({ success: true, items });
});

app.post('/api/inventory', async (req, res) => {
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
app.post('/api/inventory/restock/:id', async (req, res) => {
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

app.put('/api/inventory/:id', async (req, res) => {
  const updatedItem = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ success: true, item: updatedItem });
});

app.delete('/api/inventory/:id', async (req, res) => {
  await Inventory.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Accounting Ledger / Journal Entries
app.get('/api/journal', async (req, res) => {
  const entries = await JournalEntry.find().sort({ date: -1 });
  res.json({ success: true, entries });
});

app.post('/api/journal', async (req, res) => {
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

app.get('/api/finance/balances', async (req, res) => {
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


// --- MIDNIGHT AUTO-ARCHIVE SYSTEM ---
function scheduleMidnightArchive() {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0); // Sets time to exactly 12:00:00 AM tonight
  const msToMidnight = midnight.getTime() - now.getTime();

  // Notice the "async" keyword here! Everything using "await" must be inside this block.
  setTimeout(async () => {
    console.log('🌙 Midnight reached: Auto-closing the day...');
    
    // 1. Archive the Orders
    await Order.updateMany(
      { status: { $in: ['Pending', 'Preparing'] }, isArchived: false }, 
      { $set: { status: 'Cancelled' } }
    );
    await Order.updateMany({ isArchived: false }, { $set: { isArchived: true } });
    
    io.emit('ordersArchived'); // Tell all iPads/phones to reset

    // 2. Take the Midnight Inventory Snapshot
    const allItems = await Inventory.find();
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0); // Normalize to start of day

    for (const item of allItems) {
      await InventoryMovement.create({
        date: todayDate,
        inventoryId: item._id,
        itemName: item.itemName,
        systemEndingBalance: item.stockQty,
      });
    }

    // 3. Schedule it again for tomorrow night!
    scheduleMidnightArchive(); 
  }, msToMidnight);
}

// --- 🛡️ STRICT ORDER VALIDATION ENGINE (VAT-INCLUSIVE) 🛡️ ---
const validateOrderMath = (order) => {
  const TOLERANCE = 0.05; 
  
  if (order.subtotal === undefined || order.total === undefined || order.vatAmount === undefined) {
    return { valid: false, error: "Missing critical financial fields." };
  }

  let expectedGross = 0;
  let expectedDiscount = 0;
  let expectedVat = 0;

  for (const item of order.items) {
    if (!item.price || !item.quantity) return { valid: false, error: "Line item missing price or quantity." };

    const itemBase = item.price * item.quantity;
    expectedGross += itemBase;
    const getsDiscount = item.hasDiscount !== false;

    if (order.isComplimentary) {
      expectedDiscount += itemBase;
    } else if (getsDiscount && order.discountPercent > 0) {
      if (order.isVatExempt || order.discountType === 'SC/PWD') {
        const vatExemptBase = itemBase / 1.12;
        const scDisc = vatExemptBase * (order.discountPercent / 100);
        expectedDiscount += (itemBase - (vatExemptBase - scDisc)); 
      } else {
        const itemDisc = itemBase * (order.discountPercent / 100);
        expectedDiscount += itemDisc;
        const itemNet = itemBase - itemDisc;
        if (!order.isVatExempt) expectedVat += (itemNet - (itemNet / 1.12));
      }
    } else {
      if (!order.isVatExempt) expectedVat += (itemBase - (itemBase / 1.12));
    }
  }

  if (Math.abs(expectedGross - order.subtotal) > TOLERANCE) return { valid: false, error: "Gross mismatch." };
  if (Math.abs(expectedVat - order.vatAmount) > TOLERANCE) return { valid: false, error: "VAT computation invalid." };
  
  const expectedTotal = expectedGross - expectedDiscount;
  if (Math.abs(expectedTotal - order.total) > TOLERANCE) return { valid: false, error: "Total computation invalid." };

  return { valid: true };
};
// Start the timer when the server boots up
scheduleMidnightArchive();

// --- AUTO-CODE GENERATORS ---
const getCategoryPrefix = (categoryName) => {
  const clean = categoryName.toUpperCase().replace(/[^A-Z]/g, '');
  if (clean.length < 3) return (clean + 'XXX').substring(0, 3);
  return clean[0] + clean[1] + clean[clean.length - 1]; // e.g., "DRINKS" -> "DRS"
};

const generateNextSequence = async (Model, prefix, fieldName) => {
  // Finds the highest existing code matching the prefix (e.g., ORD-2026-A0042)
  const lastDoc = await Model.findOne({ [fieldName]: new RegExp(`^${prefix}-A`) })
                             .sort({ [fieldName]: -1 });
  
  let nextNumber = 1;
  if (lastDoc && lastDoc[fieldName]) {
     const match = lastDoc[fieldName].match(/-A(\d+)$/);
     if (match) nextNumber = parseInt(match[1], 10) + 1;
  }
  return `${prefix}-A${nextNumber.toString().padStart(4, '0')}`;
};

// --- USER / ADMIN ROUTES ---

// --- USER / ADMIN ROUTES ---

app.post('/api/users/login', async (req, res) => {
  const { name, password } = req.body;
  const user = await User.findOne({ name });
  
  if (!user) return res.status(401).json({ success: false, message: 'Invalid name or password' });

  // Compare the typed password with the database hash
  const isMatch = await bcrypt.compare(password, user.password);
  
  if (isMatch) {
    // Never send the password hash back to the frontend
    res.json({ success: true, user: { _id: user._id, name: user.name, userCode: user.userCode } });
  } else {
    res.status(401).json({ success: false, message: 'Invalid name or password' });
  }
});

app.get('/api/users', async (req, res) => {
  // .select('-password') hides the hash from the API response
  const users = await User.find().select('-password').sort({ userCode: 1 });
  res.json({ success: true, users });
});

app.post('/api/users', async (req, res) => {
  try {
    const existing = await User.findOne({ name: { $regex: new RegExp(`^${req.body.name.trim()}$`, 'i') } });
    if (existing) return res.status(400).json({ success: false, error: 'User already exists' });

    // Hash the password
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const userCode = await generateNextSequence(User, 'ADN', 'userCode');
    
    const newUser = await User.create({ name: req.body.name, password: hashedPassword, userCode });
    res.json({ success: true, user: { _id: newUser._id, name: newUser.name, userCode: newUser.userCode } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
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

app.delete('/api/users/:id', async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// --- SERVER START ---
const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
});
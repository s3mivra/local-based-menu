import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';

// ... (imports remain the same)

const app = express();
const server = http.createServer(app);

// --- UPDATED CORS CONFIG ---
// --- UPDATED CORS CONFIG ---
const allowedOrigins = [
  "http://localhost:3000",
  "http://192.168.100.2:3000",
  "http://172.19.32.1:3000",       // <-- Add your new local IP here!
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

// --- DATABASE SCHEMAS ---
const CategorySchema = new mongoose.Schema({ name: String });
const Category = mongoose.model('Category', CategorySchema);

// 1. UPDATE THE PRODUCT SCHEMA (Add Recipes)
const ProductSchema = new mongoose.Schema({
  name: String,
  description: String,
  category: String,
  basePrice: Number,
  baseSize: String,
  baseRecipe: [{ invId: String, name: String, qty: Number, cost: Number, unit: String }],
  sizes: [{ 
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
  // 🔴 ADD productId: String RIGHT HERE 🔴
  paymentMethod: { type: String, default: 'Cash' },
  items: [{ productId: String, name: String, price: Number, quantity: Number }],
  subtotal: { type: Number, default: 0 },
  vatRate: { type: Number, default: 0 },
  vatAmount: { type: Number, default: 0 },
  discountPercent: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  isVatExempt: { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false }
}, { timestamps: true });
const Order = mongoose.model('Order', OrderSchema);

// --- NEW ERP SCHEMAS ---
const InventorySchema = new mongoose.Schema({
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

// --- API ROUTES ---

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

app.post('/api/orders', async (req, res) => {
  try {
    const { items, discountPercent = 0, isVatExempt = false, table = 'Takeout' } = req.body;

    // The subtotal is the sum of menu prices (which are VAT INCLUSIVE)
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discount = subtotal * (discountPercent / 100);
    const discountedSubtotal = subtotal - discount;
    
    // --- TRUE VAT INCLUSIVE MATH ---
    const vatRate = isVatExempt ? 0 : 0.12;
    // Net Sales = Total / 1.12
    const netSales = discountedSubtotal / (1 + vatRate);
    // VAT = Total - Net Sales
    const vatAmount = discountedSubtotal - netSales; 
    const total = discountedSubtotal; // The total cash the customer hands you

    const orderCount = await Order.countDocuments();
    const orderNumber = `#${(orderCount + 1).toString().padStart(4, '0')}`;

    const newOrder = await Order.create({
      orderNumber, table, items, subtotal, vatRate, vatAmount, discountPercent, discount, total, isVatExempt
    });

    io.emit('newOrder', newOrder);
    res.json({ success: true, order: newOrder });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Order failed' });
  }
});

// 2. AUTO-LEDGER & INVENTORY DEDUCTION ROUTE
// 2. AUTO-LEDGER & INVENTORY DEDUCTION ROUTE
app.put('/api/orders/:id', async (req, res) => {
  try {
    const { status, discountPercent, isVatExempt, paymentMethod } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false });

    const wasNotCompleted = order.status !== 'Completed';
    if (status) order.status = status;
    if (paymentMethod) order.paymentMethod = paymentMethod;

    if (discountPercent !== undefined || isVatExempt !== undefined) {
      if (discountPercent !== undefined) order.discountPercent = discountPercent;
      if (isVatExempt !== undefined) order.isVatExempt = isVatExempt;

      order.discount = order.subtotal * ((order.discountPercent || 0) / 100);
      const discountedSubtotal = order.subtotal - order.discount;
      
      order.vatRate = order.isVatExempt ? 0 : 0.12;
      const netSales = discountedSubtotal / (1 + order.vatRate);
      order.vatAmount = discountedSubtotal - netSales;
      order.total = discountedSubtotal;
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
            totalCogs += (invItem.unitCost * deductQty); 
          }
        }
      }

      // --- DYNAMIC PAYMENT ROUTING ---
      let debitAccountCode = '1000';
      let debitAccountName = 'Cash on Hand';
      
      if (order.paymentMethod === 'E-Wallet') { // <-- CHANGED HERE
        debitAccountCode = '1015';
        debitAccountName = 'E-Wallet';          // <-- CHANGED HERE
      } else if (order.paymentMethod === 'Bank Transfer') {
        debitAccountCode = '1010';
        debitAccountName = 'Cash in Bank';
      }

      // --- 4. THE PERFECT COMBINED JOURNAL ENTRY ---
      const reference = `AUTO-${order.orderNumber.replace('#','')}`;
      const lines = [];

      // A. Money In (Debit specifically to Cash, GCash, or Bank)
      lines.push({ accountCode: debitAccountCode, accountName: debitAccountName, debit: order.total, credit: 0 });

      // B. Revenue Recognition (Credit Sales)
      const netSalesAmount = order.total - order.vatAmount;
      lines.push({ accountCode: '4000', accountName: 'Sales Revenue', debit: 0, credit: netSalesAmount });
      
      // C. VAT Recognition (ONLY if Vatable)
      if (order.vatAmount > 0) {
        lines.push({ accountCode: '2100', accountName: 'VAT Payable', debit: 0, credit: order.vatAmount });
      }

      // D. Inventory Usage (Debit COGS, Credit Inventory)
      if (totalCogs > 0) {
        lines.push({ accountCode: '5000', accountName: 'Cost of Goods Sold', debit: totalCogs, credit: 0 });
        lines.push({ accountCode: '1500', accountName: 'Inventory Asset', debit: 0, credit: totalCogs });
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
    const newItem = await Inventory.create(req.body);
    
    // --- NEW: AUTO-JOURNAL FOR PURCHASING INVENTORY ---
    const totalCost = newItem.stockQty * newItem.unitCost;
    if (totalCost > 0) {
      const entryCount = await JournalEntry.countDocuments();
      const reference = `PURCH-${(entryCount + 1).toString().padStart(4, '0')}`;
      const lines = [
        { accountCode: '1500', accountName: 'Inventory Asset', debit: totalCost, credit: 0 },
        { accountCode: '1000', accountName: 'Cash on Hand', debit: 0, credit: totalCost }
      ];
      await JournalEntry.create({ 
        reference, 
        description: `Purchased ${newItem.stockQty}${newItem.unit} of ${newItem.itemName}`, 
        lines, 
        totalDebit: totalCost, 
        totalCredit: totalCost 
      });
    }

    io.emit('erpUpdated'); // Tell the UI to instantly refresh!
    res.json({ success: true, item: newItem });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    const reference = `JE-${(entryCount + 1).toString().padStart(4, '0')}`;

    const newEntry = await JournalEntry.create({
      reference, description, lines, totalDebit, totalCredit
    });

    res.json({ success: true, entry: newEntry });
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

  setTimeout(async () => {
    console.log('🌙 Midnight reached: Auto-closing the day...');
    
    // Run the exact same logic as the manual archive button
    await Order.updateMany(
      { status: { $in: ['Pending', 'Preparing'] }, isArchived: false }, 
      { $set: { status: 'Cancelled' } }
    );
    await Order.updateMany({ isArchived: false }, { $set: { isArchived: true } });
    
    io.emit('ordersArchived'); // Tell all iPads/phones to reset

    // Schedule it again for tomorrow night!
    scheduleMidnightArchive(); 
  }, msToMidnight);
}

// Start the timer when the server boots up
scheduleMidnightArchive();

// --- SERVER START ---
const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
});
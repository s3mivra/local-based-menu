import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';

const app = express();
const server = http.createServer(app);

// Keep your body parser limits high because WebP strings can be large!
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
});

// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- DATABASE SCHEMAS ---
const CategorySchema = new mongoose.Schema({ name: String });
const Category = mongoose.model('Category', CategorySchema);

const ProductSchema = new mongoose.Schema({
  name: String,
  description: String,
  category: String,
  basePrice: Number,
  baseSize: String,
  sizes: [{ name: String, price: Number }],
  image: String
});
const Product = mongoose.model('Product', ProductSchema);

const OrderSchema = new mongoose.Schema({
  orderNumber: String,
  table: String,
  items: Array,
  subtotal: Number,
  vatRate: Number,
  vatAmount: Number,
  discountPercent: Number,
  discount: Number,
  total: Number,
  isVatExempt: Boolean,
  status: { type: String, default: 'Pending' },
  isArchived: { type: Boolean, default: false }
}, { timestamps: true });
const Order = mongoose.model('Order', OrderSchema);

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

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discount = subtotal * (discountPercent / 100);
    const discountedSubtotal = subtotal - discount;
    const vatRate = isVatExempt ? 0 : 0.12;
    const vatAmount = discountedSubtotal * vatRate;
    const total = discountedSubtotal + vatAmount;

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

app.put('/api/orders/:id', async (req, res) => {
  const { status, discountPercent, isVatExempt } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ success: false });

  if (status) order.status = status;

  if (discountPercent !== undefined || isVatExempt !== undefined) {
    if (discountPercent !== undefined) order.discountPercent = discountPercent;
    if (isVatExempt !== undefined) order.isVatExempt = isVatExempt;

    order.discount = order.subtotal * (order.discountPercent / 100);
    const discountedSubtotal = order.subtotal - order.discount;
    order.vatRate = order.isVatExempt ? 0 : 0.12;
    order.vatAmount = discountedSubtotal * order.vatRate;
    order.total = discountedSubtotal + order.vatAmount;
  }

  await order.save();
  io.emit('orderUpdated', order);
  res.json({ success: true, order });
});

app.post('/api/orders/archive', async (req, res) => {
  await Order.updateMany({ status: 'Completed', isArchived: false }, { $set: { isArchived: true } });
  await Order.updateMany(
    { status: { $in: ['Pending', 'Preparing'] }, isArchived: false },
    { $set: { status: 'Cancelled', isArchived: true } }
  );

  io.emit('ordersArchived');
  res.json({ success: true });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
  console.log(`📡 Device Connected: ${socket.id}`);

  socket.on('updateOrderStatus', async ({ orderId, status }) => {
    const order = await Order.findByIdAndUpdate(orderId, { status }, { new: true });
    if (order) io.emit('orderUpdated', order);
  });

  socket.on('disconnect', () => {
    console.log(`🛑 Device Disconnected: ${socket.id}`);
  });
});

// --- SERVER START ---
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
});
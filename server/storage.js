import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'data.json');

// --- FILE SYSTEM HELPERS ---

// Read the JSON file (or create it if it doesn't exist)
const readData = () => {
  if (!fs.existsSync(DATA_FILE)) {
    // Default starting data if the file is brand new
    const initialData = {
      orders: [],
      categories: [
        { _id: 'c1', name: 'Mains' },
        { _id: 'c2', name: 'Sides' },
        { _id: 'c3', name: 'Drinks' }
      ],
      products: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  
  const rawData = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(rawData);
};

// Write data back to the JSON file
const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// --- STORAGE ENGINE ---

export const storage = {
  // --- ORDERS ---
  getOrders() {
    return readData().orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },
  getOrderById(id) {
    return readData().orders.find(o => o._id === id);
  },

  getArchivedOrders() {
    const data = readData();
    return (data.archives || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },
  addOrder(order) {
    const data = readData();
    order._id = Date.now().toString();
    order.createdAt = new Date().toISOString();
    data.orders.push(order);
    writeData(data);
    return order;
  },
  updateOrder(id, updates) {
    const data = readData();
    const index = data.orders.findIndex(o => o._id === id);
    if (index !== -1) {
      data.orders[index] = { ...data.orders[index], ...updates, updatedAt: new Date().toISOString() };
      writeData(data);
      return data.orders[index];
    }
    return null;
  },

  // --- ARCHIVING ---
  archiveOrders() {
    const data = readData();
    if (!data.archives) data.archives = []; // Create archives array if missing

    const activeOrders = [];
    const archivedOrders = [];

    // Separate completed/cancelled orders from pending/preparing ones
    data.orders.forEach(o => {
      if (o.status === 'Completed' || o.status === 'Cancelled') {
        archivedOrders.push(o);
      } else {
        activeOrders.push(o);
      }
    });

    data.orders = activeOrders;
    data.archives = [...data.archives, ...archivedOrders];
    writeData(data);
    
    return { archivedCount: archivedOrders.length };
  },

  // --- PRODUCTS ---
  getProducts() {
    return readData().products;
  },
  addProduct(product) {
    const data = readData();
    product._id = Date.now().toString();
    data.products.push(product);
    writeData(data);
    return product;
  },
  updateProduct(id, updates) {
    const data = readData();
    const index = data.products.findIndex(p => p._id === id);
    if (index !== -1) {
      data.products[index] = { ...data.products[index], ...updates };
      writeData(data);
      return data.products[index];
    }
    return null;
  },
  deleteProduct(id) {
    const data = readData();
    const initialLength = data.products.length;
    data.products = data.products.filter(p => p._id !== id);
    if (data.products.length !== initialLength) {
      writeData(data);
      return true;
    }
    return false;
  },

  // --- CATEGORIES ---
  getCategories() {
    return readData().categories;
  },
  addCategory(category) {
    const data = readData();
    category._id = Date.now().toString();
    data.categories.push(category);
    writeData(data); // <-- This saves it permanently to the file!
    return category;
  },
  deleteCategory(id) {
    const data = readData();
    const initialLength = data.categories.length;
    data.categories = data.categories.filter(c => c._id !== id);
    if (data.categories.length !== initialLength) {
      writeData(data); // <-- Saves the deletion permanently
      return true;
    }
    return false;
  }
};
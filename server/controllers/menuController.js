import { storage } from '../storage.js';

// --- PRODUCTS ---
export const getProducts = (req, res) => res.json({ success: true, products: storage.getProducts() });

export const addProduct = (req, res) => {
  const product = storage.addProduct(req.body);
  req.io.emit('menuUpdated'); 
  res.status(201).json({ success: true, product });
};

export const updateProduct = (req, res) => {
  const product = storage.updateProduct(req.params.id, req.body);
  if (!product) return res.status(404).json({ success: false, message: 'Not found' });
  req.io.emit('menuUpdated');
  res.json({ success: true, product });
};

export const deleteProduct = (req, res) => {
  if (!storage.deleteProduct(req.params.id)) return res.status(404).json({ success: false });
  req.io.emit('menuUpdated');
  res.json({ success: true });
};

// --- CATEGORIES ---
export const getCategories = (req, res) => res.json({ success: true, categories: storage.getCategories() });

export const addCategory = (req, res) => {
  const category = storage.addCategory(req.body);
  req.io.emit('menuUpdated');
  res.status(201).json({ success: true, category });
};

export const deleteCategory = (req, res) => {
  if (!storage.deleteCategory(req.params.id)) return res.status(404).json({ success: false });
  req.io.emit('menuUpdated');
  res.json({ success: true });
};
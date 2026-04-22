import { storage } from '../storage.js';

export const getProducts = (req, res) => {
  try {
    const products = storage.getProducts();
    res.status(200).json({ success: true, products });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const addProduct = (req, res) => {
  try {
    const product = storage.addProduct(req.body);
    // Broadcast to clients so the menu updates instantly without a refresh
    req.io.emit('menuUpdated'); 
    res.status(201).json({ success: true, product });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateProduct = (req, res) => {
  try {
    const product = storage.updateProduct(req.params.id, req.body);
    if (!product) return res.status(404).json({ success: false, message: 'Not found' });
    
    req.io.emit('menuUpdated');
    res.status(200).json({ success: true, product });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteProduct = (req, res) => {
  try {
    const success = storage.deleteProduct(req.params.id);
    if (!success) return res.status(404).json({ success: false, message: 'Not found' });

    req.io.emit('menuUpdated');
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
import express from 'express';
import { 
  getProducts, addProduct, updateProduct, deleteProduct,
  getCategories, addCategory, deleteCategory 
} from '../controllers/menuController.js';

const router = express.Router();

// Product endpoints
router.get('/products', getProducts);
router.post('/products', addProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);

// Category endpoints
router.get('/categories', getCategories);
router.post('/categories', addCategory);
router.delete('/categories/:id', deleteCategory);

export default router;
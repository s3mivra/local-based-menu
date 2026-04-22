import express from 'express';
import { createOrder, getOrders, updateOrderStatus, archiveOrders, getArchivedOrders } from '../controllers/orderController.js';

const router = express.Router();

router.get('/', getOrders);
router.get('/archives', getArchivedOrders); // <-- NEW ROUTE
router.post('/', createOrder);
router.post('/archive', archiveOrders);
router.put('/:id', updateOrderStatus);

export default router;
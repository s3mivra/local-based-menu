import { storage } from '../storage.js';

const generateOrderNumber = () => `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

export const createOrder = (req, res) => {
  try {
    const { items, isVatExempt, discount = 0 } = req.body;

    if (!items || items.length === 0) {
      throw new Error("Cart is empty");
    }

    let subtotal = 0;
    
    const validatedItems = items.map((item) => {
      const product = storage.getProducts().find(p => p._id === item.productId);
      if (!product) throw new Error(`Product ${item.name} not found`);
      
      subtotal += item.price * item.quantity;
      
      return {
        productId: product._id,
        name: item.name,      
        price: item.price,    
        quantity: item.quantity
      };
    });

    const vatRate = isVatExempt ? 0 : 0.12;
    const vatAmount = subtotal * vatRate;
    const total = subtotal + vatAmount - discount;

    const newOrder = storage.addOrder({
      orderNumber: generateOrderNumber(),
      items: validatedItems,
      subtotal,
      vatRate,
      vatAmount,
      discountPercent: 0, // NEW: Track percentage explicitly
      discount,           // This is the flat dollar amount
      total,
      status: 'Pending'
    });

    req.io.emit('newOrder', newOrder);

    res.status(201).json({ success: true, order: newOrder });
  } catch (error) {
    console.error("Order Creation Error:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getOrders = (req, res) => {
  try {
    const orders = storage.getOrders();
    res.status(200).json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateOrderStatus = (req, res) => {
  try {
    const { status, isVatExempt, discountPercent } = req.body;
    const orderId = req.params.id;

    const existingOrder = storage.getOrderById(orderId);
    if (!existingOrder) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    let updates = {};
    if (status) updates.status = status;

    // --- NEW: RECALCULATION ENGINE ---
    let currentVatRate = existingOrder.vatRate;
    let currentDiscountAmount = existingOrder.discount || 0;
    let currentDiscountPercent = existingOrder.discountPercent || 0;
    let needsRecalculation = false;

    // 1. Check if Admin toggled VAT
    if (isVatExempt !== undefined) {
      currentVatRate = isVatExempt ? 0 : 0.12;
      needsRecalculation = true;
    }

    // 2. Check if Admin applied a Discount %
    if (discountPercent !== undefined) {
      currentDiscountPercent = Number(discountPercent);
      // Calculate the discount dollar amount based on the subtotal
      currentDiscountAmount = existingOrder.subtotal * (currentDiscountPercent / 100);
      updates.discountPercent = currentDiscountPercent;
      updates.discount = currentDiscountAmount;
      needsRecalculation = true;
    }

    // 3. Apply the final math
    if (needsRecalculation) {
      const vatAmount = existingOrder.subtotal * currentVatRate;
      const total = existingOrder.subtotal + vatAmount - currentDiscountAmount;

      updates.vatRate = currentVatRate;
      updates.vatAmount = vatAmount;
      updates.total = total > 0 ? total : 0; // Prevent negative totals
    }

    const updatedOrder = storage.updateOrder(orderId, updates);
    req.io.emit('orderUpdated', updatedOrder);

    res.status(200).json({ success: true, order: updatedOrder });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const archiveOrders = (req, res) => {
  try {
    const result = storage.archiveOrders();
    // Tell all connected dashboards to refresh their active orders
    req.io.emit('ordersArchived'); 
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getArchivedOrders = (req, res) => {
  try {
    const archives = storage.getArchivedOrders();
    res.status(200).json({ success: true, archives });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import orderRoutes from './routes/orderRoutes.js';
import menuRoutes from './routes/menuRoutes.js'; // 1. IMPORT THE MENU ROUTES
import { storage } from './storage.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.use(cors());
app.use(express.json());

// Inject socket.io into every request so controllers can use it
app.use((req, res, next) => {
  req.io = io;
  next();
});

// 2. THIS IS THE FIX: TELL EXPRESS TO USE THE ROUTES
app.use('/api/orders', orderRoutes);
app.use('/api', menuRoutes); 

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('updateOrderStatus', ({ orderId, status }) => {
    try {
      const order = storage.updateOrder(orderId, { status });
      if (order) io.emit('orderUpdated', { orderId, status });
    } catch (error) {
      console.error('Error updating order status:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
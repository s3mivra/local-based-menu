# ☕ Semivra Libellus: Enterprise Cafe POS & ERP

A commercial-grade, local-network (and cloud-ready) QR code digital menu system with real-time order synchronization, automated double-entry accounting, and smart inventory management. Designed with a minimalist Black (#111111) and Yellow (#FFC107) UI.

## 🚀 Version History

### **v0.2 - The ERP & Management Upgrade (Current)**
Transformed the basic POS into a fully automated business management suite.
* **Dual-Mode UI:** Click the brand name to toggle between "SEMIVRA LIBELLUS" (Front-of-house operations) and "SEMIVRA NEGOTIUM" (Back-of-house management).
* **Double-Entry Accounting:** Automated General Ledger. Every order generates a unified entry for Cash/E-Wallet, Sales Revenue, VAT Payable, and Cost of Goods Sold (COGS).
* **Smart Inventory (Weighted Average Cost):** Restocking calculates the moving average cost per gram/ml for precise profit tracking. Prevents duplicate entries.
* **BOM (Bill of Materials) Engine:** Link raw ingredients to menu items. Estimates exact remaining servings based on live stock and calculates profit margins.
* **Advanced Analytics:** Real-time dashboard showing daily revenue trends, best-selling items, and low-stock/overstock alerts.
* **Exporting:** One-click CSV exports for Inventory, General Ledger audits, and Daily Sales trends.
* **PWA Mobile UX:** Integrated Screen Wake Lock API to keep customer screens active, and Web Push Notifications for background order alerts.

### **v0.1 - Core POS & Kitchen Display (Legacy)**
* **QR Digital Menu:** Generate unique table sessions for mobile ordering.
* **Real-Time Kitchen Display:** WebSockets instantly push orders to the kitchen screen.
* **Menu Builder:** Create categories, items, and dynamic sizes with automatic WebP image compression.

## 🛠 Tech Stack
* **Frontend:** React 18, Vite, Tailwind CSS
* **Backend:** Node.js, Express.js
* **Database:** MongoDB Atlas (Mongoose)
* **Real-Time Engine:** Socket.io
* **PWA Features:** Service Workers (Push API), Navigator Wake Lock API

---

## ⚙️ Setup Instructions

### Prerequisites
* Node.js (v18 or higher)
* Static IP address for the server machine (If deploying locally)
* MongoDB Atlas Cluster URI

### 1. Configure Environment
Create a `.env` file in the `server` directory:

```env
PORT=5002
MONGO_URI=your_mongodb_connection_string_here
FRONTEND_URL=http://YOUR_LOCAL_IP:3000
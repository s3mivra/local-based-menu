# QR Digital Menu System

A commercial-grade, local-network QR code digital menu system with real-time order synchronization, server-side price validation, and a minimalist Black/Yellow design.

## Features

- **Server-side Price Validation**: All calculations happen on the backend to prevent frontend manipulation
- **Real-time Socket.io**: Instant order updates between customer menu and kitchen dashboard
- **VAT Support**: Configurable VAT rate (default 12%) with VAT-exempt option
- **Local Network Deployment**: Optimized for restaurant WiFi environments
- **Minimalist Design**: Black (#111111) and Yellow (#FFC107) color scheme with Tailwind CSS
- **Mobile-First**: Responsive design optimized for customer phones
- **In-Memory Storage**: No database required - orders stored temporarily in memory

## Tech Stack

**Backend:**
- Node.js + Express
- In-Memory Storage (no database required)
- Socket.io (real-time communication)
- CORS enabled for local network access

**Frontend:**
- React 18 + Vite
- React Router
- Socket.io-client
- Tailwind CSS

## Setup Instructions

### Prerequisites

- Node.js (v18 or higher)
- Static IP address for the server machine

### 1. Configure Environment

Edit `.env` in the root directory:

```env
PORT=5000
JWT_SECRET=your_super_secure_jwt_secret_key_here
FRONTEND_URL=http://YOUR_LOCAL_IP:3000
DEFAULT_VAT_RATE=0.12
```

**Important**: Replace `YOUR_LOCAL_IP` with your actual local IPv4 address (e.g., `192.168.1.100`).

### 2. Install Backend Dependencies

```bash
cd server
npm install
```

### 3. Install Frontend Dependencies

```bash
cd ../client
npm install
```

### 4. Update Socket URLs in Frontend

Edit the following files to use your local IP instead of `192.168.1.100`:

- `client/src/pages/CustomerMenu.jsx` (line 4)
- `client/src/pages/AdminDashboard.jsx` (line 3)

Replace `http://192.168.1.100:5000` with `http://YOUR_LOCAL_IP:5000`.

**Note**: Products are pre-loaded in `server/storage.js`. You can edit this file to customize your menu items.

### 5. Start the Backend

```bash
cd server
npm start
# Or for development with auto-reload
npm run dev
```

The backend will run on `http://0.0.0.0:5000`

**Note**: Orders are stored in memory and will be lost when the server restarts.

### 6. Start the Frontend

In a new terminal:
```bash
cd client
npm run dev
```

The frontend will run on `http://0.0.0.0:3000`

## Local Network Deployment

### 1. Assign Static IP

Configure your server machine with a static IP (e.g., `192.168.1.100`) in your router settings.

### 2. Configure Firewall

Open ports `3000` (Frontend) and `5000` (Backend) on Windows Firewall:

```powershell
# Allow port 3000
New-NetFirewallRule -DisplayName "QR Menu Frontend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow

# Allow port 5000
New-NetFirewallRule -DisplayName "QR Menu Backend" -Direction Inbound -LocalPort 5000 -Protocol TCP -Action Allow
```

### 3. Generate QR Codes

Generate QR codes pointing to: `http://YOUR_LOCAL_IP:3000/`

**Important**: Do NOT use `localhost` in QR codes - customer phones need to reach your server on the local network.

Use any QR code generator (e.g., qr-code-generator.com) and print the codes for table placement.

### 4. Access Points

- **Customer Menu**: `http://YOUR_LOCAL_IP:3000/`
- **Admin Dashboard**: `http://YOUR_LOCAL_IP:3000/admin`

## Usage

### For Customers

1. Scan QR code at table
2. Browse menu items
3. Add items to cart
4. Adjust quantities or remove items
5. Toggle VAT exemption if applicable
6. Confirm order
7. View order status in real-time

### For Kitchen Staff

1. Access admin dashboard at `/admin`
2. View incoming orders in real-time
3. Click "Prep" to start preparing
4. Click "Complete" when ready
5. Click "Cancel" if needed
6. Status updates sync instantly to customer phones

## Security Notes

- All price calculations are server-side to prevent manipulation
- JWT_SECRET should be changed in production
- Consider adding authentication for admin dashboard
- Restrict CORS origin in production to your local IP range

## Troubleshooting

**Orders not appearing in admin dashboard:**
- Check that both frontend and backend are using the same local IP
- Check browser console for Socket.io connection errors

**Customers cannot access menu:**
- Ensure server binds to `0.0.0.0` (not `localhost`)
- Verify firewall rules allow ports 3000 and 5000
- Confirm QR code uses the correct local IP address

**Socket.io connection failures:**
- Check that backend is running
- Verify CORS settings in `server/server.js`
- Ensure both devices are on the same WiFi network

## Project Structure

```
semivra libellus/
├── .env
├── README.md
├── server/
│   ├── package.json
│   ├── server.js
│   ├── storage.js
│   ├── controllers/
│   │   └── orderController.js
│   └── routes/
│       └── orderRoutes.js
└── client/
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        └── pages/
            ├── CustomerMenu.jsx
            └── AdminDashboard.jsx
```

## License

This is a proprietary system for commercial use.

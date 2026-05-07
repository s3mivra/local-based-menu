import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';

// 1. PROPER LAZY LOADING: This is the secret to making the app load instantly!
const CustomerMenu = lazy(() => import('./pages/CustomerMenu'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const SuperAdminPanel = lazy(() => import('./pages/SuperAdminPanel'));
const QRCodeComponent = lazy(() => import('./components/QRCode')); // Restored this!

function App() {
  return (
    <Router>
      <Suspense fallback={
        <div className="min-h-screen bg-[#121212] flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-4 border-[#EAB308] border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-[#EAB308] font-bold tracking-widest uppercase">Loading System...</p>
        </div>
      }>
        <Routes>
          {/* Default URL redirects to the Cashier POS */}
          <Route path="/" element={<Navigate to="/admin" replace />} />
          
          {/* THE FIX: This is the specific route the QR Codes look for! */}
          <Route path="/menu/:table" element={<CustomerMenu />} />
          
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/admin-panel" element={<SuperAdminPanel />} />
          <Route path="/generate-qr" element={<QRCodeComponent />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
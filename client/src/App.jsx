import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import CustomerMenu from './pages/CustomerMenu';
import AdminDashboard from './pages/AdminDashboard';
import SuperAdminPanel from './pages/SuperAdminPanel';

function App() {
  return (
    <Router>
      <Suspense fallback={<div>Loading POS...</div>}>
      <Routes>
        <Route path="/" element={<CustomerMenu />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/admin-panel" element={<SuperAdminPanel />} />
      </Routes>
      </Suspense>
    </Router>
  );
}

export default App;

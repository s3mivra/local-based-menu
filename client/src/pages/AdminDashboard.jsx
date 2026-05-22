import React, { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, TrendingDown, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, AlertTriangle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Check, Clock, Coffee, Minus, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Building2, Printer, ArrowUp, ArrowDown, Gift, XCircle, Zap, BarChart2, CreditCard, Banknote, Smartphone, Truck, Bell, ShieldCheck } from 'lucide-react';
import jsPDF from 'jspdf';
import QRCode from 'react-qr-code';
import autoTable from 'jspdf-autotable';
const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.100.2:5002';
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || 'http://192.168.100.2:3000';

const COMP_REASON_LABELS = {
  VIP_CUSTOMER:         'VIP Customer',
  CUSTOMER_RECOVERY:    'Customer Recovery',
  FOOD_QUALITY_ISSUE:   'Food Quality Issue',
  SERVICE_DELAY:        'Service Delay',
  EMPLOYEE_MEAL:        'Employee Meal',
  OWNER_APPROVAL:       'Owner Approval',
  MARKETING_PROMOTION:  'Marketing Promotion',
  INFLUENCER_PROMO:     'Influencer Promo',
  SYSTEM_ERROR:         'System Error',
  TRAINING_ORDER:       'Training Order',
  LOYALTY_REWARD:       'Loyalty Reward',
  EVENT_SPONSORSHIP:    'Event Sponsorship',
};

const socket = io(API_URL, {
  transports: ['websocket'],
  upgrade: false
});

// New order arrives at kitchen — single sharp ding
const playKitchenDing = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.log('Audio ding blocked');
  }
};

// Order marked Ready — two-tone ascending chime (customer call)
const playReadyChime = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const playNote = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
      gain.gain.setValueAtTime(0.7, ctx.currentTime + startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
      osc.start(ctx.currentTime + startTime);
      osc.stop(ctx.currentTime + startTime + duration);
    };
    playNote(660, 0,    0.25);
    playNote(880, 0.28, 0.35);
    playNote(1100, 0.56, 0.5);
  } catch (e) {
    console.log('Audio chime blocked');
  }
};

function MidnightCountdown() {
  const calc = () => {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const d = midnight - now;
    const h = Math.floor(d / 3600000).toString().padStart(2, '0');
    const m = Math.floor((d % 3600000) / 60000).toString().padStart(2, '0');
    const s = Math.floor((d % 60000) / 1000).toString().padStart(2, '0');
    return `${h}h ${m}m ${s}s`;
  };
  const [t, setT] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="text-brand font-black text-xs">{t}</span>;
}

const BIZ_NAME = (import.meta.env.VITE_BUSINESS_NAME || 'Kasa Lokal').toUpperCase();

export default function AdminDashboard() {
  const [paymentSelections, setPaymentSelections] = useState({});

  const [activeTab, setActiveTab] = useState('orders');
  const [navMode, setNavMode] = useState('libellus'); // 'libellus' (Operations) or 'negotium' (Management)
  const [orderFilter, setOrderFilter] = useState('All'); 
  const [departmentFilter, setDepartmentFilter] = useState('All'); // 'All', 'Kitchen', 'Bar'
  const [expandedDays, setExpandedDays] = useState({}); 
  const [expandedOrderLists, setExpandedOrderLists] = useState({});
  
  const [showQR, setShowQR] = useState(false);
  const [orders, setOrders] = useState([]);
  const [archivedOrders, setArchivedOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [discountInputs, setDiscountInputs] = useState({});
  
  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState({ 
    name: '', description: '', category: '', basePrice: '', baseSize: '', sizes: [], image: '', 
    baseRecipe: [], addOns: []
  });
  const [catForm, setCatForm] = useState({ name: '', department: 'Kitchen' });
  const [editingCategory, setEditingCategory] = useState(null);

  const [autoTableId, setAutoTableId] = useState('');

  const [inventory, setInventory] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [invForm, setInvForm] = useState({ itemName: '', packQty: '', unitPerPack: '', unit: '', costPerPack: '' });

  const [physicalCounts, setPhysicalCounts] = useState({});
  const [restockData, setRestockData] = useState({ addedStock: '', totalCost: '' });
  const [activeInventoryItem, setActiveInventoryItem] = useState(null); // For the restock modal

  const [stockHistory, setStockHistory] = useState([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyItemName, setHistoryItemName] = useState('');

  const [cashOnHand, setCashOnHand] = useState(0);
  // --- NEW LOGIN STATES ---
  const [loginForm, setLoginForm] = useState({ name: '', password: '' });

  // Add this near your other state variables
  const [invSubTab, setInvSubTab] = useState('live'); // 'live' or 'eod'
  const [varianceReasons, setVarianceReasons] = useState({});
  const [varianceNoteMode, setVarianceNoteMode] = useState({});
  const [historyPage, setHistoryPage] = useState(1);
  const HIST_PAGE_SIZE = 15;
  const [auditFilter, setAuditFilter] = useState('today');

  // --- EOD STATES ---
  const [eodStatus, setEodStatus] = useState('OPEN');
  const [eodLockedAt, setEodLockedAt] = useState(null);
  const [dailyMovement, setDailyMovement] = useState({});

  const [discountList, setDiscountList] = useState([]);
  const [newDiscount, setNewDiscount] = useState({ name: '', percentage: '' });

  const [discounts, setDiscounts] = useState([]);
  const [discountForm, setDiscountForm] = useState({ name: '', percentage: '' });

  // --- INLINE PRICING STATES ---
  const [editPriceId, setEditPriceId] = useState(null);
  const [editPriceVal, setEditPriceVal] = useState('');

  // --- ITEM-LEVEL DISCOUNT TRACKING ---
  const [discountedItems, setDiscountedItems] = useState({});
  const [scpwdOpen, setScpwdOpen] = useState({});
  const [collapsedOrders, setCollapsedOrders] = useState({}); // true = collapsed
  const [depositAmount, setDepositAmount] = useState('');
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState('');

  // Restore active admin from JWT on page refresh (no separate kasa_admin key needed)
  const [activeAdmin, setActiveAdmin] = useState(() => {
    const token = localStorage.getItem('semivra_token');
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      // Reject expired tokens immediately
      if (payload.exp && payload.exp * 1000 < Date.now()) { localStorage.removeItem('semivra_token'); return null; }
      return { _id: payload._id, name: payload.name, role: payload.role, userCode: payload.userCode };
    } catch { return null; }
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const token = localStorage.getItem('semivra_token');
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return !payload.exp || payload.exp * 1000 > Date.now();
    } catch { return false; }
  });

  // --- SHIFT STATES ---
  const [startingCash, setStartingCash] = useState(() => localStorage.getItem('semivra_last_actual_cash') || '');
  const [shiftEndModal, setShiftEndModal] = useState(false);
  const [shiftReconcile, setShiftReconcile] = useState({ actualCash: '', result: null });
  const [shiftEndLoading, setShiftEndLoading] = useState(false);

  const [compSelections, setCompSelections] = useState({});
  const [compOverride, setCompOverride] = useState({});
  const [compReasonTypes, setCompReasonTypes] = useState({});
  const [compReasonNotes, setCompReasonNotes] = useState({});
  const [shiftFilter, setShiftFilter] = useState('All');
  const [dashDrawerOpen, setDashDrawerOpen] = useState(false);
  const [updatingOrders, setUpdatingOrders] = useState({}); // orderId → true while PUT in flight
  const [cashTendered, setCashTendered] = useState({}); // orderId → amount string
  const [loginError, setLoginError] = useState('');
  const [users, setUsers] = useState([]); // Stores the employee list

  const [globalAddOns, setGlobalAddOns] = useState([]);
  const [addOnForm, setAddOnForm] = useState({ name: '', price: '', category: 'Extras' });

  // --- MANUAL POS STATES ---
  const [isPosOpen, setIsPosOpen] = useState(false);
  const [posCart, setPosCart] = useState([]);
  const [posCategory, setPosCategory] = useState('All');
  const [posPage, setPosPage] = useState(1);
  const POS_PER_PAGE = 8;
  const [posCustomerName, setPosCustomerName] = useState('');
  const [posTable, setPosTable] = useState('Takeout'); // Takeout, Grab Delivery, Foodpanda
  const [posPayment, setPosPayment] = useState('Cash');
  const [posSelectedProduct, setPosSelectedProduct] = useState(null);
  const [posActiveSize, setPosActiveSize] = useState(null);
  const [posActiveAddOns, setPosActiveAddOns] = useState([]);

  // --- FULLSCREEN LOGIC ---
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);

  // --- PAGINATION STATE ---
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8; // You can change this number! 12 fits nicely on a tablet screen.

  // NEW: Inventory Pagination
  const [invPage, setInvPage] = useState(1);
  const invItemsPerPage = 12; // List items are small, we can fit 15

  // NEW: Orders Pagination
  const [ordersPage, setOrdersPage] = useState(1);
  const ordersItemsPerPage = 8; // Order cards are tall, 8 is perfect

  // NEW: Accounting Pagination
  const [accountingPage, setAccountingPage] = useState(1);
  const accountingItemsPerPage = 8; // Journal entries are tall, 10 is good

  // NEW: Pricing Pagination
  const [pricingPage, setPricingPage] = useState(1);
  const pricingItemsPerPage = 12; // Table rows are small, 15 fits perfectly

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', import.meta.env.VITE_THEME || 'default');
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };
  // --- JWT API HELPER ---
  // Use this wrapper for ALL fetch requests to the backend API.
  // It automatically attaches the JWT token from memory.
  // Add 'async' right here 👇
  const apiFetch = async (endpoint, options = {}) => {
    if (!options.headers) options.headers = {};
    const token = localStorage.getItem('semivra_token');
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // FIX 1: Auto-inject JSON header so Discounts and VAT are read by the backend
    if (options.body && typeof options.body === 'string' && !options.headers['Content-Type']) {
      options.headers['Content-Type'] = 'application/json';
    }
    
    // FIX 2: Strip out API_URL if it was accidentally passed in to prevent double URLs
    const cleanEndpoint = endpoint.replace(API_URL, '');
    const response = await fetch(`${API_URL}${cleanEndpoint}`, options);
    
    if (response.status === 401) {
      setIsAuthenticated(false);
      setActiveAdmin(null);
      localStorage.removeItem('semivra_token');
    }
    return response;
  };

  const handleSystemLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_URL}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();

      if (!data.success) {
        setLoginError('Invalid name or password.');
        return;
      }

      const isSuperAdminLogin = data.user?.role === 'superadmin';
      const cashAmount = parseFloat(startingCash);

      // Non-superadmins must declare their opening cash
      if (!isSuperAdminLogin && (!startingCash || isNaN(cashAmount) || cashAmount < 0)) {
        setLoginError('Please enter a valid Starting Cash amount (₱0 or more).');
        return;
      }

      localStorage.setItem('semivra_token', data.token);
      setIsAuthenticated(true);
      setActiveAdmin(data.user);

      // Superadmin with no cash entered → log shift with ₱0
      const finalCash = isSuperAdminLogin ? (isNaN(cashAmount) ? 0 : cashAmount) : cashAmount;
      try {
        const shiftRes = await fetch(`${API_URL}/api/shifts/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
          body: JSON.stringify({ startingCash: finalCash })
        });
        if (!shiftRes.ok) console.warn('Shift record failed to save — check server logs.');
      } catch {
        console.warn('Shift start request failed — shift may not be recorded.');
      }
      setStartingCash('');
      localStorage.removeItem('semivra_last_actual_cash');
    } catch (err) {
      setLoginError('Network error. Please try again.');
      console.error('Login failed', err);
    }
  };

  // Opens the End-of-Shift modal (does NOT clear session yet)
  const handleLogout = () => {
    setShiftReconcile({ actualCash: '', result: null });
    setShiftEndModal(true);
  };

  // Called when cashier confirms End-of-Shift cash count
  const handleEndShift = async () => {
    const actual = parseFloat(shiftReconcile.actualCash);
    if (isNaN(actual) || actual < 0) return alert('Please enter a valid cash amount.');
    setShiftEndLoading(true);
    try {
      const res = await apiFetch('/api/shifts/end', {
        method: 'POST',
        body: JSON.stringify({ actualCash: actual })
      });
      const data = await res.json();
      if (data.success) {
        setShiftReconcile(prev => ({ ...prev, result: data.shift }));
        localStorage.setItem('semivra_last_actual_cash', data.shift.actualCash.toString());
      } else {
        // Shift may not exist (e.g., session expired) — still allow logout
        setShiftReconcile(prev => ({ ...prev, result: null }));
        performLogout();
      }
    } catch {
      performLogout();
    } finally {
      setShiftEndLoading(false);
    }
  };

  const handleBankDeposit = async () => {
    if (!shiftReconcile.result) return;
    setDepositError('');
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) { setDepositError('Enter a valid amount.'); return; }
    setDepositLoading(true);
    try {
      const res = await apiFetch('/api/bank-deposits', {
        method: 'POST',
        body: JSON.stringify({ shiftId: shiftReconcile.result._id, amount })
      });
      const data = await res.json();
      if (data.success) {
        setShiftReconcile(prev => ({ ...prev, result: data.shift }));
        setDepositAmount('');
      } else {
        setDepositError(data.error || 'Deposit failed.');
      }
    } catch { setDepositError('Network error.'); }
    finally { setDepositLoading(false); }
  };

  // Final logout — clears all session data
  const performLogout = () => {
    localStorage.removeItem('semivra_token');
    setIsAuthenticated(false);
    setActiveAdmin(null);
    setLoginForm({ name: '', password: '' });
    setShiftEndModal(false);
    setShiftReconcile({ actualCash: '', result: null });
    setOrders([]);
    setArchivedOrders([]);
  };

  // Token validation handled in state initializer above; this effect is intentionally empty

  const getSelectedItems = (order) => {
    if (discountedItems[order._id] !== undefined) return discountedItems[order._id];
    return order.items.map((_, i) => i); // Default: All items selected
  };

  const toggleItemDiscount = (orderId, idx) => {
    setDiscountedItems(prev => {
      const current = prev[orderId] || [];
      if (current.includes(idx)) return { ...prev, [orderId]: current.filter(i => i !== idx) };
      return { ...prev, [orderId]: [...current, idx] };
    });
  };

  const toggleAllItems = (orderId, itemCount) => {
    setDiscountedItems(prev => {
      const current = prev[orderId] || [];
      if (current.length === itemCount) return { ...prev, [orderId]: [] }; // Deselect all
      return { ...prev, [orderId]: Array.from({length: itemCount}, (_, i) => i) }; // Select all
    });
  };

  const handleInlinePriceUpdate = async (productId, sizeIndex) => {
    // FIX: Look up the product in your local React state instead of querying the backend database!
    const product = products.find(p => p._id === productId);
    if (!product) return;

    // Create a copy of the product and update the specific price
    const updatedProduct = { ...product };
    if (sizeIndex === null) {
      updatedProduct.basePrice = parseFloat(editPriceVal) || 0;
    } else {
      updatedProduct.sizes[sizeIndex].price = parseFloat(editPriceVal) || 0;
    }

    try {
      await apiFetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProduct)
      });
      setEditPriceId(null); // Close the input field
      fetchData(); // Refresh the table instantly
    } catch (err) {
      console.error("Failed to update price", err);
    }
  };

  const fetchData = async () => {
    try {
      // Fetch Products
      const pRes = await apiFetch(`/api/products`);
      if (pRes.ok) setProducts((await pRes.json()).products || []);
      
      // Fetch Categories
      const cRes = await apiFetch(`/api/categories`);
      if (cRes.ok) setCategories((await cRes.json()).categories || []);
      
      // Fetch Discounts
      const dRes = await apiFetch(`/api/discounts`);
      if (dRes.ok) setDiscounts((await dRes.json()).discounts || []);

      // Fetch Global Add-Ons
      const aRes = await apiFetch(`/api/addons`);
      if (aRes.ok) setGlobalAddOns((await aRes.json()).addons || []);
      
    } catch (err) { console.error('Failed to fetch menu data', err); }
  };

  // 3. Add these two handler functions right above your return() statement:
  const handleSaveAddOn = async (e) => {
    e.preventDefault();
    await apiFetch(`/api/addons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(addOnForm) });
    setAddOnForm({ name: '', price: '', category: 'Extras' });
    fetchData();
  };
  
  const deleteAddOn = async (id) => {
    if(window.confirm('Delete this Add-on?')) await apiFetch(`/api/addons/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const fetchERPData = async () => {
    try {
      const invRes = await apiFetch(`/api/inventory`);
      if (invRes.ok) setInventory((await invRes.json()).items || []);

      const isSuperAdmin = activeAdmin?.role === 'superadmin';
      if (isSuperAdmin) {
        const jeRes = await apiFetch(`/api/journal`);
        if (jeRes.ok) setJournalEntries((await jeRes.json()).entries || []);

        const balRes = await apiFetch(`/api/finance/balances`);
        if (balRes.ok) setCashOnHand((await balRes.json()).cashOnHand || 0);
      }
    } catch (err) { console.error('Failed to fetch ERP data', err); }
  };

  const fetchEODData = async () => {
    try {
      const res = await apiFetch(`/api/inventory/eod-data`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setEodStatus(data.status);
        setEodLockedAt(data.lockedAt);
        setDailyMovement(data.movement);
      }
    } catch (err) { console.error("Failed to fetch EOD data"); }
  };

  const fetchDiscounts = async () => {
    try {
      const res = await apiFetch(`/api/discounts`);
      if (res.ok) setDiscountList((await res.json()).discounts);
    } catch (err) { console.error("Failed to fetch discounts"); }
  };

  const fetchUsers = async () => {
    try {
      const res = await apiFetch(`/api/users`);
      if (res.ok) {
        const data = await res.json();
        // THE FIX: Filter out the Super Admin so they don't appear in the dropdown!
        const employeesOnly = data.users.filter(u => u.role !== 'superadmin');
        setUsers(employeesOnly);
      }
    } catch (err) { 
      console.error("Failed to fetch users"); 
    }
  };

  const fetchOrders = async () => {
    try {
      const cacheBuster = new Date().getTime();
      const res = await apiFetch(`/api/orders?t=${cacheBuster}`, { cache: 'no-store' });
      if (res.ok) setOrders((await res.json()).orders || []);

      // Archives endpoint requires superadmin — skip for staff to avoid forced logout via 403
      if (activeAdmin?.role === 'superadmin') {
        const archRes = await apiFetch(`/api/orders/archives?t=${cacheBuster}`, { cache: 'no-store' });
        if (archRes.ok) setArchivedOrders((await archRes.json()).archives || []);
      }
    } catch (err) { console.error('Failed to fetch orders', err); }
  };

  const injectOwnerCapital = async () => {
    const amountStr = prompt("Enter amount of capital to inject from Owner's Equity:");
    const amount = parseFloat(amountStr);
    if (!amount || amount <= 0) return;

    const jePayload = {
      description: 'Owner Capital Injection',
      lines: [
        { accountCode: '1000', accountName: 'Cash on Hand', debit: amount, credit: 0 },
        { accountCode: '3000', accountName: 'Owner Equity', debit: 0, credit: amount }
      ]
    };

    await apiFetch(`/api/journal`, { 
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(jePayload) 
    });
    fetchERPData();
    alert(`₱${amount.toFixed(2)} injected into Cash on Hand.`);
  };

  const fetchStockHistory = async (item) => {
    try {
      const res = await apiFetch(`/api/inventory/history/${item._id}`);
      const data = await res.json();
      if (data.success) {
        setStockHistory(data.history);
        setHistoryItemName(item.itemName);
        setHistoryPage(1);
        setHistoryModalOpen(true);
      }
    } catch (err) { console.error("Failed to fetch history"); }
  };
  
  const [jeForm, setJeForm] = useState({
    description: '',
    lines: [
      { accountCode: '', accountName: '', debit: '', credit: '' },
      { accountCode: '', accountName: '', debit: '', credit: '' }
    ]
  });

  const standardAccounts = [
    { accountCode: '1000', accountName: 'Cash on Hand', type: 'Asset' },
    { accountCode: '1010', accountName: 'Cash in Bank', type: 'Asset' },
    { accountCode: '1015', accountName: 'E-Wallet', type: 'Asset' },
    { accountCode: '1200', accountName: 'Accounts Receivable', type: 'Asset' },
    { accountCode: '1500', accountName: 'Inventory Asset', type: 'Asset' },
    { accountCode: '2000', accountName: 'Accounts Payable', type: 'Liability' },
    { accountCode: '2100', accountName: 'VAT Payable', type: 'Liability' },
    { accountCode: '3000', accountName: 'Owner Equity', type: 'Equity' },
    { accountCode: '4000', accountName: 'Sales Revenue', type: 'Revenue' },
    { accountCode: '4150', accountName: 'Sales Returns', type: 'Revenue' },
    { accountCode: '5000', accountName: 'Cost of Goods Sold', type: 'Expense' },
    { accountCode: '6000', accountName: 'Operating Expenses', type: 'Expense' },
    { accountCode: '6100', accountName: 'Complimentary Expense', type: 'Expense' }
  ];

  useEffect(() => { if (isAuthenticated) fetchDiscounts(); }, [isAuthenticated]);

  // --- REAL-TIME AUTO REFRESH ---
  // Effect 1: ERP/EOD sub-tab listeners — uses named callbacks so .off() is scoped
  useEffect(() => {
    const handleERPForEOD = () => {
      fetchERPData();
      if (invSubTab === 'eod') fetchEODData();
    };
    socket.on('erpUpdated', handleERPForEOD);
    socket.on('orderUpdated', handleERPForEOD);
    return () => {
      socket.off('erpUpdated', handleERPForEOD);
      socket.off('orderUpdated', handleERPForEOD);
    };
  }, [invSubTab]);

  // Effect 2: Order list + menu listeners — named callbacks so cleanup doesn't nuke Effect 1's handlers
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchOrders();
    fetchData();
    fetchERPData();
    fetchUsers();

    const handleNewOrder    = (order) => { setOrders(prev => [order, ...prev]); playKitchenDing(); };
    const handleOrderUpdate = (updated) => setOrders(prev => prev.map(o => o._id === updated._id ? updated : o));
    const handleMenuUpdate  = () => fetchData();
    const handleArchived    = () => fetchOrders();
    const handleERPUpdate   = () => fetchERPData();

    socket.on('newOrder',       handleNewOrder);
    socket.on('orderUpdated',   handleOrderUpdate);
    socket.on('menuUpdated',    handleMenuUpdate);
    socket.on('ordersArchived', handleArchived);
    socket.on('erpUpdated',     handleERPUpdate);

    return () => {
      socket.off('newOrder',       handleNewOrder);
      socket.off('orderUpdated',   handleOrderUpdate);
      socket.off('menuUpdated',    handleMenuUpdate);
      socket.off('ordersArchived', handleArchived);
      socket.off('erpUpdated',     handleERPUpdate);
    };
  }, [isAuthenticated]);

  // --- MANUAL POS LOGIC ---
  const openProductModal = (product) => {
    setPosSelectedProduct(product);
    setPosActiveSize(null); // Defaults to base size
    setPosActiveAddOns([]);
  };

  const confirmPosItem = () => {
    if (!posSelectedProduct) return;
    
    let finalPrice = posSelectedProduct.basePrice || posSelectedProduct.price || 0;
    let finalName = posSelectedProduct.name;
    
    if (posActiveSize !== null) {
      const sizeObj = posSelectedProduct.sizes[posActiveSize];
      finalPrice = sizeObj.price;
      finalName = `${posSelectedProduct.name} (${sizeObj.name})`;
    }
    
    const productCategory = categories.find(c => c.name === posSelectedProduct.category);
    const department = productCategory?.department || 'Kitchen';

    const newItem = {
      productId: posSelectedProduct._id,
      name: finalName,
      price: finalPrice,
      quantity: 1,
      department,
      selectedAddOns: [...posActiveAddOns]
    };

    setPosCart([...posCart, newItem]);
    setPosSelectedProduct(null);
  };

  const submitManualOrder = async () => {
    if (posCart.length === 0) return alert("Cart is empty!");
    if (!posCustomerName) return alert("Please enter Customer / Driver Name");

    const payload = {
      items: posCart,
      table: posTable,
      customerName: posCustomerName,
      paymentMethod: ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(posTable) ? posTable : 'Cash',
      discountPercent: 0,
      isComplimentary: false,
      sessionId: null
    };

    try {
      const res = await apiFetch(`/api/orders`, {
        method: 'POST', body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setIsPosOpen(false);
        setPosCart([]);
        setPosCustomerName('');
        fetchOrders(); // Refresh the grid!
      } else {
        alert(data.error);
      }
    } catch (e) {
      console.error(e);
    }
  };

const updateStatus = async (orderId, newStatus) => {
    if (updatingOrders[orderId]) return; // double-tap guard
    setUpdatingOrders(prev => ({ ...prev, [orderId]: true }));

    // 1. Grab the order so we can check if it's a delivery
    const order = orders.find(o => o._id === orderId);

    const payload = { status: newStatus };

    if (newStatus === 'Preparing') {
      // 2. BULLETPROOF OVERRIDE: If it's a delivery, force it! Otherwise, use dropdown/existing.
      if (order && ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(order.table)) {
        payload.paymentMethod = order.table;
      } else {
        payload.paymentMethod = paymentSelections[orderId] || (order ? order.paymentMethod : 'Cash') || 'Cash';
      }
      // Include cash tendered for cash payments
      if (payload.paymentMethod === 'Cash' && cashTendered[orderId]) {
        payload.amountTendered = parseFloat(cashTendered[orderId]) || 0;
      }
    }

    // Play ready chime when order is called out to customer
    if (newStatus === 'Ready') playReadyChime();

    // Optimistic UI update
    setOrders(prev => prev.map(o => o._id === orderId ? { ...o, ...payload } : o));
    socket.emit('updateOrderStatus', { orderId, status: newStatus });

    // Backend Sync
    try {
      const res = await apiFetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.error); // Show the exact error (e.g., "INSUFFICIENT STOCK")
        fetchOrders(); // Revert the UI back to normal if the database rejected it
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingOrders(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    }
  };

  const updateItemStatus = async (order, itemIndex, newStatus) => {
    const newItems = [...order.items];
    
    // FIX: Deep clone the specific item so we don't directly mutate React state
    newItems[itemIndex] = { ...newItems[itemIndex], itemStatus: newStatus };
    
    // Update UI instantly
    setOrders(prev => prev.map(o => o._id === order._id ? { ...o, items: newItems } : o));
    
    // Send to backend
    await apiFetch(`/api/orders/${order._id}`, {
      method: 'PUT',
      body: JSON.stringify({ items: newItems })
    });
  };

  const removeAddOnFromOrder = async (order, itemIndex, addOnIndex) => {
    if (!window.confirm("Remove this add-on from the customer's order?")) return;
    
    const newItems = [...order.items];
    newItems[itemIndex].selectedAddOns = newItems[itemIndex].selectedAddOns.filter((_, idx) => idx !== addOnIndex);
    
    // Optimistic UI
    setOrders(prev => prev.map(o => o._id === order._id ? { ...o, items: newItems } : o));
    
    // Backend Sync (which recalculates the total price)
    try {
      const res = await apiFetch(`/api/orders/${order._id}`, {
        method: 'PUT',
        body: JSON.stringify({ items: newItems })
      });
      const data = await res.json();
      if (data.success) {
        fetchOrders(); // Refresh to get the accurate new total
      } else {
        alert(data.error);
        fetchOrders(); // Revert on fail
      }
    } catch (err) {
      console.error(err);
    }
  };

  const applyComplimentary = async (orderId) => {
    const reasonType = compReasonTypes[orderId];
    if (!reasonType) return alert("Select a reason type for the complimentary order.");
    const forEmployee = compSelections[orderId] || activeAdmin?.name || 'Unknown';
    const approvedBy = activeAdmin?.name || 'Manager';
    setCompOverride(prev => ({ ...prev, [orderId]: { isComplimentary: true, employeeName: forEmployee } }));
    try {
      const res = await apiFetch(`/api/orders/${orderId}/complimentary`, {
        method: 'PUT',
        body: JSON.stringify({
          reasonType,
          reasonNote: compReasonNotes[orderId] || '',
          approvedBy,
          forEmployee
        })
      });
      const data = await res.json();
      if (!data.success) {
        setCompOverride(prev => { const n = { ...prev }; delete n[orderId]; return n; });
        alert(data.error || 'Failed to apply complimentary.');
      }
    } catch (err) {
      setCompOverride(prev => { const n = { ...prev }; delete n[orderId]; return n; });
      console.error('Failed to apply complimentary:', err);
      alert('Network error — complimentary not applied.');
    }
  };

  const removeComplimentary = async (orderId) => {
    setCompOverride(prev => ({ ...prev, [orderId]: { isComplimentary: false, employeeName: '' } }));
    setCompReasonTypes(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    setCompReasonNotes(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    setCompSelections(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    await apiFetch(`/api/orders/${orderId}/complimentary`, { method: 'DELETE' });
  };
  const toggleVat = async (orderId, currentVatRate) => { await apiFetch(`/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isVatExempt: currentVatRate > 0 }) }); };
  const applyDiscount = async (orderId, isRemoving = false) => {
    const order = orders.find(o => o._id === orderId);
    const percent = isRemoving ? 0 : parseFloat(discountInputs[orderId] || 0);
    if (percent < 0 || percent > 100) return alert('Discount must be between 0% and 100%');
    
    // Grab the ticked checkboxes
    const selectedIndices = isRemoving ? [] : getSelectedItems(order);

    // Auto-detect SC/PWD to trigger isolated VAT Exemption
    let isVatExempt = false;
    let discountType = 'None';
    const selectedVal = discountInputs[orderId];
    const selectedObj = discounts.find(d => d.percentage.toString() === selectedVal);
    
    if (selectedObj && selectedObj.isSCPWD) {
      isVatExempt = true;
      discountType = 'SC/PWD';
    } else if (percent > 0) {
      discountType = 'Promo';
    }

    await apiFetch(`/api/orders/${orderId}`, { 
      method: 'PUT', 
      body: JSON.stringify({ 
        discountPercent: percent,
        isVatExempt,
        discountType,
        discountedIndices: selectedIndices 
      }) 
    });
    if (isRemoving) setDiscountInputs(prev => ({ ...prev, [orderId]: '' }));
  };

  const applyItemDiscount = async (orderId, itemIndex, discountPercent) => {
    try {
      // We send this to your existing order update route, specifically targeting the items array
      const order = orders.find(o => o._id === orderId);
      if (!order) return;

      const updatedItems = [...order.items];
      updatedItems[itemIndex].discountPercent = Number(discountPercent);

      const res = await apiFetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updatedItems })
      });
      
      const data = await res.json();
      if (data.success) fetchOrders();
    } catch (err) {
      console.error(err);
    }
  };
  const archiveDay = async () => {
    if (!window.confirm("Are you sure you want to close the day? This will archive everything.")) return;
    
    try { 
      const res = await apiFetch(`/api/orders/archive`, { method: 'POST' }); 
      const data = await res.json();
      
      if (data.success) {
        alert("Register closed and day archived successfully!");
        setOrders([]); // Instantly clears active orders from the screen
        await fetchOrders(); // Refreshes to pull the new archive list
      } else {
        alert("Failed to archive day.");
      }
    } catch (err) { 
      console.error("Failed to archive:", err); 
    }
  };
  // --- 🖨️ ORDER SLIP PRINTER ---
  const printOrderSlip = async (order) => {
    // Builds a styled HTML receipt that auto-scales with order size
    const buildReceiptHTML = () => {
      const dateStr = new Date(order.createdAt || Date.now()).toLocaleString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      });

      const itemRowsHTML = order.items.map(item => {
        const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
        const lineTotal = (item.price + addOnTotal) * item.quantity;
        const addOnHTML = (item.selectedAddOns || []).map(a =>
          `<tr><td></td><td class="aname">+ ${a.name}</td><td class="amt">&#x20B1;${Number(a.price || 0).toFixed(2)}</td></tr>`
        ).join('');
        return `<tr>
          <td class="qty">${item.quantity}x</td>
          <td class="iname">${item.name}</td>
          <td class="amt">&#x20B1;${lineTotal.toFixed(2)}</td>
        </tr>${addOnHTML}`;
      }).join('');

      const subTotal = order.subtotal || 0;
      const discAmt  = order.discount  || 0;
      const total    = order.total     || 0;
      const tendered = order.amountTendered || 0;
      const change   = order.changeDue || 0;

      const discRow = (discAmt > 0 && !order.isComplimentary)
        ? `<tr class="disc"><td colspan="2">Discount (${order.discountType || ''})</td><td class="amt">-&#x20B1;${discAmt.toFixed(2)}</td></tr>`
        : '';

      const totalBlock = order.isComplimentary
        ? `<tr class="tot"><td colspan="2">AMOUNT DUE</td><td class="amt">&#x20B1;0.00</td></tr>`
        : `<tr class="tot"><td colspan="2">TOTAL</td><td class="amt">&#x20B1;${total.toFixed(2)}</td></tr>
           ${tendered > 0 && order.paymentMethod === 'Cash' ? `
             <tr><td colspan="2">Cash Tendered</td><td class="amt">&#x20B1;${tendered.toFixed(2)}</td></tr>
             <tr class="chg"><td colspan="2">Change</td><td class="amt">&#x20B1;${change.toFixed(2)}</td></tr>` : ''}`;

      const compSection = order.isComplimentary ? `
        <div class="comp-banner">&#9733; COMPLIMENTARY ORDER &#9733;</div>
        ${order.complimentaryReasonType ? `<div class="comp-sub">${COMP_REASON_LABELS[order.complimentaryReasonType] || ''}${order.complimentaryReasonNote ? ` — ${order.complimentaryReasonNote}` : ''}</div>` : ''}
        ${order.complimentaryApprovedBy ? `<div class="comp-sub">Approved by: ${order.complimentaryApprovedBy}</div>` : ''}
        <div class="dash"></div>` : '';

      return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Order ${order.orderNumber}</title>
<style>
  @page { size: 80mm auto; margin: 3mm 4mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #000; background: #fff; width: 72mm; }
  .center { text-align: center; }
  .store  { font-size: 15px; font-weight: bold; letter-spacing: 1px; margin-bottom: 1px; }
  .addr   { font-size: 9px; color: #333; }
  .dash   { border-top: 1px dashed #000; margin: 4px 0; }
  table   { width: 100%; border-collapse: collapse; }
  td      { padding: 1px 0; vertical-align: top; font-size: 11px; }
  td.qty  { width: 22px; font-weight: bold; white-space: nowrap; }
  td.iname { padding-right: 4px; font-weight: bold; word-break: break-word; }
  td.amt  { text-align: right; white-space: nowrap; font-weight: bold; }
  td.aname { padding-left: 10px; color: #555; font-weight: normal; font-size: 10px; word-break: break-word; }
  .meta td { font-weight: normal; padding: 1px 0; }
  .meta td:first-child { width: 58px; color: #555; }
  .disc td { color: #333; }
  .tot td  { font-size: 13px; font-weight: bold; padding-top: 4px; border-top: 1px solid #000; }
  .chg td  { font-weight: bold; }
  .comp-banner { text-align: center; font-weight: bold; font-size: 12px; margin: 3px 0 2px; }
  .comp-sub    { text-align: center; font-size: 9px; color: #333; }
  .nopay  { text-align: center; font-weight: bold; font-size: 11px; margin: 3px 0; }
  .footer { text-align: center; font-size: 9px; margin-top: 8px; }
  @media print {
    html, body { width: 72mm; background: #fff; }
    @page { size: 80mm auto; margin: 3mm 4mm; }
  }
</style>
</head>
<body>
  <div class="center">
    <div class="store">${BIZ_NAME}</div>
    <div class="addr">Angeles City, Pampanga</div>
  </div>
  <div class="dash"></div>
  ${compSection}
  <table class="meta">
    <tr><td>Order #</td><td><strong>${order.orderNumber || '—'}</strong></td></tr>
    <tr><td>Table</td><td>${order.table || '—'}</td></tr>
    <tr><td>Date</td><td>${dateStr}</td></tr>
    ${order.cashier && order.cashier !== 'System' ? `<tr><td>Cashier</td><td>${order.cashier}</td></tr>` : ''}
    ${order.customerName && order.customerName !== 'Guest' ? `<tr><td>Name</td><td>${order.customerName}</td></tr>` : ''}
    ${!order.isComplimentary ? `<tr><td>Payment</td><td>${order.paymentMethod || 'Cash'}</td></tr>` : ''}
  </table>
  <div class="dash"></div>
  <table>
    ${itemRowsHTML}
  </table>
  <div class="dash"></div>
  <table>
    <tr><td colspan="2">Subtotal</td><td class="amt">&#x20B1;${subTotal.toFixed(2)}</td></tr>
    ${discRow}
    ${totalBlock}
  </table>
  ${order.isComplimentary ? '<div class="dash"></div><div class="nopay">NO PAYMENT REQUIRED</div>' : ''}
  <div class="footer">
    <div>Thank you for dining with us!</div>
    <div style="margin-top:3px">&#8212; ${BIZ_NAME} &#8212;</div>
  </div>
</body></html>`;
    };

    // === 1. TRY BLUETOOTH ESC/POS (Chrome / Android only) ===
    if (navigator.bluetooth) {
      try {
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2']
        });
        const server = await device.gatt.connect();

        const services = await server.getPrimaryServices();
        let printChar = null;
        for (const svc of services) {
          const chars = await svc.getCharacteristics();
          for (const c of chars) {
            if (c.properties.write || c.properties.writeWithoutResponse) { printChar = c; break; }
          }
          if (printChar) break;
        }
        if (!printChar) throw new Error('No writable characteristic found');

        const enc  = new TextEncoder();
        const buf  = [];
        const b    = (arr) => buf.push(...arr);
        const tx   = (str) => b(Array.from(enc.encode(str)));
        const SEP  = '--------------------------------\n';
        const INIT   = [0x1b, 0x40];
        const CENTER = [0x1b, 0x61, 0x01];
        const LEFT   = [0x1b, 0x61, 0x00];
        const BOLD1  = [0x1b, 0x45, 0x01];
        const BOLD0  = [0x1b, 0x45, 0x00];
        const LF     = [0x0a];

        b(INIT); b(CENTER); b(BOLD1); tx(`${BIZ_NAME}\n`); b(BOLD0);
        tx('Angeles City, Pampanga\n'); tx(SEP);

        if (order.isComplimentary) {
          b(BOLD1); tx('** COMPLIMENTARY ORDER **\n'); b(BOLD0);
          if (order.complimentaryReasonType) tx(`${COMP_REASON_LABELS[order.complimentaryReasonType] || ''}\n`);
          if (order.complimentaryApprovedBy) tx(`Approved: ${order.complimentaryApprovedBy}\n`);
          tx(SEP);
        }

        b(LEFT);
        tx(`Order: ${order.orderNumber || '—'}\n`);
        tx(`Table: ${order.table || '—'}\n`);
        tx(`Date:  ${new Date(order.createdAt || Date.now()).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}\n`);
        if (order.cashier && order.cashier !== 'System') tx(`By:    ${order.cashier}\n`);
        if (!order.isComplimentary) tx(`Pay:   ${order.paymentMethod || 'Cash'}\n`);
        tx(SEP);

        order.items.forEach(item => {
          const addOnTotal = (item.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
          const lineTotal  = (item.price + addOnTotal) * item.quantity;
          const nameCol    = item.name.substring(0, 16).padEnd(16);
          b(BOLD1);
          tx(`${String(item.quantity).padStart(2)}x ${nameCol} P${lineTotal.toFixed(2).padStart(7)}\n`);
          b(BOLD0);
          (item.selectedAddOns || []).forEach(a => {
            tx(`   + ${a.name.substring(0, 14).padEnd(14)} P${Number(a.price || 0).toFixed(2).padStart(7)}\n`);
          });
        });

        b(CENTER); tx(SEP);
        const subTotal = order.subtotal || 0;
        const discAmt  = order.discount  || 0;
        const total    = order.total     || 0;

        if (!order.isComplimentary && discAmt > 0) {
          tx(`Subtotal:              P${subTotal.toFixed(2)}\n`);
          tx(`Discount (${(order.discountType || '').padEnd(6)}): -P${discAmt.toFixed(2)}\n`);
        }
        b(BOLD1);
        if (order.isComplimentary) {
          tx(`Subtotal: P${subTotal.toFixed(2)}\n`);
          tx(`AMOUNT DUE: P0.00\n`);
          tx('** NO PAYMENT REQUIRED **\n');
        } else {
          tx(`TOTAL: P${total.toFixed(2)}\n`);
        }
        b(BOLD0);
        if (!order.isComplimentary && (order.amountTendered || 0) > 0 && order.paymentMethod === 'Cash') {
          tx(`Cash:   P${(order.amountTendered || 0).toFixed(2)}\n`);
          b(BOLD1); tx(`Change: P${(order.changeDue || 0).toFixed(2)}\n`); b(BOLD0);
        }
        tx(SEP);
        b(CENTER); tx('Thank you for dining with us!\n');

        // Dynamic feed — fewer lines for larger orders (content itself advances the paper)
        const feedLines = Math.max(4, 8 - Math.floor(order.items.length / 2));
        for (let i = 0; i < feedLines; i++) b(LF);

        const data  = new Uint8Array(buf);
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < data.length; i += 256) {
          await printChar.writeValue(data.slice(i, i + 256));
          await sleep(100);
        }
        server.disconnect();
        return; // Success — skip HTML fallback
      } catch (err) {
        console.error('Bluetooth print error:', err);
        // Fall through to HTML popup
      }
    }

    // === 2. HTML POPUP (works on any browser / device) ===
    const html = buildReceiptHTML();
    const win  = window.open('', '_blank', 'width=380,height=620,toolbar=0,location=0,menubar=0,status=0,scrollbars=1');
    if (!win) return alert('Allow popups for this site to use the print dialog.');
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 300);
  };

  // --- 🚨 SAFE VOID & REFUND SYSTEM ---
  const handleVoidOrder = async (orderId) => {
    const reason = window.prompt("WARNING: You are voiding a completed order.\n\nType 'Restock' if the food was NOT made (refunds inventory).\nType 'Spoilage' if the food WAS made (records as waste/loss).");
    
    if (!reason) return;
    if (reason !== 'Restock' && reason !== 'Spoilage') {
      return alert("Action Cancelled. You must type exactly 'Restock' or 'Spoilage'.");
    }

    try {
      const res = await apiFetch(`/api/orders/${orderId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`Order Voided Successfully. Inventory & Ledger updated for ${reason}.`);
        fetchOrders();
        fetchERPData();
      } else {
        alert("Failed to void order: " + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };
  const [qrSessionId, setQrSessionId] = useState(''); // Add this to your states at the top if needed

  const handleShowQR = async () => {
    try {
      const newTable = `T-${Date.now().toString(36).toUpperCase()}`;
      
      // Request a secure, timed link from the backend
      const res = await apiFetch('/api/sessions/generate', {
        method: 'POST',
        body: JSON.stringify({ table: newTable })
      });
      const data = await res.json();
      
      if (data.success) {
        setAutoTableId(newTable);
        setQrSessionId(data.sessionId);
        setShowQR(true);
      }
    } catch (err) {
      console.error("Failed to generate secure QR session");
    }
  };

  const handleRestockSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`/api/inventory/restock/${activeInventoryItem._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addedStock: Number(restockData.addedStock),
          totalCost: Number(restockData.totalCost)
        })
      });
      if (res.ok) {
        alert("Stock received. Weighted Average Cost updated!");
        setActiveInventoryItem(null);
        setRestockData({ addedStock: '', totalCost: '' });
        fetchERPData(); // Re-fetch inventory
      }
    } catch (err) { console.error("Restock failed", err); }
  };

const submitPhysicalCounts = async () => {
    try {
      const res = await apiFetch(`/api/inventory/count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          counts: physicalCounts,
          reasons: varianceReasons, // <-- NEW: Send the reasons to the backend!
          adminName: activeAdmin ? activeAdmin.name : 'System Admin'
        })
      });
      const data = await res.json();
      
      if (data.success) {
        alert('End of Day counts successfully locked and recorded.');
        setPhysicalCounts({});
        setVarianceReasons({});
        setVarianceNoteMode({});
        fetchERPData(); // Refresh the live data
        setInvSubTab('live'); // Kick them back to the live tab so they see the updated numbers!
      } else {
        alert('Failed to submit counts: ' + data.error);
      }
    } catch (err) {
      console.error('Failed to submit counts', err);
    }
  };

  const addInventory = async () => {
    if(!invForm.itemName || !invForm.packQty || !invForm.unitPerPack || !invForm.unit || !invForm.costPerPack) return alert("Please fill in all inventory fields.");
    
    const itemNameClean = invForm.itemName.trim();
    const totalStockAdded = parseFloat(invForm.packQty) * parseFloat(invForm.unitPerPack);
    const totalCost = parseFloat(invForm.packQty) * parseFloat(invForm.costPerPack);
    
    // Check if the item already exists!
    const existingItem = inventory.find(i => i.itemName.toLowerCase() === itemNameClean.toLowerCase());

    if (existingItem) {
      if (!window.confirm(`"${existingItem.itemName}" already exists in inventory. Do you want to RESTOCK it with ${totalStockAdded}${invForm.unit}?`)) return;
      
      // RESTOCK EXISTING ITEM
      await apiFetch(`/api/inventory/restock/${existingItem._id}`, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ addedStock: totalStockAdded, totalCost }) 
      });
    } else {
      // ADD BRAND NEW ITEM
      const costPerMicroUnit = parseFloat(invForm.costPerPack) / parseFloat(invForm.unitPerPack);
      const payload = { itemName: itemNameClean, stockQty: totalStockAdded, unit: invForm.unit, unitCost: costPerMicroUnit };
      
      const res = await apiFetch(`/api/inventory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.success) return alert(data.error);
    }

    setInvForm({ itemName: '', packQty: '', unitPerPack: '', unit: '', costPerPack: '' });
    fetchERPData();
  };
  const deleteInventory = async (id) => { if(window.confirm('Delete inventory item?')) { await apiFetch(`/api/inventory/${id}`, { method: 'DELETE' }); fetchERPData(); } };

// ==========================================
  //   PDF EXPORT ENGINE
  // ==========================================

  const formatMoney = (val) => `P${(val || 0).toFixed(2)}`;

  // 1. Inventory & Movement History PDF (Unchanged)
  const exportInventoryToPDF = async () => {
    if (inventory.length === 0) return alert("No inventory to export.");
    try {
      const res = await apiFetch(`/api/inventory/history`);
      const data = await res.json();
      const allHistory = data.success ? data.history : [];
      const doc = new jsPDF('landscape');
      doc.setFontSize(18); doc.text("Daily Inventory & Movement Report", 14, 15);
      const todayStr = new Date().toLocaleDateString();
      doc.setFontSize(10); doc.text(`Date: ${todayStr} | Generated: ${new Date().toLocaleString()}`, 14, 22);
      
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayHistory = allHistory.filter(h => new Date(h.date) >= startOfDay);
      
      const stockBody = inventory.map(item => {
        const itemHistory = todayHistory.filter(h => h.inventoryId === item._id);
        let purchases = 0, sales = 0, adjustments = 0;
        itemHistory.forEach(h => {
          if (h.type === 'Restock' || h.type === 'Initial') purchases += h.qtyChange;
          else if (h.type === 'Sale') sales += Math.abs(h.qtyChange);
          else if (h.type === 'Adjustment') adjustments += h.qtyChange;
        });
        const ending = item.stockQty;
        const beginning = ending - purchases + sales - adjustments;
        return [
          item.itemName, item.unit, beginning.toString(), purchases.toString(), 
          sales.toString(), adjustments > 0 ? `+${adjustments}` : adjustments.toString(), ending.toString()
        ];
      });
      autoTable(doc, {
        startY: 30,
        head: [['Item Name', 'Unit', 'Beginning Bal.', 'Purchases (In)', 'Sales (Out)', 'Adjustments', 'Ending Bal.']],
        body: stockBody, theme: 'grid', headStyles: { fillColor: [204, 163, 0], textColor: [0,0,0] }
      });
      doc.save(`Inventory_Movement_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) { alert("Failed to generate PDF: " + err.message); }
  };

  const exportLedgerToPDF = () => {
    if (journalEntries.length === 0) return alert("No entries to export.");
    const doc = new jsPDF();
    doc.setFontSize(18); doc.text("General Ledger Report", 14, 15);
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);
    let currentY = 30;
    journalEntries.forEach(entry => {
      if (currentY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); currentY = 20; }
      doc.setFontSize(11); doc.setFont(undefined, 'bold');
      doc.text(`Ref: ${entry.reference}  |  Date: ${new Date(entry.date).toLocaleDateString()}`, 14, currentY);
      doc.setFontSize(10); doc.setFont(undefined, 'normal');
      doc.text(`Memo: ${entry.description}`, 14, currentY + 6);
      const rows = entry.lines.map(line => [`${line.accountCode} - ${line.accountName}`, line.debit ? line.debit.toFixed(2) : '', line.credit ? line.credit.toFixed(2) : '']);
      rows.push(['TOTAL', entry.totalDebit ? entry.totalDebit.toFixed(2) : '0.00', entry.totalCredit ? entry.totalCredit.toFixed(2) : '0.00']);
      autoTable(doc, {
        startY: currentY + 10, head: [['Account', 'Debit (P)', 'Credit (P)']], body: rows,
        theme: 'grid', headStyles: { fillColor: [40, 40, 40] }, styles: { fontSize: 9 }
      });
      currentY = doc.lastAutoTable.finalY + 15;
    });
    doc.save(`General_Ledger_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // 1. COMPLETE SALES HISTORY (Master Summary + Daily Breakdown)
  const exportAllToPDF = () => {
    const allOrders = [...orders.filter(o => o.status !== 'Pending' && o.status !== 'Preparing' && o.status !== 'Ready'), ...archivedOrders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (allOrders.length === 0) return alert("No orders to export.");
    
    const doc = new jsPDF('landscape');
    doc.setFontSize(18); doc.text("Complete Sales History", 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);
    
    const grouped = {};
    allOrders.forEach(o => {
      const date = new Date(o.createdAt).toLocaleDateString();
      if (!grouped[date]) grouped[date] = { orders: [], ordersCount: 0, gross: 0, vatable: 0, vatExempt: 0, vat: 0, discount: 0, netSales: 0 };
      grouped[date].orders.push(o);
      
      // ONLY calculate revenue if the order is officially 'Completed'
      if (o.status === 'Completed') {
        grouped[date].ordersCount++;
        grouped[date].gross += o.subtotal;
        if (o.isVatExempt) { grouped[date].vatExempt += (o.subtotal / 1.12); }
        else { grouped[date].vatable += (o.total / 1.12); }
        grouped[date].vat += o.vatAmount || 0;
        grouped[date].discount += o.isComplimentary ? o.subtotal : (o.discount || 0); // comp = 100% discount
        grouped[date].netSales += o.total;
      }
    });

    // MASTER SUMMARY TABLE
    const summaryBody = Object.keys(grouped).map(date => [
      date, grouped[date].ordersCount.toString(), formatMoney(grouped[date].gross), formatMoney(grouped[date].vatable),
      formatMoney(grouped[date].vatExempt), formatMoney(grouped[date].vat), formatMoney(grouped[date].discount), formatMoney(grouped[date].netSales)
    ]);
    autoTable(doc, {
      startY: 28, head: [['Date', 'Completed Orders', 'Gross Sales (VAT-Inc)', 'VATable Sales', 'VAT-Exempt (PWD)', 'VAT (12%)', 'Discounts', 'Net Sales']],
      body: summaryBody, theme: 'grid', headStyles: { fillColor: [40, 40, 40] }
    });

    let currentY = doc.lastAutoTable.finalY + 15;

    // INDIVIDUAL DAILY BREAKDOWN TABLES
    Object.keys(grouped).forEach(date => {
      if (currentY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); currentY = 20; }
      doc.setFontSize(14); doc.setTextColor(204, 163, 0); doc.text(`Sales Breakdown: ${date}`, 14, currentY); doc.setTextColor(0, 0, 0);
      
      const dayRows = [];
      let dayTotals = { cash: 0, bank: 0, ewallet: 0, grand: 0 };
      
      grouped[date].orders.forEach(order => {
        const time = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        // --- NEW PAYMENT CLASSIFICATION LOGIC ---
        const pm = order.paymentMethod || 'Cash';
        const isCash = pm === 'Cash';
        const isBank = pm === 'Bank Transfer';
        const isEwallet = ['E-Wallet', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(pm);
        const isDelivery = ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(pm);
        const isCompleted = order.status === 'Completed';

        // Protect Daily Totals from Voided/Cancelled Orders
        if (isCompleted) {
          if (dayTotals.delivery === undefined) dayTotals.delivery = 0; // Ensure delivery exists
          dayTotals.cash += isCash ? order.total : 0;
          dayTotals.bank += isBank ? order.total : 0;
          dayTotals.ewallet += isEwallet ? order.total : 0;
          dayTotals.delivery += isDelivery ? order.total : 0;
          dayTotals.grand += order.total;
        }

        let discType = '-';
        if (order.isComplimentary || order.transactionType === 'COMPLIMENTARY' || order.discountType === 'Complimentary') {
          discType = 'COMPLIMENTARY';
        } else if (order.discountPercent > 0) {
          discType = order.isVatExempt ? `SC/PWD (${order.discountPercent}%)` : `Promo (${order.discountPercent}%)`;
        }

        // Update the array pushing logic to include Delivery
        order.items.forEach((item, index) => {
          const isLastItem = index === order.items.length - 1;
          dayRows.push([
            time, order.orderNumber, order.status, `${item.quantity}x ${item.name}`,
            formatMoney(item.price * item.quantity),
            isLastItem && isCompleted ? formatMoney(order.vatAmount) : '-',
            isLastItem && isCompleted ? formatMoney(order.discount) : '-', 
            isLastItem ? discType : '-',
            isLastItem && isCash && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isBank && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isEwallet && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isDelivery && isCompleted ? formatMoney(order.total) : '-', // <-- NEW DELIVERY COLUMN
            isLastItem ? (isCompleted ? formatMoney(order.total) : 'VOID') : '-'
          ]);
        });
      });

      // Daily Footer
      dayRows.push(['', '', '', '', '', '', '', 'DAILY TOTAL:', formatMoney(dayTotals.cash), formatMoney(dayTotals.bank), formatMoney(dayTotals.ewallet), formatMoney(dayTotals.delivery), formatMoney(dayTotals.grand)]);
      autoTable(doc, {
        startY: currentY + 5, // Use 28 for exportDayToPDF
        // ADDED 'Delivery' to the Headers!
        head: [['Time', 'Order #', 'Status', 'Item', 'Gross', 'VAT', 'Discount', 'Type', 'Cash', 'Bank', 'E-Wallet', 'Delivery', 'Total']],
        body: dayRows, theme: 'striped', styles: { fontSize: 7 }, columnStyles: { 3: { cellWidth: 40 } },
        willDrawCell: function(data) {
          if (data.row.index === dayRows.length - 1) { doc.setFont(undefined, 'bold'); doc.setTextColor(204, 163, 0); }
        }
      });
      currentY = doc.lastAutoTable.finalY + 15;
    });
    doc.save(`Complete_Sales_History_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // 2. EXPORT SPECIFIC DAY 
  const exportDayToPDF = (dateString, dayOrders) => {
    if (dayOrders.length === 0) return alert("No orders to export.");
    const doc = new jsPDF('landscape');
    doc.setFontSize(18); doc.text(`Sales Report: ${dateString}`, 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);
    
    const dayRows = [];
    let dayTotals = { cash: 0, bank: 0, ewallet: 0, grand: 0 };
    
    dayOrders.forEach(order => {
      const time = new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // --- NEW PAYMENT CLASSIFICATION LOGIC ---
      const pm = order.paymentMethod || 'Cash';
      const isCash = pm === 'Cash';
      const isBank = pm === 'Bank Transfer';
      const isEwallet = ['E-Wallet', 'GCash', 'Maya', 'Maribank', 'Other E-Wallet'].includes(pm);
      const isDelivery = ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(pm);
      const isCompleted = order.status === 'Completed';

      // Protect Daily Totals from Voided/Cancelled Orders
      if (isCompleted) {
        if (dayTotals.delivery === undefined) dayTotals.delivery = 0; // Ensure delivery exists
        dayTotals.cash += isCash ? order.total : 0;
        dayTotals.bank += isBank ? order.total : 0;
        dayTotals.ewallet += isEwallet ? order.total : 0;
        dayTotals.delivery += isDelivery ? order.total : 0;
        dayTotals.grand += order.total;
      }

      let discType = '-';
      if (order.discountPercent > 0) discType = order.isVatExempt ? `SC/PWD (${order.discountPercent}%)` : `Promo (${order.discountPercent}%)`;
      if (order.isComplimentary) discType = 'COMPLIMENTARY';

      // Update the array pushing logic to include Delivery
        order.items.forEach((item, index) => {
          const isLastItem = index === order.items.length - 1;
          dayRows.push([
            time, order.orderNumber, order.status, `${item.quantity}x ${item.name}`,
            formatMoney(item.price * item.quantity),
            isLastItem && isCompleted ? formatMoney(order.vatAmount) : '-',
            isLastItem && isCompleted ? formatMoney(order.discount) : '-', 
            isLastItem ? discType : '-',
            isLastItem && isCash && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isBank && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isEwallet && isCompleted ? formatMoney(order.total) : '-',
            isLastItem && isDelivery && isCompleted ? formatMoney(order.total) : '-', // <-- NEW DELIVERY COLUMN
            isLastItem ? (isCompleted ? formatMoney(order.total) : 'VOID') : '-'
          ]);
        });
      });

      // Daily Footer
      dayRows.push(['', '', '', '', '', '', '', 'DAILY TOTAL:', formatMoney(dayTotals.cash), formatMoney(dayTotals.bank), formatMoney(dayTotals.ewallet), formatMoney(dayTotals.delivery), formatMoney(dayTotals.grand)]);
      autoTable(doc, {
        startY: 28,
        // ADDED 'Delivery' to the Headers!
        head: [['Time', 'Order #', 'Status', 'Item', 'Gross', 'VAT', 'Discount', 'Type', 'Cash', 'Bank', 'E-Wallet', 'Delivery', 'Total']],
        body: dayRows, theme: 'striped', styles: { fontSize: 7 }, columnStyles: { 3: { cellWidth: 40 } },
        willDrawCell: function(data) {
          if (data.row.index === dayRows.length - 1) { doc.setFont(undefined, 'bold'); doc.setTextColor(204, 163, 0); }
        }
      });
    doc.save(`Sales_${dateString.replace(/,/g, '').replace(/ /g, '_')}.pdf`);
  };

  // 3. DAILY SALES SUMMARY (Analytics Trend Export)
  const exportAnalyticsToPDF = () => {
    // STRICT FILTER: Analytics must ONLY track Completed orders. Voided orders must never touch analytics.
    const allCompletedOrders = [...orders.filter(o => o.status === 'Completed'), ...archivedOrders.filter(o => o.status === 'Completed')].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (allCompletedOrders.length === 0) return alert("No analytics data to export.");
    
    const doc = new jsPDF('landscape');
    doc.setFontSize(18); doc.text("Daily Sales Trend & Summary", 14, 15);
    const timeGenerated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    doc.setFontSize(10); doc.text(`Generated: ${new Date().toLocaleDateString()} at ${timeGenerated}`, 14, 22);
    
    const grouped = {};
    allCompletedOrders.forEach(o => {
      const date = new Date(o.createdAt).toLocaleDateString();
      if (!grouped[date]) grouped[date] = { ordersCount: 0, gross: 0, vatable: 0, vatExempt: 0, vat: 0, discount: 0, netSales: 0 };
      grouped[date].ordersCount++;
      grouped[date].gross += o.subtotal;
      if (o.isVatExempt) { grouped[date].vatExempt += (o.subtotal / 1.12); }
      else { grouped[date].vatable += (o.total / 1.12); }
      grouped[date].vat += o.vatAmount || 0;
      grouped[date].discount += o.isComplimentary ? o.subtotal : (o.discount || 0); // comp = 100% discount
      grouped[date].netSales += o.total;
    });

    const summaryBody = Object.keys(grouped).map(date => [
      date, grouped[date].ordersCount.toString(), formatMoney(grouped[date].gross), formatMoney(grouped[date].vatable),
      formatMoney(grouped[date].vatExempt), formatMoney(grouped[date].vat), formatMoney(grouped[date].discount), formatMoney(grouped[date].netSales)
    ]);
    autoTable(doc, {
      startY: 28, head: [['Date', 'Orders', 'Gross Sales (VAT-Inc)', 'VATable Sales', 'VAT-Exempt (PWD/SC)', 'VAT (12%)', 'Discounts', 'Net Sales']],
      body: summaryBody, theme: 'grid', headStyles: { fillColor: [40, 40, 40] }
    });
    doc.save(`Daily_Sales_Trend_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const exportMonthlyToPDF = () => {
    // STRICT FILTER: Only Completed orders.
    const allCompletedOrders = [...orders.filter(o => o.status === 'Completed'), ...archivedOrders.filter(o => o.status === 'Completed')].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (allCompletedOrders.length === 0) return alert("No orders to export.");
    
    const doc = new jsPDF();
    doc.setFontSize(18); doc.text("Monthly Sales Summary", 14, 15);
    const groupedByMonth = {};
    allCompletedOrders.forEach(o => {
      const month = new Date(o.createdAt).toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!groupedByMonth[month]) groupedByMonth[month] = { cash: 0, bank: 0, ewallet: 0, total: 0 };
      groupedByMonth[month].cash += (o.paymentMethod === 'Cash' || !o.paymentMethod) ? o.total : 0;
      groupedByMonth[month].bank += (o.paymentMethod === 'Bank Transfer') ? o.total : 0;
      groupedByMonth[month].ewallet += (o.paymentMethod === 'E-Wallet') ? o.total : 0;
      groupedByMonth[month].total += o.total;
    });
    const rows = Object.keys(groupedByMonth).map(month => [
      month, `P${groupedByMonth[month].cash.toFixed(2)}`, `P${groupedByMonth[month].bank.toFixed(2)}`, `P${groupedByMonth[month].ewallet.toFixed(2)}`, `P${groupedByMonth[month].total.toFixed(2)}`
    ]);
    autoTable(doc, {
      startY: 25, head: [['Month', 'Cash', 'Bank', 'E-Wallet', 'Total Revenue']],
      body: rows, theme: 'grid', headStyles: { fillColor: [40, 40, 40] }
    });
    doc.save(`Monthly_Summary_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // 4. Sales History PDF Helper
  const handleSaveCategory = async (e) => { 
    e.preventDefault(); 
    if(!catForm.name.trim()) return; 

    if (editingCategory) {
      await apiFetch(`/api/categories/${editingCategory._id}`, { 
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(catForm) 
      });
      setEditingCategory(null);
    } else {
      await apiFetch(`/api/categories`, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(catForm) 
      });
    }
    setCatForm({ name: '', department: 'Kitchen' }); 
    fetchData();
  };

  const deleteCategory = async (id) => { if(window.confirm('Delete category?')) await apiFetch(`/api/categories/${id}`, { method: 'DELETE' }); };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image(); img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scaleSize = 600 / img.width;
        canvas.width = 600; canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setFormData({ ...formData, image: canvas.toDataURL('image/webp', 0.8) });
      };
    };
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    const method = editingProduct ? 'PUT' : 'POST';
    const url = editingProduct ? `/api/products/${editingProduct._id}` : `/api/products`;
    const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
    const data = await res.json();
    if (!data.success) { alert(data.error || 'Failed to save product.'); return; }
    setEditingProduct(null);
    setFormData({ name: '', description: '', category: '', basePrice: '', baseSize: '', sizes: [], image: '', baseRecipe: [] });
    fetchData();
  };
  const deleteProduct = async (id) => { 
    if(window.confirm("Delete this product permanently?")) {
      await apiFetch(`/api/products/${id}`, { method: 'DELETE' }); 
      if (editingProduct && editingProduct._id === id) { setEditingProduct(null); setFormData({ name: '', description: '', category: '', basePrice: '', baseSize: '', sizes: [], image: '', baseRecipe: [] }); }
    }
  };
  
  const addSize = () => setFormData({ ...formData, sizes: [...formData.sizes, { name: '', price: 0 }] });
  const updateSize = (index, field, value) => { const newSizes = [...formData.sizes]; newSizes[index][field] = field === 'price' ? parseFloat(value) || 0 : value; setFormData({ ...formData, sizes: newSizes }); };
  const removeSize = (index) => setFormData({ ...formData, sizes: formData.sizes.filter((_, i) => i !== index) });
  const addAddOn = () => setFormData({ ...formData, addOns: [...(formData.addOns || []), { name: '', price: 0, recipe: [] }] });
  const updateAddOn = (index, field, value) => { const newAddOns = [...formData.addOns]; newAddOns[index][field] = field === 'price' ? parseFloat(value) || 0 : value; setFormData({ ...formData, addOns: newAddOns }); };
  const removeAddOn = (index) => setFormData({ ...formData, addOns: formData.addOns.filter((_, i) => i !== index) });

  const addMaterialToRecipe = (invId, sizeIndex = null) => {
    if (!invId) return;
    const invItem = inventory.find(i => i._id === invId);
    if (!invItem) return;
    const material = { invId: invItem._id, name: invItem.itemName, qty: 1, cost: invItem.unitCost, unit: invItem.unit };
    if (sizeIndex === null) { setFormData({ ...formData, baseRecipe: [...(formData.baseRecipe || []), material] });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe = [...(newSizes[sizeIndex].recipe || []), material]; setFormData({ ...formData, sizes: newSizes }); }
  };
  const updateMaterialQty = (val, matIndex, sizeIndex = null) => {
    const newQty = parseFloat(val) || 0;
    if (sizeIndex === null) { const newRecipe = [...formData.baseRecipe]; newRecipe[matIndex].qty = newQty; setFormData({ ...formData, baseRecipe: newRecipe });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe[matIndex].qty = newQty; setFormData({ ...formData, sizes: newSizes }); }
  };
  const removeMaterial = (matIndex, sizeIndex = null) => {
    if (sizeIndex === null) { setFormData({ ...formData, baseRecipe: formData.baseRecipe.filter((_, i) => i !== matIndex) });
    } else { const newSizes = [...formData.sizes]; newSizes[sizeIndex].recipe = newSizes[sizeIndex].recipe.filter((_, i) => i !== matIndex); setFormData({ ...formData, sizes: newSizes }); }
  };
  const calcRecipeCost = (recipe) => (recipe || []).reduce((sum, item) => sum + (item.qty * item.cost), 0);

  // --- ESTIMATED MENU STOCK CALCULATOR ---
  const getEstimatedStock = (recipe) => {
    if (!recipe || recipe.length === 0) return null; // No recipe means infinite stock
    let minServings = Infinity;
    
    for (let mat of recipe) {
      const invItem = inventory.find(i => i._id === mat.invId);
      if (!invItem) return 0; // If an ingredient is missing entirely, stock is 0
      
      const possibleServings = Math.floor(invItem.stockQty / mat.qty);
      if (possibleServings < minServings) minServings = possibleServings;
    }
    return minServings === Infinity ? 0 : minServings;
  };

  const filteredOrders = orders.filter(o => orderFilter === 'All' ? true : o.status === orderFilter);
  const todayCompleted = orders.filter(o => o.status === 'Completed');
  const todayComplimentary = todayCompleted.filter(o => o.isComplimentary);
  const todayCompAmount = todayComplimentary.reduce((sum, o) => sum + o.subtotal, 0);
  const todayGross = todayCompleted.reduce((sum, o) => sum + o.subtotal, 0); // ALL orders incl. comp (gross stays visible)
  const todayDiscounts = todayCompleted.reduce((sum, o) => o.isComplimentary ? sum + o.subtotal : sum + (o.discount || 0), 0); // comp = 100% discount
  const todayRevenue = todayGross - todayDiscounts; // Net cash-collected (comp cancels out)
  const todayVat = todayCompleted.filter(o => !o.isComplimentary).reduce((sum, o) => sum + o.vatAmount, 0);

  const groupedArchives = archivedOrders.reduce((acc, order) => {
    const date = new Date(order.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (!acc[date]) acc[date] = { orders: [], revenue: 0, vat: 0, discounts: 0 };
    acc[date].orders.push(order);
    if (order.status === 'Completed') {
      acc[date].revenue += order.total; acc[date].vat += order.vatAmount; acc[date].discounts += order.discount;
    }
    return acc;
  }, {});

  const toggleDay = (date) => setExpandedDays(prev => ({ ...prev, [date]: !prev[date] }));
  const toggleOrderList = (date) => setExpandedOrderLists(prev => ({ ...prev, [date]: !prev[date] })); 

  // ==========================================
  // 🔥 ANALYTICS ENGINE 🔥 — memoized so the 1-second countdown doesn't re-run this
  // ==========================================
  const {
    allCompletedOrders, totalAllTimeRevenue, totalAllTimeComplimentary,
    dailyRevenueList, bestDay, topProducts,
    mostUsedStock, lowestStock, highestStock
  } = useMemo(() => {
    const completed = [
      ...orders.filter(o => o.status === 'Completed'),
      ...archivedOrders.filter(o => o.status === 'Completed')
    ];

    // 1. Daily Sales & Best Day
    const dailyRevenueMap = {};
    let totalRev = 0, totalComp = 0;
    completed.forEach(o => {
      const dateStr = new Date(o.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (!dailyRevenueMap[dateStr]) dailyRevenueMap[dateStr] = { net: 0, comp: 0 };
      if (o.isComplimentary) { dailyRevenueMap[dateStr].comp += o.subtotal; totalComp += o.subtotal; }
      else { dailyRevenueMap[dateStr].net += o.total; totalRev += o.total; }
    });
    let best = { date: 'N/A', revenue: 0 };
    const revList = Object.entries(dailyRevenueMap).map(([date, data]) => {
      const revenue = data.net;
      if (revenue > best.revenue) best = { date, revenue };
      return { date, revenue };
    });

    // 2. Top Products
    const productStats = {};
    completed.forEach(o => {
      o.items.forEach(item => {
        const baseName = item.name.replace(/\s*\(.*?\)\s*/g, '').trim();
        if (!productStats[baseName]) productStats[baseName] = { qty: 0, revenue: 0 };
        productStats[baseName].qty += item.quantity;
        productStats[baseName].revenue += (item.price * item.quantity);
      });
    });
    const top5 = Object.entries(productStats).map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.qty - a.qty).slice(0, 5);

    // 3. Raw Material Velocity (Weighted ADU)
    const nowMs = Date.now();
    const MS_DAY = 86400000;
    const orders7d  = completed.filter(o => (nowMs - new Date(o.createdAt).getTime()) <= 7  * MS_DAY);
    const orders30d = completed.filter(o => (nowMs - new Date(o.createdAt).getTime()) <= 30 * MS_DAY);

    let daysElapsed = 1;
    if (completed.length > 0) {
      const ts = completed.map(o => new Date(o.createdAt).getTime());
      daysElapsed = Math.max(1, Math.ceil((Math.max(...ts) - Math.min(...ts)) / MS_DAY));
    }
    const days7  = Math.min(7,  Math.max(1, daysElapsed));
    const days30 = Math.min(30, Math.max(1, daysElapsed));

    const computeIngUsage = (subset) => {
      const usage = {};
      subset.forEach(o => {
        o.items.forEach(orderItem => {
          let product = products.find(p => p._id === orderItem.productId);
          if (!product) {
            const baseName = orderItem.name.replace(/\s*\(.*?\)\s*/g, '').trim();
            product = products.find(p => p.name === baseName);
          }
          if (!product) return;
          let recipe = product.baseRecipe || [];
          const sizeMatch = orderItem.name.match(/\(([^)]+)\)$/);
          if (sizeMatch) {
            const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
            if (sizeObj?.recipe?.length > 0) recipe = sizeObj.recipe;
          }
          recipe.forEach(ing => {
            if (!usage[ing.name]) {
              const invItem = inventory.find(i => i.itemName.toLowerCase() === ing.name.toLowerCase());
              usage[ing.name] = { name: ing.name, qtyUsed: 0, unit: ing.unit, currentStock: invItem ? invItem.stockQty : 0 };
            }
            usage[ing.name].qtyUsed += ing.qty * orderItem.quantity;
          });
        });
      });
      return usage;
    };

    const usage7d  = computeIngUsage(orders7d);
    const usage30d = computeIngUsage(orders30d);

    const rawMaterialUsage = {};
    const allIngNames = new Set([...Object.keys(usage7d), ...Object.keys(usage30d)]);
    allIngNames.forEach(name => {
      const u7 = usage7d[name], u30 = usage30d[name];
      const adu7 = u7 ? u7.qtyUsed / days7 : 0;
      const adu30 = u30 ? u30.qtyUsed / days30 : 0;
      const weightedAdu = adu7 * 0.7 + adu30 * 0.3;
      const trend = adu30 > 0 ? (adu7 - adu30) / adu30 : 0;
      const ref = u7 || u30;
      rawMaterialUsage[name] = { name, unit: ref.unit, currentStock: ref.currentStock, qtyUsed: (u30 || u7).qtyUsed, weightedAdu, adu7, adu30, trend };
    });

    const mostUsed = Object.values(rawMaterialUsage)
      .filter(item => item.weightedAdu > 0).sort((a, b) => b.weightedAdu - a.weightedAdu).slice(0, 5)
      .map(item => {
        const daysLeft = item.weightedAdu > 0 ? item.currentStock / item.weightedAdu : Infinity;
        return { ...item, dailyAvg: item.weightedAdu, daysLeft: isFinite(daysLeft) ? Math.floor(daysLeft) : Infinity, weeklyNeed: Math.ceil(item.weightedAdu * 7), monthlyNeed: Math.ceil(item.weightedAdu * 30), reorderPoint: Math.ceil(item.weightedAdu * 3) };
      });

    const usageEntries = Object.values(rawMaterialUsage);
    const lowest = inventory
      .map(item => { const u = usageEntries.find(e => e.name.toLowerCase() === item.itemName.toLowerCase()); const adu = u ? u.weightedAdu : 0; const daysOfSupply = adu > 0 ? item.stockQty / adu : (item.stockQty <= 0 ? 0 : Infinity); return { ...item, adu, daysOfSupply }; })
      .filter(item => item.daysOfSupply < Infinity).sort((a, b) => a.daysOfSupply - b.daysOfSupply).slice(0, 5);

    const highest = inventory
      .map(item => { const u = usageEntries.find(e => e.name.toLowerCase() === item.itemName.toLowerCase()); const adu = u ? u.weightedAdu : 0; const daysOfSupply = adu > 0 ? item.stockQty / adu : (item.stockQty > 0 ? Infinity : 0); const tiedUpCapital = item.stockQty * (item.unitCost || 0); return { ...item, adu, daysOfSupply, tiedUpCapital }; })
      .filter(item => item.daysOfSupply > 30 && item.stockQty > 0).sort((a, b) => b.tiedUpCapital - a.tiedUpCapital).slice(0, 5);

    return {
      allCompletedOrders: completed, totalAllTimeRevenue: totalRev, totalAllTimeComplimentary: totalComp,
      dailyRevenueList: revList, bestDay: best, topProducts: top5,
      mostUsedStock: mostUsed, lowestStock: lowest, highestStock: highest
    };
  }, [orders, archivedOrders, inventory, products]);

  // ---   KITCHEN & BAR ROUTING LOGIC ---
  const displayOrders = filteredOrders.filter(order => {
    if (departmentFilter === 'Kitchen') return order.items.some(item => (item.department || 'Kitchen') === 'Kitchen');
    if (departmentFilter === 'Bar')     return order.items.some(item => item.department === 'Bar');
    return true;
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-page-bg flex flex-col lg:flex-row">
        <div className="hidden lg:flex lg:w-1/2 bg-surface border-r border-white/5 items-center justify-center">
          <div className="text-center p-12">
            <div className="w-24 h-24 bg-brand/20 border border-brand/30 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-brand/30">
              <Lock size={40} className="text-brand" />
            </div>
            <p className="text-5xl font-black text-brand tracking-tight leading-none mb-3">{BIZ_NAME}</p>
            <p className="text-white/25 font-bold uppercase tracking-[0.3em] text-sm">SEMIVRA LIBELLUS</p>
            <p className="text-white/15 text-xs mt-12 font-medium">Restaurant POS &amp; Management System</p>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
        <form onSubmit={handleSystemLogin} className="bg-sidebar-bg border border-white/10 p-8 rounded-2xl shadow-2xl w-full max-w-sm text-center">
          <div className="lg:hidden w-14 h-14 bg-brand/20 border border-brand/30 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand/20">
            <Lock size={24} className="text-brand" />
          </div>
          <h2 className="text-2xl font-black text-white tracking-widest mb-1 uppercase">System Locked</h2>
          <p className="text-white/40 text-sm mb-6">Enter credentials to begin your shift.</p>

          {loginError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl px-4 py-3 mb-4 text-left">
              <AlertCircle size={14} className="flex-shrink-0" />
              {loginError}
            </div>
          )}

          <input
            type="text"
            aria-label="Staff Name"
            placeholder="Staff Name"
            value={loginForm.name}
            onChange={e => setLoginForm({...loginForm, name: e.target.value})}
            className="w-full bg-white/5 border border-white/10 focus:border-brand focus:ring-2 focus:ring-brand/20 text-white placeholder-white/20 text-center py-3 rounded-xl outline-none mb-3 font-bold transition"
            required
            autoFocus
          />
          <input
            type="password"
            aria-label="Password"
            placeholder="Password"
            value={loginForm.password}
            onChange={e => setLoginForm({...loginForm, password: e.target.value})}
            className="w-full bg-white/5 border border-white/10 focus:border-brand focus:ring-2 focus:ring-brand/20 text-white placeholder-white/20 text-center py-3 rounded-xl outline-none mb-3 font-bold tracking-widest transition"
            required
          />
          <div className="relative mb-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-brand font-black text-lg pointer-events-none">₱</span>
            <input
              type="number"
              aria-label="Starting Cash in Philippine Pesos"
              placeholder="Starting Cash"
              min="0"
              step="0.01"
              value={startingCash}
              onChange={e => setStartingCash(e.target.value)}
              className="w-full bg-white/5 border border-brand/30 focus:border-brand text-white text-center py-3 pl-8 rounded-xl outline-none font-black text-lg transition"
            />
          </div>
          <p className="text-white/25 text-xs mb-5 text-center font-medium">
            Required for staff · Optional for Superadmin
          </p>
          <button type="submit" className="w-full bg-brand hover:bg-brand-dark text-white font-black py-4 rounded-xl transition shadow-lg shadow-brand/20 uppercase tracking-widest">
            Start Shift
          </button>
        </form>
        </div>
      </div>
    );
  }

  // --- PAGINATION MATH ---
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  
  // Only grab the 12 items for the current page
  const currentProducts = products.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(products.length / itemsPerPage);

  // --- INVENTORY PAGINATION MATH ---
  const indexOfLastInv = invPage * invItemsPerPage;
  const indexOfFirstInv = indexOfLastInv - invItemsPerPage;
  const currentInventory = inventory.slice(indexOfFirstInv, indexOfLastInv);
  const totalInvPages = Math.ceil(inventory.length / invItemsPerPage);

  // --- ORDERS PAGINATION MATH ---
  const indexOfLastOrder = ordersPage * ordersItemsPerPage;
  const indexOfFirstOrder = indexOfLastOrder - ordersItemsPerPage;
  const currentOrders = displayOrders.slice(indexOfFirstOrder, indexOfLastOrder);
  const totalOrdersPages = Math.ceil(displayOrders.length / ordersItemsPerPage);

  // --- ACCOUNTING PAGINATION MATH ---
  const indexOfLastEntry = accountingPage * accountingItemsPerPage;
  const indexOfFirstEntry = indexOfLastEntry - accountingItemsPerPage;

  const currentEntries = journalEntries.slice(indexOfFirstEntry, indexOfLastEntry);
  const totalAccountingPages = Math.ceil(journalEntries.length / accountingItemsPerPage);

  // --- PRICING PAGINATION MATH ---
  const indexOfLastPricing = pricingPage * pricingItemsPerPage;
  const indexOfFirstPricing = indexOfLastPricing - pricingItemsPerPage;
  const currentPricingProducts = products.slice(indexOfFirstPricing, indexOfLastPricing);
  const totalPricingPages = Math.ceil(products.length / pricingItemsPerPage);

  const isSuperAdmin = activeAdmin?.role === 'superadmin';

  // Sidebar nav content (inlined twice: desktop + mobile)
  const renderSidebarNav = (closeFn) => (
    <>
      {/* Brand */}
      <div
        className="p-5 border-b border-white/5 cursor-pointer group"
        onClick={() => {
          if (navMode === 'libellus') {
            if (!isSuperAdmin) return alert('Access Denied: Management view is restricted to Superadmin.');
            setNavMode('negotium'); setActiveTab('history');
          } else {
            setNavMode('libellus'); setActiveTab('orders');
          }
          closeFn?.();
        }}
      >
        <p className="text-2xl font-black text-brand group-hover:text-brand-dark transition tracking-tight leading-none drop-shadow-sm">{BIZ_NAME}</p>
        <p className="text-[10px] text-white/25 font-bold uppercase tracking-[0.25em] mt-0.5">
          SEMIVRA <span className="text-brand/80">{navMode === 'libellus' ? 'LIBELLUS' : 'NEGOTIUM'}</span>
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <p className="text-[9px] text-white/20 font-bold uppercase tracking-[0.2em] px-4 pt-2 pb-1">Operations</p>
        {[
          { id: 'orders', label: 'Live Orders', icon: ShoppingCart },
          { id: 'inventory', label: 'Inventory', icon: Package },
          { id: 'products', label: 'Menu Setup', icon: Settings },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id}
            onClick={() => { setActiveTab(id); setNavMode('libellus'); closeFn?.(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition font-bold text-sm
              ${activeTab === id && navMode === 'libellus' ? 'bg-brand text-white shadow-sm' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
          >
            <Icon size={16} />
            {label}
            {activeTab === id && navMode === 'libellus' && <ChevronRight size={13} className="ml-auto" />}
          </button>
        ))}

        <p className="text-[9px] text-white/20 font-bold uppercase tracking-[0.2em] px-4 pt-4 pb-1">Management</p>
        {isSuperAdmin ? (
          [
            { id: 'history', label: 'History', icon: Clock },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 },
            { id: 'ledger', label: 'Accounting', icon: FileText },
            { id: 'pricing', label: 'Pricing', icon: DollarSign },
            { id: 'audit', label: 'Audit Report', icon: ShieldCheck },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id}
              onClick={() => { setActiveTab(id); setNavMode('negotium'); closeFn?.(); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition font-bold text-sm
                ${activeTab === id && navMode === 'negotium' ? 'bg-brand text-white shadow-sm' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
            >
              <Icon size={16} />
              {label}
              {activeTab === id && navMode === 'negotium' && <ChevronRight size={13} className="ml-auto" />}
            </button>
          ))
        ) : (
          <div className="flex items-center gap-2 px-4 py-2.5 text-red-400/50">
            <Lock size={13} />
            <span className="text-xs font-bold uppercase tracking-wider">Superadmin Only</span>
          </div>
        )}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-white/5 space-y-0.5">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-[10px] text-white/25 font-bold uppercase tracking-wider">Auto-Close</span>
          <MidnightCountdown />
        </div>
        <button onClick={toggleFullScreen} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition font-bold text-sm">
          {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
        <button onClick={e => { e.preventDefault(); handleShowQR(); closeFn?.(); }} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-brand/60 hover:text-brand hover:bg-brand/10 transition font-bold text-sm">
          <QrCode size={15} />
          Show QR
        </button>
        <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition font-bold text-sm">
          <LogOut size={15} />
          End Shift
        </button>
        <div className="px-3 py-2 border-t border-white/5 mt-1">
          <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
            <div className="w-8 h-8 rounded-lg bg-brand/20 border border-brand/30 flex items-center justify-center flex-shrink-0">
              <span className="text-brand font-black text-xs">{activeAdmin?.name?.charAt(0)?.toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <p className="text-white/60 text-xs font-bold truncate">{activeAdmin?.name}</p>
              <p className="text-white/25 text-[10px] uppercase tracking-widest">{activeAdmin?.role}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-page-bg flex text-white">

      {/* Mobile overlay */}
      {dashDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setDashDrawerOpen(false)} />
      )}

      {/* Mobile drawer */}
      <aside className={`lg:hidden fixed top-0 left-0 h-full w-64 bg-sidebar-bg z-50 flex flex-col border-r border-white/5 transition-transform duration-300 ${dashDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {renderSidebarNav(() => setDashDrawerOpen(false))}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-sidebar-bg border-r border-white/5 h-screen sticky top-0 overflow-y-auto">
        {renderSidebarNav()}
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 h-16 bg-sidebar-bg border-b border-white/5 flex-shrink-0">
          <button
            onClick={() => setDashDrawerOpen(true)}
            className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition"
            aria-label={dashDrawerOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={dashDrawerOpen}
          >
            <Menu size={21} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-black text-white text-sm uppercase tracking-widest truncate">{BIZ_NAME}</p>
            <p className="text-brand text-[10px] font-bold uppercase truncate">{activeAdmin?.name} · {navMode === 'libellus' ? 'Operations' : 'Management'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={e => { e.preventDefault(); handleShowQR(); }} className="flex items-center gap-1.5 bg-brand/20 text-brand border border-brand/30 px-3 py-2 rounded-xl font-bold text-xs hover:bg-brand/30 transition">
              <QrCode size={13} /> QR
            </button>
            <button onClick={handleLogout} className="flex items-center gap-1.5 bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-2 rounded-xl font-bold text-xs hover:bg-red-500/20 transition">
              End Shift
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 p-4 lg:p-6">

      {/* QR MODAL (Fixed z-index and flex shrinking issues) */}
      {showQR && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-6 md:p-8 rounded-xl border border-gray-700 shadow-2xl flex flex-col items-center max-w-sm w-full relative max-h-[95vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setShowQR(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white font-bold text-2xl shrink-0">✕</button>
            <h2 className="text-2xl font-bold mb-1 text-white shrink-0">Customer QR</h2>
            <div className="bg-dark px-6 py-2 rounded-full border border-gray-700 mb-6 mt-2 flex items-center gap-2 shrink-0">
              <span className="text-gray-400 text-sm font-bold uppercase tracking-wider">Session ID:</span>
              <span className="text-accent font-black text-lg">{autoTableId}</span>
            </div>
            
            {/* FIX: Added shrink-0, p-4, and removed overflow-hidden so the QR never gets squished! */}
            <div className="bg-white rounded-xl shadow-inner w-full flex justify-center items-center p-4 shrink-0 min-h-[250px]">
              <QRCode 
                value={`${FRONTEND_URL}/menu/${autoTableId}?session=${qrSessionId}`} 
                size={200} 
              />
            </div>
            
            <button 
              onClick={(e) => { e.preventDefault(); handleShowQR(); }} 
              className="mt-6 w-full bg-surface border border-accent text-accent font-bold py-3 rounded-md hover:bg-accent hover:text-dark transition uppercase tracking-widest text-sm shrink-0"
            >
              Generate Next QR
            </button>
            <button 
              onClick={() => setShowQR(false)} 
              className="mt-3 w-full bg-dark border border-gray-600 text-accent font-bold py-3 rounded-md hover:bg-accent hover:text-dark transition text-sm shrink-0"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ============================================================
          END-OF-SHIFT RECONCILIATION MODAL
          ============================================================ */}
      {shiftEndModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface border border-gray-700 rounded-2xl shadow-2xl max-w-sm w-full p-8 flex flex-col gap-5">

            {shiftReconcile.result ? (
              /* ── RESULTS SCREEN ── */
              <>
                <div className="text-center">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${shiftReconcile.result.variance >= 0 ? 'bg-green-500/20 border border-green-500/40' : 'bg-red-500/20 border border-red-500/40'}`}>
                    {shiftReconcile.result.variance >= 0
                      ? <CheckCircle size={32} className="text-green-400" />
                      : <AlertCircle size={32} className="text-red-400" />}
                  </div>
                  <h2 className="text-xl font-black text-white tracking-wider uppercase">Shift Summary</h2>
                  <p className="text-gray-400 text-xs mt-1">Recorded for {shiftReconcile.result.cashierName}</p>
                </div>

                <div className="bg-surface-2 rounded-xl p-4 space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">Opening Cash</span><span className="font-bold text-white">₱{(shiftReconcile.result.startingCash||0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Cash Sales</span><span className="font-bold text-accent">+₱{(shiftReconcile.result.salesTotal||0).toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-gray-700 pt-3"><span className="text-gray-400">Expected in Register</span><span className="font-black text-white text-base">₱{(shiftReconcile.result.expectedCash||0).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Actual Cash Count</span><span className="font-black text-white text-base">₱{(shiftReconcile.result.actualCash||0).toFixed(2)}</span></div>
                  <div className={`flex justify-between pt-1 border-t border-gray-700 font-black text-base ${shiftReconcile.result.variance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    <span>Variance</span>
                    <span>{shiftReconcile.result.variance >= 0 ? '+' : ''}₱{(shiftReconcile.result.variance||0).toFixed(2)}</span>
                  </div>
                </div>

                {shiftReconcile.result.variance < 0 && (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-xl px-4 py-3 text-xs text-red-300 font-medium">
                    Short by ₱{Math.abs(shiftReconcile.result.variance).toFixed(2)} — report to manager before leaving.
                  </div>
                )}

                {/* ── BANK DEPOSIT ── */}
                {shiftReconcile.result.isReconciled ? (
                  <div className="bg-green-900/20 border border-green-500/30 rounded-xl px-4 py-3 text-xs text-green-300 font-bold text-center flex items-center justify-center gap-2">
                    <CheckCircle size={14} /> Drawer Reconciled — cash matches starting fund.
                  </div>
                ) : (
                  <div className="bg-surface-2 rounded-xl p-4 space-y-3 text-sm border border-blue-500/20">
                    <h3 className="text-blue-400 font-black uppercase tracking-wider text-xs flex items-center gap-2">
                      <Building2 size={14} /> Bank Deposit
                    </h3>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Cash on Hand</span>
                        <span className="font-bold text-white">₱{Math.max(0, (shiftReconcile.result.actualCash || 0) - (shiftReconcile.result.depositedAmount || 0)).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Keep in Drawer</span>
                        <span className="font-bold text-white">₱{(shiftReconcile.result.startingCash || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-700 pt-1">
                        <span className="text-gray-400">Suggested Deposit</span>
                        <span className="font-bold text-blue-400">₱{Math.max(0, (shiftReconcile.result.actualCash || 0) - (shiftReconcile.result.depositedAmount || 0) - (shiftReconcile.result.startingCash || 0)).toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-400 font-black pointer-events-none">₱</span>
                      <input
                        type="number" min="0" step="0.01" placeholder="Deposit amount"
                        value={depositAmount}
                        onChange={e => { setDepositAmount(e.target.value); setDepositError(''); }}
                        className="w-full bg-gray-800 border-2 border-blue-500/50 focus:border-blue-400 text-white py-2.5 pl-8 pr-4 rounded-xl outline-none font-bold text-sm"
                      />
                    </div>
                    {depositError && <p className="text-red-400 text-xs">{depositError}</p>}
                    <button
                      onClick={handleBankDeposit}
                      disabled={depositLoading || !depositAmount}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-3 rounded-xl uppercase tracking-wider transition disabled:opacity-50 text-sm"
                    >
                      {depositLoading ? 'Posting…' : 'Post Bank Deposit'}
                    </button>
                  </div>
                )}

                <button
                  onClick={performLogout}
                  className="w-full bg-accent text-white font-black py-4 rounded-xl uppercase tracking-widest hover:bg-brand-dark transition"
                >
                  Confirm & Log Out
                </button>
              </>
            ) : (
              /* ── COUNT SCREEN ── */
              <>
                <div className="text-center">
                  <div className="w-14 h-14 bg-accent/10 border border-accent/30 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <DollarSign size={26} className="text-accent" />
                  </div>
                  <h2 className="text-xl font-black text-white tracking-wider uppercase">End of Shift</h2>
                  <p className="text-gray-400 text-sm mt-1">Count your register before logging out.</p>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Actual Cash in Register</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-accent font-black text-lg pointer-events-none">₱</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={shiftReconcile.actualCash}
                      onChange={e => setShiftReconcile(prev => ({ ...prev, actualCash: e.target.value }))}
                      className="w-full bg-surface-2 border-2 border-brand/40 focus:border-brand text-center text-white py-3 pl-8 rounded-xl outline-none font-black text-xl"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShiftEndModal(false)}
                    className="flex-1 py-3 bg-surface-2 border border-white/10 text-white/50 font-bold rounded-xl hover:text-white transition text-sm uppercase"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleEndShift}
                    disabled={shiftEndLoading}
                    className="flex-1 py-3 bg-accent text-white font-black rounded-xl hover:bg-brand-dark transition text-sm uppercase tracking-wider disabled:opacity-60"
                  >
                    {shiftEndLoading ? 'Processing...' : 'Submit Count'}
                  </button>
                </div>

                <button
                  onClick={performLogout}
                  className="text-xs text-gray-600 hover:text-red-400 transition text-center w-full"
                >
                  Skip & force logout (emergency only)
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* --- ANALYTICS DASHBOARD TAB --- */}
      {activeTab === 'analytics' && (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto animate-fade-in">
          
          {/* TOP ROW: High-Level Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-brand-dark border border-brand/20 rounded-xl p-6 shadow-lg shadow-brand/5 flex flex-col justify-center">
              <p className="text-white/70 text-xs font-bold uppercase tracking-wider mb-1">Net Revenue (All-Time)</p>
              <p className="text-4xl font-black text-white mb-1">P{totalAllTimeRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="text-sm text-white/80 font-medium">{allCompletedOrders.length} completed orders</p>
              {totalAllTimeComplimentary > 0 && <p className="text-xs text-white/50 font-semibold mt-1">+P{totalAllTimeComplimentary.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} complimentary (excluded)</p>}
            </div>
            
            <div className="bg-surface border border-gray-800 rounded-xl p-6 flex flex-col justify-center">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Best Sales Day</p>
              <p className="text-3xl font-black text-white mb-2">{bestDay.date}</p>
              <p className="text-sm text-green-400 font-bold uppercase tracking-widest">P{bestDay.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Earned</p>
            </div>

            <div className="bg-surface border border-gray-800 rounded-xl p-6 overflow-hidden relative">
              <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-4">Top 5 Best Sellers</h3>
              <div className="space-y-3 relative z-10">
                {topProducts.length === 0 ? (
                  <p className="text-gray-600 text-sm italic">No sales data yet.</p>
                ) : topProducts.map((p, i) => (
                  <div key={i} className="flex justify-between items-center text-sm">
                    <span className="font-bold text-gray-200 truncate pr-4">#{i+1} {p.name}</span>
                    <span className="text-accent font-black bg-accent/10 px-2 py-0.5 rounded">{p.qty}x</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* INVENTORY VALUE CARD */}
          {(() => {
            const totalInventoryValue = inventory.reduce((sum, item) => sum + (item.stockQty * (item.unitCost || 0)), 0);
            const totalSkus = inventory.length;
            const zeroStockCount = inventory.filter(i => i.stockQty <= 0).length;
            return (
              <div className="bg-surface border border-white/8 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-10">
                <div className="flex-1">
                  <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Total Inventory Value</p>
                  <p className="text-3xl font-black text-white">₱{totalInventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  <p className="text-white/30 text-xs font-medium mt-1">Cost of all stock on hand</p>
                </div>
                <div className="flex gap-6 sm:gap-10 shrink-0">
                  <div className="flex flex-col items-center">
                    <p className="text-2xl font-black text-white">{totalSkus}</p>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mt-0.5">SKUs Tracked</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <p className={`text-2xl font-black ${zeroStockCount > 0 ? 'text-red-400' : 'text-green-400'}`}>{zeroStockCount}</p>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mt-0.5">Out of Stock</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <p className="text-2xl font-black text-white">
                      ₱{totalSkus > 0 ? (totalInventoryValue / totalSkus).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                    </p>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider mt-0.5">Avg / SKU</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* BOTTOM ROW: Daily Trend & Stock Movement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Daily Sales List */}
            <div className="bg-surface border border-gray-800 rounded-xl p-6 flex flex-col max-h-96">
              <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
                <h3 className="text-white font-bold">Daily Revenue Trend</h3>
                <button onClick={exportAnalyticsToPDF} className="text-[10px] bg-brand/10 border border-brand/30 text-brand px-3 py-1.5 rounded hover:bg-brand hover:text-page-bg transition font-bold uppercase tracking-wider">
                  Export Trend
                </button>
              </div>
              <div className="overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700 flex-1 space-y-2">
                {dailyRevenueList.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-4">No daily data available.</p>
                ) : [...dailyRevenueList].reverse().map((day, i) => {
                  const percentageOfBest = (day.revenue / bestDay.revenue) * 100;
                  return (
                    <div key={i} className="flex flex-col mb-3">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-300 font-semibold">{day.date}</span>
                        <span className="text-white font-bold">P{day.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="w-full bg-dark rounded-full h-2">
                        <div className={`h-2 rounded-full ${day.revenue === bestDay.revenue ? 'bg-accent' : 'bg-gray-600'}`} style={{ width: `${percentageOfBest}%` }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Inventory Alerts & Velocity */}
            <div className="grid grid-cols-1 gap-4">
              {/* --- High Velocity & Forecast (Weighted ADU Algorithm) --- */}
              <div className="bg-surface border border-accent/30 rounded-xl p-5 flex flex-col shadow-lg shadow-accent/5">
                <h3 className="text-accent text-sm font-bold uppercase tracking-wider mb-4 border-b border-accent/20 pb-2 flex items-center gap-2">
                  <Zap size={14} className="text-accent" /> High Velocity & Forecast
                </h3>
                <div className="space-y-4">
                  {mostUsedStock.length === 0 ? (
                    <p className="text-gray-600 text-xs">No sales data yet — complete orders to populate.</p>
                  ) : mostUsedStock.map((item, idx) => (
                    <div key={idx} className="flex flex-col border-b border-accent/10 pb-3 last:border-0 last:pb-0">
                      {/* Name + trend badge */}
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-gray-200 font-bold text-sm truncate pr-2">{item.name}</span>
                        <span className={`flex items-center gap-0.5 text-[10px] font-black px-2 py-0.5 rounded ${item.trend > 0.1 ? 'bg-red-900/40 text-red-400' : item.trend < -0.1 ? 'bg-green-900/30 text-green-400' : 'bg-accent/10 text-accent'}`}>
                          {item.trend > 0.1 ? <ArrowUp size={10} /> : item.trend < -0.1 ? <ArrowDown size={10} /> : null}
                          {Math.abs(item.trend * 100).toFixed(0)}% {item.trend > 0.1 ? 'rising' : item.trend < -0.1 ? 'easing' : 'stable'}
                        </span>
                      </div>
                      {/* Metrics grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        <div className="bg-dark p-2 rounded flex flex-col items-center border border-gray-800/50">
                          <p className="text-[8px] text-gray-500 uppercase font-bold tracking-widest mb-1 text-center leading-tight">Daily Burn</p>
                          <p className="text-xs font-black text-black">{item.dailyAvg.toFixed(2)}<span className="text-[9px] text-gray-500 ml-0.5">{item.unit}</span></p>
                        </div>
                        <div className="bg-dark p-2 rounded flex flex-col items-center border border-gray-800/50">
                          <p className="text-[8px] text-gray-500 uppercase font-bold tracking-widest mb-1 text-center leading-tight">Lasts</p>
                          <p className={`text-xs font-black ${item.daysLeft <= 3 ? 'text-red-600 animate-pulse' : item.daysLeft <= 7 ? 'text-yellow-600' : 'text-green-700'}`}>
                            {item.daysLeft === Infinity || isNaN(item.daysLeft) ? '∞' : `${item.daysLeft}d`}
                          </p>
                        </div>
                        <div className="bg-dark p-2 rounded flex flex-col items-center border border-gray-800/50">
                          <p className="text-[8px] text-gray-500 uppercase font-bold tracking-widest mb-1 text-center leading-tight">Buy 1wk</p>
                          <p className="text-xs font-bold text-black">{item.weeklyNeed.toLocaleString()}<span className="text-[9px] text-gray-500 ml-0.5">{item.unit}</span></p>
                        </div>
                        <div className="bg-dark p-2 rounded flex flex-col items-center border border-gray-800/50">
                          <p className="text-[8px] text-gray-500 uppercase font-bold tracking-widest mb-1 text-center leading-tight">Buy 1mo</p>
                          <p className="text-xs font-bold text-black">{item.monthlyNeed.toLocaleString()}<span className="text-[9px] text-gray-500 ml-0.5">{item.unit}</span></p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Low Stock — days of supply, not raw qty */}
                <div className="bg-surface border border-red-900/30 rounded-xl p-5 flex flex-col">
                  <h3 className="text-red-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-red-900/30 pb-2 flex items-center gap-2">
                    <AlertTriangle size={13} className="text-red-400" /> Low Stock (Risk)
                  </h3>
                  <div className="space-y-3">
                    {lowestStock.length === 0 ? (
                      <p className="text-gray-600 text-xs">All tracked items have adequate supply.</p>
                    ) : lowestStock.map(item => (
                      <div key={item._id} className="flex justify-between items-center text-sm">
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-gray-300 truncate font-semibold">{item.itemName}</span>
                          <span className="text-gray-600 text-[10px]">{item.stockQty.toFixed(2)} {item.unit} left</span>
                        </div>
                        <span className={`font-black text-xs whitespace-nowrap px-2 py-1 rounded ${item.daysOfSupply <= 3 ? 'bg-red-900/40 text-red-400 animate-pulse' : item.daysOfSupply <= 7 ? 'bg-yellow-900/30 text-yellow-400' : 'bg-orange-900/20 text-orange-400'}`}>
                          {item.daysOfSupply <= 0 ? 'OUT' : `~${Math.floor(item.daysOfSupply)}d left`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Overstock — capital tied up, not raw qty */}
                <div className="bg-surface border border-gray-800 rounded-xl p-5 flex flex-col">
                  <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-gray-800 pb-2 flex items-center gap-2">
                    <BarChart2 size={13} /> Overstock Watch
                  </h3>
                  <div className="space-y-3">
                    {highestStock.length === 0 ? (
                      <p className="text-gray-600 text-xs">No items exceed 30 days of supply.</p>
                    ) : highestStock.map(item => (
                      <div key={item._id} className="flex justify-between items-center text-sm">
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="text-gray-300 truncate font-semibold">{item.itemName}</span>
                          <span className="text-gray-600 text-[10px]">{item.stockQty.toFixed(2)} {item.unit}</span>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-gray-400 font-bold text-xs whitespace-nowrap">
                            {isFinite(item.daysOfSupply) ? `~${Math.floor(item.daysOfSupply)}d supply` : '∞ supply'}
                          </span>
                          {item.tiedUpCapital > 0 && (
                            <span className="text-orange-400 text-[10px] font-mono">₱{item.tiedUpCapital.toFixed(0)} tied</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- ACTIVE ORDERS TAB (Kitchen & Bar View) --- */}
      {/* --- ACTIVE ORDERS TAB (Kitchen & Bar View) --- */}
      {activeTab === 'orders' && (() => {
        // ---   KITCHEN & BAR ROUTING LOGIC ---
        const displayOrders = filteredOrders.filter(order => {
          if (departmentFilter === 'Kitchen') {
            return order.items.some(item => (item.department || 'Kitchen') === 'Kitchen');
          }
          if (departmentFilter === 'Bar') {
            return order.items.some(item => item.department === 'Bar');
          }
          return true;
        });

        return (
          <div className="w-full">
            {isPosOpen ? (
              /* ========================================== */
              /* 🛒 INLINE MANUAL CASHIER POS 🛒            */
              /* ========================================== */
              <div className="flex flex-col lg:flex-row gap-6 h-auto lg:h-[calc(100vh-180px)] w-full animate-fade-in">
                
                {/* LEFT: Product Grid */}
                <div className="flex-1 flex flex-col min-h-[500px] lg:min-h-0 bg-surface border border-gray-800 rounded-xl overflow-hidden shadow-lg">
                  <div className="p-4 border-b border-gray-800 bg-dark shadow-sm shrink-0 flex justify-between items-center">
                    <h2 className="text-xl font-black text-accent tracking-widest uppercase flex items-center">
                      <ShoppingCart size={20} className="mr-2 text-accent" /> POS Register
                    </h2>
                    <button onClick={() => setIsPosOpen(false)} className="text-red-500 hover:text-white font-bold px-4 py-2 bg-red-900/20 hover:bg-red-600 rounded uppercase text-xs tracking-wider transition flex items-center gap-1">
                      <ChevronLeft size={14} /> Back to Orders
                    </button>
                  </div>
                  
                  <div className="p-3 border-b border-gray-800 bg-dark/50 flex gap-2 overflow-x-auto custom-scrollbar shrink-0">
                    <button onClick={() => { setPosCategory('All'); setPosPage(1); }} className={`px-4 py-2 rounded font-bold whitespace-nowrap text-xs uppercase tracking-wider transition ${posCategory === 'All' ? 'bg-accent text-dark' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>All</button>
                    {categories.map(c => (
                      <button key={c._id} onClick={() => { setPosCategory(c.name); setPosPage(1); }} className={`px-4 py-2 rounded font-bold whitespace-nowrap text-xs uppercase tracking-wider transition ${posCategory === c.name ? 'bg-accent text-dark' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{c.name}</button>
                    ))}
                  </div>

                  {(() => {
                    const posFiltered = products.filter(p => posCategory === 'All' || p.category === posCategory);
                    const posTotalPages = Math.ceil(posFiltered.length / POS_PER_PAGE);
                    const posPaged = posFiltered.slice((posPage - 1) * POS_PER_PAGE, posPage * POS_PER_PAGE);
                    return (
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 content-start custom-scrollbar">
                          {posPaged.map(p => (
                            <button
                              key={p._id}
                              onClick={() => openProductModal(p)}
                              className="bg-dark border border-gray-700 rounded-xl p-3 flex flex-col items-center text-center hover:border-accent hover:bg-white/5 transition shadow-sm group"
                            >
                              {p.image ? (
                                <img src={p.image} className="w-16 h-16 object-cover rounded-lg mb-2 group-hover:scale-105 transition-transform" />
                              ) : (
                                <div className="w-16 h-16 bg-gray-800 rounded-lg mb-2 flex items-center justify-center text-xs text-gray-500">No Img</div>
                              )}
                              <span className="font-bold text-sm text-black line-clamp-2 leading-tight w-full">{p.name}</span>
                              <span className="text-accent font-black mt-auto pt-1 text-sm">₱{Number(p.basePrice || p.price || 0).toFixed(2)}</span>
                            </button>
                          ))}
                        </div>
                        {posTotalPages > 1 && (
                          <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-gray-800 bg-dark/50">
                            <button
                              onClick={() => setPosPage(p => Math.max(1, p - 1))}
                              disabled={posPage === 1}
                              className="px-3 py-1.5 rounded font-bold text-xs uppercase tracking-wider bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition flex items-center gap-1"
                            >
                              <ChevronLeft size={14} /> Prev
                            </button>
                            <span className="text-xs text-gray-400 font-bold">Page {posPage} / {posTotalPages}</span>
                            <button
                              onClick={() => setPosPage(p => Math.min(posTotalPages, p + 1))}
                              disabled={posPage === posTotalPages}
                              className="px-3 py-1.5 rounded font-bold text-xs uppercase tracking-wider bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition flex items-center gap-1"
                            >
                              Next <ChevronRight size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* RIGHT: Cart & Checkout */}
                <div className="w-full lg:w-96 flex flex-col shrink-0 h-[500px] lg:h-full bg-surface border border-gray-800 rounded-xl overflow-hidden shadow-lg min-h-0">
                  <div className="p-4 border-b border-gray-800 bg-dark shrink-0">
                    <input type="text" placeholder="Customer / Driver Name" value={posCustomerName} onChange={e => setPosCustomerName(e.target.value)} className="w-full bg-dark border border-gray-700 p-2.5 rounded-lg text-black font-bold mb-3 outline-none focus:border-accent text-sm" />
                    <div className="flex gap-2">
                      {/* FIX: Removed the Payment Dropdown. Now it just takes the Table/Delivery type! */}
                      <select value={posTable} onChange={e => setPosTable(e.target.value)} className="w-full bg-dark border border-gray-700 p-2 rounded-lg text-xs font-bold text-black outline-none">
                        <option value="Takeout">Takeout</option>
                        <option value="Grab Delivery">Grab Delivery</option>
                        <option value="Foodpanda">Foodpanda</option>
                        <option value="Manual Delivery">Manual/Direct</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar bg-dark/30">
                    {posCart.length === 0 ? (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-white font-bold uppercase tracking-widest text-xs">Cart is Empty</p>
                      </div>
                    ) : posCart.map((item, idx) => {
                      const addOnTotal = item.selectedAddOns.reduce((s, a) => s + Number(a.price), 0);
                      const lineTotal = (item.price + addOnTotal) * item.quantity;
                      return (
                        <div key={idx} className="bg-surface p-3 rounded-lg border border-gray-800 flex justify-between items-start shadow-sm">
                          <div className="flex-1 pr-2 min-w-0">
                            <p className="font-bold text-white text-sm truncate">{item.name}</p>
                            {item.selectedAddOns.map((a, i) => <p key={i} className="text-[10px] text-gray-400 truncate">+ {a.name} (₱{a.price})</p>)}
                            <div className="flex items-center gap-2 mt-2">
                              <button onClick={() => setPosCart(posCart.map((c, i) => i === idx ? {...c, quantity: Math.max(1, c.quantity - 1)} : c))} className="w-6 h-6 bg-gray-800 hover:bg-gray-700 rounded text-white font-bold flex items-center justify-center transition">-</button>
                              <span className="font-black text-sm w-6 text-center">{item.quantity}</span>
                              <button onClick={() => setPosCart(posCart.map((c, i) => i === idx ? {...c, quantity: c.quantity + 1} : c))} className="w-6 h-6 bg-gray-800 hover:bg-gray-700 rounded text-white font-bold flex items-center justify-center transition">+</button>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <p className="font-black text-accent text-sm">₱{lineTotal.toFixed(2)}</p>
                            <button onClick={() => setPosCart(posCart.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-400 p-1 bg-red-900/10 rounded mt-1"><Trash2 size={14}/></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-4 border-t border-gray-800 bg-dark shrink-0 z-10">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-gray-400 font-bold uppercase tracking-widest text-xs">Total</span>
                      <span className="text-2xl font-black text-black">
                        ₱{posCart.reduce((sum, item) => sum + ((item.price + item.selectedAddOns.reduce((s, a)=>s+Number(a.price), 0)) * item.quantity), 0).toFixed(2)}
                      </span>
                    </div>
                    <button onClick={submitManualOrder} className="w-full py-4 bg-accent text-dark font-black rounded-xl uppercase tracking-widest text-xs hover:bg-black transition shadow-lg shadow-accent/20">
                      Submit Order
                    </button>
                  </div>
                </div>

                {/* OPTIONS MODAL (Still an overlay so it dims the screen) */}
                {posSelectedProduct && (
                  <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-surface p-6 rounded-xl border border-gray-700 max-w-sm w-full shadow-2xl flex flex-col max-h-[90vh]">
                      
                      <div className="shrink-0 mb-4 border-b border-gray-800 pb-4">
                        <h3 className="text-2xl font-black text-white leading-tight">{posSelectedProduct.name}</h3>
                        <p className="text-xs text-gray-400 uppercase tracking-widest mt-1">Configure Options</p>
                      </div>
                      
                      <div className="overflow-y-auto custom-scrollbar flex-1 pr-2 pb-2">
                        
                        {/* --- SIZES (Now ALWAYS shows, even if only 1 size exists) --- */}
                        <div className="mb-6">
                          <label className="text-xs font-bold text-gray-400 mb-2 block uppercase tracking-wider">Size Selection</label>
                          <div className="grid grid-cols-2 gap-3">
                            {/* FIX: Now correctly displays the Base Price instead of +P0 */}
                            <button onClick={() => setPosActiveSize(null)} className={`py-3 rounded-lg font-bold text-sm border transition ${posActiveSize === null ? 'bg-accent/20 border-accent text-accent' : 'bg-dark border-gray-700 text-black hover:border-gray-500'}`}>
                              {posSelectedProduct.baseSize || 'Regular'} <span className="block text-xs mt-1 opacity-70">₱{Number(posSelectedProduct.basePrice || posSelectedProduct.price || 0).toFixed(2)}</span>
                            </button>
                            {(posSelectedProduct.sizes || []).map((s, idx) => (
                              <button key={idx} onClick={() => setPosActiveSize(idx)} className={`py-3 rounded-lg font-bold text-sm border transition ${posActiveSize === idx ? 'bg-accent/20 border-accent text-accent' : 'bg-dark border-gray-700 text-black hover:border-gray-500'}`}>
                                {s.name} <span className="block text-xs mt-1 opacity-70">₱{Number(s.price).toFixed(2)}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* --- EXTRAS --- */}
                        {(posSelectedProduct.addOns?.length > 0) && (
                          <div>
                            <label className="text-xs font-bold text-gray-400 mb-2 block uppercase tracking-wider">Add Extras</label>
                            <div className="space-y-3">
                              {(posSelectedProduct.addOns || []).map((addon, idx) => {
                                const isSelected = posActiveAddOns.some(a => a.name === addon.name);
                                return (
                                  <label key={idx} className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition ${isSelected ? 'bg-accent/10 border-accent/50' : 'bg-dark border-gray-700 hover:bg-gray-800'}`}>
                                    <div className="flex items-center gap-3">
                                      <input type="checkbox" checked={isSelected} onChange={(e) => {
                                        if (e.target.checked) setPosActiveAddOns([...posActiveAddOns, { name: addon.name, price: addon.price }]);
                                        else setPosActiveAddOns(posActiveAddOns.filter(a => a.name !== addon.name));
                                      }} className="w-5 h-5 accent-accent rounded" />
                                      <span className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-black'}`}>{addon.name}</span>
                                    </div>
                                    <span className="text-xs text-accent font-black">+₱{addon.price}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-3 mt-4 pt-4 border-t border-gray-800 shrink-0">
                        <button onClick={() => setPosSelectedProduct(null)} className="flex-1 py-4 bg-dark border border-gray-700 text-black hover:text-accent font-bold rounded-xl uppercase tracking-wider text-xs transition">Cancel</button>
                        <button onClick={confirmPosItem} className="flex-1 py-4 bg-accent text-dark hover:bg-white font-black rounded-xl uppercase tracking-wider text-xs shadow-lg shadow-accent/20 transition">Add to Cart</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ========================================== */
              /* 📋 STANDARD ORDERS GRID 📋                 */
              /* ========================================== */
              <>
                <div className="flex justify-between items-center mb-6 bg-surface-2 p-3 rounded-xl border border-white/10 shadow-sm relative flex-wrap gap-4">
                  <div className="flex gap-2 overflow-x-auto">
                    {['All', 'Kitchen', 'Bar'].map(dept => (
                      <button 
                        key={dept} 
                        onClick={() => setDepartmentFilter(dept)} 
                        className={`px-6 py-2 rounded-lg text-sm font-black uppercase tracking-widest transition whitespace-nowrap ${departmentFilter === dept ? 'bg-brand text-white shadow-md shadow-brand/20' : 'bg-transparent text-white/50 hover:text-brand'}`}
                      >
                        {dept} View
                      </button>
                    ))}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <button 
                        onClick={() => setIsStatusMenuOpen(!isStatusMenuOpen)}
                        className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg font-bold uppercase tracking-wider text-xs hover:bg-gray-800 transition shadow-md"
                      >
                        <Menu size={16} /> {orderFilter}
                      </button>
                      
                      {isStatusMenuOpen && (
                        <div className="absolute right-0 top-full mt-2 w-48 bg-surface-2 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
                          {['All', 'Pending', 'Preparing', 'Completed', 'Cancelled'].map(filter => (
                            <button 
                              key={filter} 
                              onClick={() => { setOrderFilter(filter); setIsStatusMenuOpen(false); }} 
                              className={`px-4 py-3 text-left text-sm font-bold transition hover:bg-white/5 ${orderFilter === filter ? 'bg-brand/10 text-brand border-l-4 border-brand' : 'text-white/70 border-l-4 border-transparent'}`}
                            >
                              {filter}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <button 
                      onClick={() => setIsPosOpen(true)}
                      className="px-6 py-2 bg-transparent text-brand border border-brand/40 rounded-lg text-sm font-black uppercase tracking-widest hover:bg-brand hover:text-page-bg transition shadow-md whitespace-nowrap flex items-center gap-2"
                    >
                      <Plus size={16} /> Manual Order
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {displayOrders.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-gray-500 font-bold uppercase tracking-widest">No orders in {departmentFilter} queue.</div>
                  ) : displayOrders.map(order => {
                    // Items scoped to current department view (or all items when in All view)
                    const viewItems      = departmentFilter !== 'All'
                      ? order.items.filter(i => (i.department || 'Kitchen') === departmentFilter)
                      : order.items;
                    const allDelivered   = order.items.length > 0 && order.items.every(i => i.itemStatus === 'Delivered');
                    const deliveredCount = viewItems.filter(i => i.itemStatus === 'Delivered').length;
                    const allDeptDone    = viewItems.length > 0 && viewItems.every(i => i.itemStatus === 'Finished' || i.itemStatus === 'Delivered');
                    const deptDoneCount  = viewItems.filter(i => i.itemStatus === 'Finished' || i.itemStatus === 'Delivered').length;
                    const isUpdating = !!updatingOrders[order._id];
                    const compEntry = compOverride[order._id];
                    const isComp = compEntry !== undefined ? compEntry.isComplimentary : order.isComplimentary;
                    const compEmpName = compEntry !== undefined ? compEntry.employeeName : (order.employeeName || '');
                    const displayDiscount = isComp ? order.subtotal : (order.discount || 0);
                    const displayTotal = isComp ? 0 : order.total;
                    const statusBorderColor =
                      order.status === 'Completed'           ? 'border-l-green-600' :
                      order.status === 'Ready'               ? 'border-l-blue-500' :
                      order.status === 'Partially Delivered' ? 'border-l-orange-500' :
                      order.status === 'Preparing'           ? 'border-l-yellow-500' :
                      (order.status === 'Cancelled' || order.status === 'Voided') ? 'border-l-gray-600' :
                      'border-l-red-500';
                    return (
                      <div key={order._id} className={`bg-surface rounded-xl border border-white/5 border-l-4 ${statusBorderColor} flex flex-col shadow-lg transition-all ${(order.status === 'Cancelled' || order.status === 'Voided') ? 'opacity-60' : ''}`}>

                        {/* HEADER — only chevron collapses */}
                        <div className="flex justify-between items-center px-4 pt-4 pb-3 gap-2">
                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-black text-sm">{order.orderNumber}</span>
                              {order.customerName && (
                                <span className="text-[11px] bg-white/10 text-gray-300 px-2 py-0.5 rounded font-semibold">{order.customerName}</span>
                              )}
                              {order.table && <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">({order.table})</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                order.status === 'Pending'             ? 'bg-red-500/15 text-red-400' :
                                order.status === 'Preparing'           ? 'bg-yellow-500/15 text-yellow-400' :
                                order.status === 'Ready'               ? 'bg-blue-500/15 text-blue-400' :
                                order.status === 'Partially Delivered' ? 'bg-orange-500/15 text-orange-400' :
                                order.status === 'Completed'           ? 'bg-green-500/15 text-green-400' :
                                'bg-gray-500/15 text-gray-500'
                              }`}>{order.status}</span>
                              <span className="text-gray-600 text-[9px]">{new Date(order.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => printOrderSlip(order)} className="p-1.5 bg-white/5 text-gray-400 rounded-lg hover:bg-white/10 hover:text-white transition" title="Print">
                              <Printer size={13} />
                            </button>
                            <button
                              onClick={() => setCollapsedOrders(prev => ({ ...prev, [order._id]: !prev[order._id] }))}
                              className="p-1.5 bg-white/5 text-gray-400 rounded-lg hover:bg-white/10 hover:text-white transition"
                            >
                              {collapsedOrders[order._id] ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                            </button>
                          </div>
                        </div>

                        {!collapsedOrders[order._id] && (
                          <div className="px-4 pb-4 flex flex-col gap-3 border-t border-white/5 pt-3">
                            <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                              {['Kitchen', 'Bar'].map(dept => {
                                const deptItems = order.items.map((item, idx) => ({ ...item, originalIdx: idx })).filter(i => (i.department || 'Kitchen') === dept);
                                if (deptItems.length === 0) return null;
                                if (departmentFilter !== 'All' && departmentFilter !== dept) return null;
                                return (
                                  <div key={dept} className="bg-black/20 rounded-lg p-2.5 border border-white/5">
                                    <h4 className="text-[9px] uppercase text-gray-500 font-black mb-2 tracking-widest">{dept}</h4>
                                    {deptItems.map(item => (
                                      <div key={item.originalIdx} className="mb-2 last:mb-0">
                                        <div className="flex justify-between items-start gap-2">
                                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                            <span className={`font-semibold text-sm leading-tight ${item.itemStatus === 'Delivered' ? 'text-gray-600 line-through' : 'text-white'}`}>
                                              {item.quantity}x {item.name}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1 flex-shrink-0">
                                            {(order.status === 'Preparing' || order.status === 'Ready') ? (
                                              <>
                                                {item.itemStatus === 'Received' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Preparing')} className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500 hover:text-black px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition">Prep</button>
                                                )}
                                                {item.itemStatus === 'Preparing' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Finished')} className="bg-accent/10 text-accent border border-accent/20 hover:bg-accent hover:text-black px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition">Finish</button>
                                                )}
                                                {item.itemStatus === 'Finished' && departmentFilter === 'All' && (
                                                  <button onClick={() => updateItemStatus(order, item.originalIdx, 'Delivered')} className="bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500 hover:text-black px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition flex items-center gap-1">
                                                    <Truck size={9} /> Give
                                                  </button>
                                                )}
                                                {item.itemStatus === 'Finished' && departmentFilter !== 'All' && (
                                                  <span className="text-accent text-[10px] font-black uppercase flex items-center gap-0.5"><CheckCircle size={10} /> Done</span>
                                                )}
                                                {item.itemStatus === 'Delivered' && (
                                                  <span className="text-green-500/50 text-[10px] font-black uppercase flex items-center gap-0.5"><Check size={9} /> Given</span>
                                                )}
                                              </>
                                            ) : (
                                              <div className="flex flex-col items-end">
                                                {item.discountPercent > 0 ? (
                                                  <>
                                                    <span className="text-gray-600 line-through text-[10px] font-mono">
                                                      P{((item.price + (item.selectedAddOns?.reduce((s, a) => s + Number(a.price), 0) || 0)) * item.quantity).toFixed(2)}
                                                    </span>
                                                    <span className="text-accent font-mono font-bold text-xs">
                                                      P{(((item.price + (item.selectedAddOns?.reduce((s, a) => s + Number(a.price), 0) || 0)) * item.quantity) * (1 - item.discountPercent / 100)).toFixed(2)}
                                                    </span>
                                                  </>
                                                ) : (
                                                  <span className="text-gray-400 font-mono text-xs">
                                                    P{((item.price + (item.selectedAddOns?.reduce((s, a) => s + Number(a.price), 0) || 0)) * item.quantity).toFixed(2)}
                                                  </span>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                                          <div className="pl-5 mt-1 space-y-0.5">
                                            {item.selectedAddOns.map((addon, aIdx) => (
                                              <div key={aIdx} className="flex justify-between items-center text-[10px] text-gray-600">
                                                <span className="flex items-center gap-1">
                                                  <ChevronRight size={8} className="flex-shrink-0" /> {addon.name} <span className="opacity-70">(+P{addon.price})</span>
                                                </span>
                                                {order.status === 'Pending' && (
                                                  <button onClick={() => removeAddOnFromOrder(order, item.originalIdx, aIdx)} className="text-gray-600 hover:text-red-400 transition p-0.5 rounded">
                                                    <X size={10} />
                                                  </button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>

                            {order.status === 'Pending' && departmentFilter === 'All' && (
                              <div className="flex flex-col gap-1.5 border-t border-white/5 pt-2.5">
                                {isComp ? (
                                  /* ── APPLIED STATE: audit badge ── */
                                  <div className="flex items-start gap-2 bg-white/3 border border-white/8 rounded-lg p-2">
                                    <Gift size={11} className="text-gray-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider">Complimentary</span>
                                        {order.complimentaryReferenceNumber && (
                                          <span className="text-gray-600 text-[9px] font-mono">{order.complimentaryReferenceNumber}</span>
                                        )}
                                      </div>
                                      <div className="text-gray-500 text-[9px]">
                                        <span className="text-gray-600">Reason:</span> {COMP_REASON_LABELS[order.complimentaryReasonType] || '—'}
                                      </div>
                                      {order.complimentaryReasonNote && (
                                        <div className="text-gray-600 text-[9px] italic truncate">&ldquo;{order.complimentaryReasonNote}&rdquo;</div>
                                      )}
                                      <div className="text-gray-600 text-[9px]">
                                        <span className="text-gray-700">For:</span> {compEmpName} &nbsp;·&nbsp; <span className="text-gray-700">By:</span> {order.complimentaryApprovedBy || activeAdmin?.name || '—'}
                                      </div>
                                      {order.complimentaryApprovedAt && (
                                        <div className="text-gray-700 text-[9px]">{new Date(order.complimentaryApprovedAt).toLocaleString()}</div>
                                      )}
                                    </div>
                                    <button onClick={() => removeComplimentary(order._id)} className="flex-shrink-0 bg-red-500 hover:bg-red-600 text-white p-1 rounded font-black transition" title="Remove Complimentary">
                                      <X size={11} />
                                    </button>
                                  </div>
                                ) : (
                                  /* ── PENDING STATE: input form ── */
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <Gift size={10} className="text-gray-500 flex-shrink-0" />
                                      <span className="text-gray-500 text-[9px] font-bold uppercase tracking-wider">Mark Complimentary</span>
                                    </div>
                                    {/* Reason type — REQUIRED */}
                                    <select
                                      className="w-full bg-surface-2 border border-white/10 text-gray-200 text-[10px] rounded p-1.5 outline-none font-semibold"
                                      value={compReasonTypes[order._id] || ''}
                                      onChange={(e) => setCompReasonTypes(prev => ({ ...prev, [order._id]: e.target.value }))}
                                    >
                                      <option value="">— Select Reason Type (required) —</option>
                                      {Object.entries(COMP_REASON_LABELS).map(([key, label]) => (
                                        <option key={key} value={key}>{label}</option>
                                      ))}
                                    </select>
                                    {/* Optional note */}
                                    <input
                                      type="text"
                                      placeholder="Additional note (optional)..."
                                      className="w-full bg-surface-2 border border-white/10 text-gray-300 text-[10px] rounded p-1.5 outline-none"
                                      value={compReasonNotes[order._id] || ''}
                                      onChange={(e) => setCompReasonNotes(prev => ({ ...prev, [order._id]: e.target.value }))}
                                    />
                                    {/* Beneficiary override + apply button */}
                                    <div className="flex items-center gap-1.5">
                                      <select
                                        className="flex-1 min-w-0 bg-surface-2 border border-white/10 text-gray-400 text-[9px] rounded p-1.5 outline-none"
                                        value={compSelections[order._id] || ''}
                                        onChange={(e) => setCompSelections({ ...compSelections, [order._id]: e.target.value })}
                                      >
                                        <option value="">For: {activeAdmin?.name || 'You'} (default)</option>
                                        {users.map(u => <option key={u._id} value={u.name}>For: {u.name}</option>)}
                                      </select>
                                      <button
                                        onClick={() => applyComplimentary(order._id)}
                                        className="flex-shrink-0 bg-yellow-500 hover:bg-yellow-400 text-black px-2.5 py-1.5 rounded font-black text-[10px] uppercase tracking-wider transition flex items-center gap-1"
                                      >
                                        <Check size={11} /> Apply
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {departmentFilter === 'All' && (<div className="bg-black/30 rounded-lg p-3 space-y-1.5">
                              {order.status === 'Completed' && order.paymentMethod && (
                                <div className="flex justify-between text-[11px] text-gray-500">
                                  <span>Payment</span>
                                  <span className="font-mono text-brand/80 font-bold">{order.paymentMethod}</span>
                                </div>
                              )}
                              <div className="flex justify-between text-[11px] text-gray-500">
                                <span>Gross</span><span className="font-mono">P{order.subtotal.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center text-[11px] text-gray-500">
                                <div className="flex items-center gap-2">
                                  <span>VAT ({order.vatRate > 0 ? (order.vatRate * 100).toFixed(0) : 0}%)</span>
                                  {order.status === 'Pending' && (
                                    <button onClick={() => toggleVat(order._id, order.vatRate)} className="bg-white/5 hover:bg-white/10 text-accent px-1.5 py-0.5 rounded text-[9px] uppercase font-black transition border border-white/10">
                                      {order.vatRate > 0 ? 'Off' : 'On'}
                                    </button>
                                  )}
                                </div>
                                <span className="font-mono">P{order.vatAmount.toFixed(2)}</span>
                              </div>
                              {(() => {
                                const promoDiscounts = discounts.filter(d => !d.name.toLowerCase().match(/pwd|senior/));
                                const scpwdDiscounts = discounts.filter(d => d.name.toLowerCase().match(/pwd|senior/));
                                const hasScpwd = order.items.some(i => i.discountPercent > 0);
                                const hasPromo = order.discountPercent > 0 && order.discountType !== 'SC/PWD';
                                return (
                                  <>
                                    <div className="flex justify-between items-center text-[11px] text-gray-500 border-b border-white/5 pb-1.5">
                                      <div className="flex items-center gap-2 flex-1 pr-2">
                                        <span className="whitespace-nowrap uppercase tracking-wider text-[9px]">Promo</span>
                                        {order.status === 'Pending' && (
                                          hasScpwd ? (
                                            <span className="text-[9px] text-white/20 italic ml-auto">SC/PWD active</span>
                                          ) : (
                                            <div className="flex gap-1 items-center flex-1 justify-end">
                                              <select
                                                className="w-full max-w-[110px] bg-dark border border-white/10 rounded px-1 text-[10px] text-black outline-none h-6"
                                                value={discountInputs[order._id] || ''}
                                                onChange={(e) => setDiscountInputs(prev => ({ ...prev, [order._id]: e.target.value }))}
                                              >
                                                <option value="">No promo</option>
                                                {promoDiscounts.map(d => <option key={d._id} value={d.percentage}>{d.name} ({d.percentage}%)</option>)}
                                              </select>
                                              <button onClick={() => applyDiscount(order._id)} className="bg-accent/10 hover:bg-accent text-accent hover:text-black px-2 rounded font-black transition h-6 flex items-center border border-accent/20"><Check size={12} /></button>
                                              {order.discountPercent > 0 && order.discountType !== 'SC/PWD' && (
                                                <button onClick={() => applyDiscount(order._id, true)} className="bg-red-500/10 text-red-400 px-2 rounded font-black h-6 border border-red-500/20 flex items-center"><X size={12} /></button>
                                              )}
                                            </div>
                                          )
                                        )}
                                      </div>
                                      <span className="text-red-400 whitespace-nowrap font-mono">-P{displayDiscount.toFixed(2)}</span>
                                    </div>
                                    {scpwdDiscounts.length > 0 && order.status === 'Pending' && (
                                      <div className="border-b border-white/5 pb-1.5 space-y-1">
                                        {hasPromo ? (
                                          <span className="text-[9px] uppercase tracking-wider text-white/20 italic">SC/PWD — Promo active</span>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => setScpwdOpen(prev => ({ ...prev, [order._id]: !prev[order._id] }))}
                                              className="text-[9px] uppercase tracking-wider text-accent font-black flex items-center gap-1 hover:opacity-80 transition"
                                            >
                                              SC/PWD (per item) {scpwdOpen[order._id] ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                            </button>
                                            {scpwdOpen[order._id] && (
                                              <div className="max-h-[130px] overflow-y-auto custom-scrollbar space-y-1.5 pt-0.5 pr-1">
                                                {order.items.map((item, idx) => (
                                                  <div key={idx} className="flex items-center gap-2">
                                                    <span className="text-[11px] text-gray-400 font-semibold flex-1 truncate min-w-0">{item.quantity}x {item.name}</span>
                                                    <select
                                                      className="bg-dark border border-white/10 rounded text-[10px] text-black outline-none px-1 py-0.5 h-6 cursor-pointer flex-shrink-0"
                                                      value={item.discountPercent || ''}
                                                      onChange={(e) => applyItemDiscount(order._id, idx, e.target.value)}
                                                    >
                                                      <option value="">No disc</option>
                                                      {scpwdDiscounts.map(d => (
                                                        <option key={d._id} value={d.percentage}>{d.name} ({d.percentage}%)</option>
                                                      ))}
                                                    </select>
                                                    {item.discountPercent > 0 && (
                                                      <span className="text-accent font-mono text-[10px] whitespace-nowrap flex-shrink-0">-{item.discountPercent}%</span>
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                              <div className="flex justify-between font-black text-base pt-1 border-t border-white/10">
                                <span className="text-white">Total</span>
                                <span className="text-accent font-mono tracking-wider">P{displayTotal.toFixed(2)}</span>
                              </div>
                            </div>)}

                            <div className={`flex flex-col gap-2 ${isUpdating ? 'opacity-50 pointer-events-none' : ''}`}>
                              {order.status === 'Pending' && departmentFilter === 'All' && (() => {
                                const isDelivery = ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(order.table);
                                const displayPayment = isDelivery ? order.table : (paymentSelections[order._id] || order.paymentMethod || 'Cash');
                                if (isComp) {
                                  return (
                                    <div className="flex flex-col w-full gap-2">
                                      <div className="flex items-center justify-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg py-2.5 px-3">
                                        <Gift size={12} className="text-yellow-400" />
                                        <span className="text-yellow-400 text-[10px] font-black uppercase tracking-widest">No Payment — Complimentary</span>
                                      </div>
                                      <div className="flex gap-2">
                                        <button
                                          onClick={() => updateStatus(order._id, 'Preparing')}
                                          className="flex-1 bg-yellow-500 text-black py-2.5 rounded-lg hover:bg-yellow-400 font-black text-xs uppercase tracking-widest transition"
                                        >
                                          Send to Kitchen
                                        </button>
                                        <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-red-400 py-2.5 px-4 rounded-lg hover:bg-red-500 hover:text-white font-black text-xs transition uppercase border border-red-500/20">Drop</button>
                                      </div>
                                    </div>
                                  );
                                }
                                return (() => {
                                  const isCash = displayPayment === 'Cash';
                                  const tendered = parseFloat(cashTendered[order._id] || '0') || 0;
                                  const changeDue = isCash && tendered > 0 ? tendered - displayTotal : null;
                                  const isUnderpaid = isCash && tendered > 0 && tendered < displayTotal;
                                  return (
                                    <div className="flex flex-col w-full gap-2">
                                      <select
                                        value={displayPayment}
                                        disabled={isDelivery}
                                        onChange={(e) => setPaymentSelections(prev => ({ ...prev, [order._id]: e.target.value }))}
                                        className={`w-full border rounded-lg p-2 text-sm font-bold outline-none transition ${isDelivery ? 'bg-dark text-gray-400 border-white/10 cursor-not-allowed' : 'bg-dark text-black border-white/10 focus:border-accent/50'}`}
                                      >
                                        <optgroup label="In-Store Payments">
                                          <option value="Cash">Cash</option>
                                          <option value="Bank Transfer">Bank Transfer</option>
                                        </optgroup>
                                        <optgroup label="E-Wallets">
                                          <option value="GCash">GCash</option>
                                          <option value="Maya">Maya</option>
                                          <option value="Maribank">Maribank / Seabank</option>
                                          <option value="Other E-Wallet">Other E-Wallet</option>
                                        </optgroup>
                                        <optgroup label="Delivery Partners">
                                          <option value="Grab Delivery">GrabFood</option>
                                          <option value="Foodpanda">Foodpanda</option>
                                          <option value="Manual Delivery">Manual/Direct</option>
                                        </optgroup>
                                      </select>
                                      {isCash && (
                                        <div className="flex flex-col gap-1">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest whitespace-nowrap">Cash In</span>
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              placeholder={`≥ P${displayTotal.toFixed(2)}`}
                                              value={cashTendered[order._id] || ''}
                                              onChange={(e) => setCashTendered(prev => ({ ...prev, [order._id]: e.target.value }))}
                                              className="flex-1 bg-white/5 border border-white/10 focus:border-accent/50 rounded-lg px-2 py-1.5 text-sm font-mono text-white outline-none"
                                              aria-label="Cash tendered"
                                            />
                                          </div>
                                          {changeDue !== null && (
                                            <div className={`flex justify-between text-xs font-black px-1 ${isUnderpaid ? 'text-red-400' : 'text-green-400'}`}>
                                              <span>{isUnderpaid ? 'SHORT' : 'CHANGE'}</span>
                                              <span className="font-mono">P{Math.abs(changeDue).toFixed(2)}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      <div className="flex gap-2">
                                        <button
                                          disabled={isUnderpaid}
                                          onClick={() => {
                                            if (isDelivery && paymentSelections[order._id] !== order.table) {
                                              setPaymentSelections(prev => ({ ...prev, [order._id]: order.table }));
                                            }
                                            setTimeout(() => updateStatus(order._id, 'Preparing'), 0);
                                          }}
                                          className={`flex-1 py-2.5 rounded-lg font-black text-xs uppercase tracking-widest transition ${isUnderpaid ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-accent text-black hover:bg-accentShadow'}`}
                                        >
                                          Pay & Send to Kitchen
                                        </button>
                                        <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-red-400 py-2.5 px-4 rounded-lg hover:bg-red-500 hover:text-white font-black text-xs transition uppercase border border-red-500/20">Drop</button>
                                      </div>
                                    </div>
                                  );
                                })();
                              })()}

                              {order.status === 'Preparing' && (
                                <div className="flex flex-col gap-2">
                                  {deliveredCount > 0 && (
                                    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                                      <Truck size={12} className="text-green-400 flex-shrink-0" />
                                      <span className="text-green-400 text-[10px] font-black uppercase tracking-widest">{deliveredCount}/{viewItems.length} Given to Customer</span>
                                    </div>
                                  )}
                                  {departmentFilter !== 'All' ? (
                                    // Kitchen / Bar view: scope progress to this dept only
                                    allDeptDone ? (
                                      <div className="flex items-center justify-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400 rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                        <CheckCircle size={11} /> All {departmentFilter} Items Done
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-center bg-black/20 border border-white/5 text-gray-500 rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                        In Preparation... ({deptDoneCount}/{viewItems.length})
                                      </div>
                                    )
                                  ) : allDelivered ? (
                                    <button onClick={() => updateStatus(order._id, 'Completed')} className="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-500 font-black uppercase tracking-widest text-xs transition flex items-center justify-center gap-2">
                                      <CheckCircle size={13} /> Complete Order
                                    </button>
                                  ) : order.items.every(i => i.itemStatus === 'Finished' || i.itemStatus === 'Delivered') ? (
                                    <div className="flex items-center justify-center gap-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                      <Truck size={11} /> Give items above to complete
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-center bg-black/20 border border-white/5 text-gray-500 rounded-lg text-[10px] font-bold uppercase tracking-widest py-2.5">
                                      In Preparation...
                                    </div>
                                  )}
                                  {departmentFilter === 'All' && !allDelivered && (
                                    <button onClick={() => updateStatus(order._id, 'Cancelled')} className="w-full bg-red-500/10 text-red-400 py-2 rounded-lg hover:bg-red-500 hover:text-white font-black text-xs transition uppercase border border-red-500/20">Drop Order</button>
                                  )}
                                </div>
                              )}

                              {order.status === 'Ready' && departmentFilter === 'All' && (
                                <div className="flex flex-col gap-2">
                                  {deliveredCount > 0 && (
                                    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                                      <Truck size={12} className="text-green-400 flex-shrink-0" />
                                      <span className="text-green-400 text-[10px] font-black uppercase tracking-widest">{deliveredCount}/{order.items.length} Given</span>
                                    </div>
                                  )}
                                  <div className="flex gap-2">
                                    <button onClick={() => updateStatus(order._id, 'Completed')} className="flex-1 bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-500 font-black uppercase tracking-widest text-xs transition">Mark All Delivered</button>
                                    <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500/10 text-red-400 py-2.5 px-3 rounded-lg hover:bg-red-500 hover:text-white font-black text-xs transition uppercase border border-red-500/20">Drop</button>
                                  </div>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const res = await apiFetch(`/api/orders/${order._id}/partial-delivery`, { method: 'POST' });
                                        const data = await res.json();
                                        if (!data.success) alert(data.error);
                                      } catch (err) { console.error(err); }
                                    }}
                                    className="w-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 py-2 rounded-lg hover:bg-yellow-500/20 font-bold text-xs uppercase tracking-widest transition"
                                  >
                                    Give Partial — More Items Coming
                                  </button>
                                </div>
                              )}

                              {order.status === 'Partially Delivered' && departmentFilter === 'All' && (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-center gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg py-2">
                                    <Clock size={13} className="text-orange-400" />
                                    <span className="text-orange-400 text-[10px] font-black uppercase tracking-widest">Partially Delivered</span>
                                  </div>
                                  <button onClick={() => updateStatus(order._id, 'Completed')} className="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-500 font-black uppercase tracking-widest text-xs transition">
                                    Deliver Remaining Items
                                  </button>
                                </div>
                              )}

                              {order.status === 'Completed' && departmentFilter === 'All' && (
                                <button onClick={() => handleVoidOrder(order._id)} className="w-full bg-red-500/10 border border-red-500/20 text-red-400 py-2 rounded-lg hover:bg-red-500 hover:text-white font-bold text-xs uppercase tracking-widest transition">
                                  Void / Refund Order
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* --- SALES HISTORY & REGISTER TAB --- */}
      {activeTab === 'history' && (() => {
        // Filter calculations based on the Shift Dropdown
        const todayShiftOrders = todayCompleted.filter(o => shiftFilter === 'All' || o.cashier === shiftFilter);
        const shiftPaid = todayShiftOrders.filter(o => !o.isComplimentary);
        const shiftComp = todayShiftOrders.filter(o => o.isComplimentary);
        const shiftGross = todayShiftOrders.reduce((sum, o) => sum + o.subtotal, 0); // ALL incl. comp
        const shiftDisc = todayShiftOrders.reduce((sum, o) => o.isComplimentary ? sum + o.subtotal : sum + (o.discount || 0), 0); // comp = 100% discount
        const shiftRevenue = shiftGross - shiftDisc; // Net Sales (cash collected only)
        const shiftCompAmount = shiftComp.reduce((sum, o) => sum + o.subtotal, 0);
        const shiftVat = shiftPaid.reduce((sum, o) => sum + o.vatAmount, 0);

        return (
        <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
          <div className="bg-accent border border-accentShadow rounded-xl p-6 shadow-xl shadow-accent/5">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-dark font-black tracking-widest uppercase text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-dark animate-pulse"></span> Active Register
              </h3>
              <select className="bg-dark text-black p-2 rounded text-xs font-bold outline-none border border-gray-700 shadow-sm" value={shiftFilter} onChange={e => setShiftFilter(e.target.value)}>
                <option value="All">All Shifts (Store Total)</option>
                {users.map(u => <option key={u._id} value={u.name}>{u.name}'s Shift</option>)}
              </select>
            </div>
            
            <div className="space-y-4 mb-6">
              <div>
                <p className="text-dark text-xs font-bold uppercase tracking-wider mb-1">Net Sales</p>
                <p className="text-4xl font-black text-white">P{shiftRevenue.toFixed(2)}</p>
                <p className="text-dark text-[10px] font-semibold mt-1">Gross P{shiftGross.toFixed(2)} &minus; Discounts P{shiftDisc.toFixed(2)}</p>
                {shiftCompAmount > 0 && (
                  <p className="text-gray-300 text-[10px] font-bold mt-0.5">+P{shiftCompAmount.toFixed(2)} complimentary (not collected)</p>
                )}
              </div>
              <div className="flex justify-between border-t border-dark pt-4">
                <div>
                  <p className="text-dark text-[10px] font-bold uppercase tracking-wider">Completed Orders</p>
                  <p className="text-lg font-bold text-dark">{todayShiftOrders.length}</p>
                  {shiftComp.length > 0 && <p className="text-[9px] text-gray-300 font-bold">{shiftComp.length} complimentary</p>}
                </div>
                <div className="text-right">
                  <p className="text-dark text-[10px] font-bold uppercase tracking-wider">VAT Collected</p>
                  <p className="text-lg font-bold text-gray-300">P{shiftVat.toFixed(2)}</p>
                </div>
              </div>
            </div>
            <button onClick={archiveDay} className="w-full bg-red-600 border border-red-600 text-dark hover:bg-dark hover:text-red-600 font-bold py-3 rounded-lg transition text-sm">
              Close Register & Archive Day
            </button>
          </div>

          <div className="bg-surface border border-gray-800 rounded-xl p-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-dark/20 rounded-t-xl">
              <h3 className="text-gray-300 font-bold text-sm tracking-wider uppercase">Sales History</h3>
              <button onClick={exportAllToPDF} className="text-[10px] bg-accent border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-dark hover:text-accent transition font-bold uppercase tracking-wider">
                Export All
              </button>
            </div>
            
            <div className="max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {Object.keys(groupedArchives).length === 0 ? (
                <p className="text-gray-600 text-sm p-6 text-center">No past days archived.</p>
              ) : (
                Object.entries(groupedArchives).map(([date, data]) => (
                  <div key={date} className="border-b border-gray-800/50 last:border-0">
                    <button onClick={() => toggleDay(date)} className="w-full flex justify-between items-center p-4 hover:bg-dark/50 transition text-left">
                      <span className="font-bold text-sm text-gray-200">{date}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-accent font-bold">P{data.revenue.toFixed(2)}</span>
                        {expandedDays[date] ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                      </div>
                    </button>
                    
                    {expandedDays[date] && (
                      <div className="p-4 bg-dark/30 border-t border-gray-800/30 flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Orders</p><p className="text-sm font-semibold">{data.orders.filter(o => o.status === 'Completed').length}</p></div>
                          <div><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">VAT</p><p className="text-sm font-semibold">P{data.vat.toFixed(2)}</p></div>
                          <div className="col-span-2"><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Discounts</p><p className="text-sm font-semibold text-red-400">-P{data.discounts.toFixed(2)}</p></div>
                        </div>

                        <div className="border-t border-gray-800/30 pt-3 mt-1">
                          <div className="flex justify-between items-center">
                            <button onClick={() => toggleOrderList(date)} className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-white transition">
                              <span>{expandedOrderLists[date] ? 'Hide Orders' : 'View All Orders'}</span>
                              {expandedOrderLists[date] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                            <button onClick={() => exportDayToPDF(date, data.orders)} className="text-[10px] bg-surface-2 border border-white/10 text-white/60 px-2 py-1 rounded hover:bg-white/10 hover:text-white transition font-bold uppercase tracking-wider">
                              Export Day
                            </button>
                          </div>

                          {expandedOrderLists[date] && (
                            <div className="mt-3 space-y-3 max-h-60 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-700">
                              {data.orders.map(order => (
                                <div key={order._id} className="bg-dark/50 p-3 rounded border border-gray-800/50">
                                  <div className="flex justify-between items-center mb-2 border-b border-gray-800/50 pb-2">
                                    <span className="font-bold text-sm text-accent">{order.orderNumber}</span>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${order.status === 'Cancelled' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>{order.status}</span>
                                      <span className="text-xs font-bold text-white">P{order.total.toFixed(2)}</span>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {order.items.map((item, idx) => (
                                      <div key={idx} className="flex justify-between text-[11px] text-white">
                                        <span>{item.quantity}x {item.name}</span><span>P{(item.price * item.quantity).toFixed(2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  {(order.discount > 0 || order.vatAmount > 0) && (
                                    <div className="mt-2 pt-2 border-t border-gray-800/50 flex justify-between text-[10px] text-gray-500">
                                      <span>VAT: P{order.vatAmount.toFixed(2)}</span>
                                      {order.discount > 0 && <span className="text-red-400">Disc: -P{order.discount.toFixed(2)}</span>}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        ); // <--- This closes the return() statement
      })()}


      {/* --- INVENTORY TAB --- */}
      {activeTab === 'inventory' && (
        <div className="flex flex-col xl:flex-row gap-8">
          
          {/* LEFT COLUMN: Main Tables */}
          <div className="flex-1 bg-accent border border-accentShadow rounded-xl p-6 flex flex-col h-fit">
            
            {/* Header & Sub-Tabs */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4 border-b border-dark pb-4">
              <h3 className="text-xl font-bold text-white">Inventory Hub</h3>
              
              {/* --- NEW: THE SUB-TAB TOGGLE --- */}
              <div className="flex bg-dark p-1 rounded-lg shadow-inner">
                <button 
                  onClick={() => setInvSubTab('live')}
                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition ${invSubTab === 'live' ? 'bg-accent text-dark shadow-md' : 'text-gray-400 hover:text-accent'}`}
                >
                  Live Stock
                </button>
                <button 
                  onClick={() => { setInvSubTab('eod'); fetchEODData(); }}
                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition flex items-center gap-2 ${invSubTab === 'eod' ? 'bg-red-600 text-white shadow-md shadow-red-500/20' : 'text-gray-400 hover:text-red-400'}`}
                >
                  <span className={`w-2 h-2 rounded-full ${invSubTab === 'eod' ? 'bg-white animate-pulse' : 'bg-red-500'}`}></span>
                  EOD Audit
                </button>
              </div>
              
              <button onClick={exportInventoryToPDF} className="text-[10px] bg-accent border border-dark text-white px-3 py-1.5 rounded hover:bg-dark hover:text-accent transition font-bold uppercase tracking-wider">
                Export PDF
              </button>
            </div>

            {/* --- TAB 1: LIVE STOCK (Clean & Read-Only) --- */}
            {invSubTab === 'live' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-dark border-b border-dark">
                      <th className="pb-3">Item Name</th>
                      <th className="pb-3 text-right">Live System Qty</th>
                      <th className="pb-3">Unit</th>
                      <th className="pb-3 text-right">Unit Cost</th>
                      <th className="pb-3 text-right">Total Value</th>
                      <th className="pb-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentInventory.map(item => (
                      <tr key={item._id} className="border-b border-gray-800/50 hover:bg-dark/30 transition">
                        <td className="py-3 font-bold text-dark">{item.itemName}</td>
                        <td className={`py-3 text-right font-bold ${item.stockQty < 10 ? 'text-red-400' : 'text-dark'}`}>{item.stockQty.toLocaleString()}</td>
                        <td className="py-3 text-dark pl-2">{item.unit}</td>
                        <td className="py-3 text-right text-dark font-mono text-xs">P{(item.unitCost || 0).toFixed(4)}</td>
                        <td className="py-3 text-right text-dark font-bold font-mono text-xs">P{(item.stockQty * (item.unitCost || 0)).toFixed(2)}</td>
                        <td className="py-3 text-center space-x-2">
                          <button onClick={() => fetchStockHistory(item)} className="text-accent bg-dark hover:bg-accent hover:text-white text-xs font-bold px-2 py-1 bg-accent/10 rounded transition">History</button>
                          <button onClick={() => deleteInventory(item._id)} className="text-red-500 hover:text-red-400 text-xs font-bold px-2 py-1 bg-red-900 rounded transition">Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* --- INVENTORY PAGINATION CONTROLS --- */}
              {totalInvPages > 1 && (
                <div className="flex justify-between items-center bg-dark p-3 rounded-lg border border-gray-800 mt-4">
                  <button 
                    onClick={() => setInvPage(prev => Math.max(prev - 1, 1))}
                    disabled={invPage === 1}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                  </button>
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    PAGE <span className="text-accent text-sm">{invPage}</span> OF {totalInvPages}
                  </span>
                  <button 
                    onClick={() => setInvPage(prev => Math.min(prev + 1, totalInvPages))}
                    disabled={invPage === totalInvPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === totalInvPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                  </button>
                </div>
              )}
              </div>
            )}

            {/* --- TAB 2: EOD AUDIT (Enterprise Financial Control) --- */}
            {invSubTab === 'eod' && (() => {
              const itemsCounted = inventory.filter(i => physicalCounts[i._id] !== undefined && physicalCounts[i._id] !== '').length;
              const isComplete = itemsCounted === inventory.length;
              const itemsWithVariance = inventory.filter(i => physicalCounts[i._id] !== undefined && physicalCounts[i._id] !== '' && Number(physicalCounts[i._id]) !== i.stockQty);
              const netVarianceQty = itemsWithVariance.reduce((sum, i) => sum + (Number(physicalCounts[i._id]) - i.stockQty), 0);
              const netImpact = itemsWithVariance.reduce((sum, i) => sum + ((Number(physicalCounts[i._id]) - i.stockQty) * (i.unitCost || 0)), 0);

              const isLocked = eodStatus === 'LOCKED';

              return (
                <div className="overflow-x-auto flex flex-col h-full animate-in fade-in duration-300 relative pb-24">
                  
                  {/* --- INTELLIGENT EOD HEADER --- */}
                  <div className={`flex justify-between items-center p-4 rounded-lg border mb-4 shadow-inner ${isLocked ? 'bg-green-900/10 border-green-900/30' : 'bg-dark border-accent'}`}>
                    <div>
                      <h4 className="text-black font-black uppercase tracking-wider text-sm flex items-center gap-2">
                        {isLocked ? (
                          <>EOD Locked</>
                        ) : (
                          <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> EOD Audit (Open)</>
                        )}
                      </h4>
                      <p className={`text-xs mt-1 ${isLocked ? 'text-dark font-bold' : 'text-black'}`}>
                        {isLocked 
                          ? `Daily inventory was securely locked on ${new Date(eodLockedAt).toLocaleTimeString()}`
                          : `Audit physical stock, assign variance reasons, and lock daily financial impact.`}
                      </p>
                    </div>

                    {/* NEW REOPEN BUTTON */}
                    {isLocked && (
                      <button
                        onClick={async () => {
                          if(window.confirm("WARNING: Reopening the day allows new sales, which will alter your ending inventory. Are you sure?")) {
                            await apiFetch(`/api/inventory/eod/reopen`, { method: 'POST' });
                            fetchEODData(); // Refresh the tab
                          }
                        }}
                        className="bg-dark border border-gray-600 text-accent hover:text-white hover:border-red-500 px-4 py-2 rounded text-xs font-bold uppercase transition"
                      >
                        Reopen Register
                      </button>
                    )}
                  </div>

                  <table className="w-full text-left text-sm mb-4">
                    <thead>
                      <tr className="text-dark border-b border-dark text-xs uppercase tracking-wider">
                        <th className="pb-3 w-1/4">Item & Context</th>
                        <th className="pb-3 text-right">System End</th>
                        <th className="pb-3 text-center">Physical Count</th>
                        <th className="pb-3 text-right">Variance</th>
                        <th className="pb-3 text-right pr-2">Impact (₱)</th>
                      </tr>
                    </thead>
                    <tbody className={isLocked ? 'opacity-50 pointer-events-none' : ''}>
                      {currentInventory.map(item => {
                        const actualInput = physicalCounts[item._id];
                        const hasInput = actualInput !== undefined && actualInput !== '';
                        const variance = hasInput ? Number(actualInput) - item.stockQty : 0;
                        const financialImpact = variance * (item.unitCost || 0);

                        const formattedImpact = financialImpact < 0 ? `-₱${Math.abs(financialImpact).toFixed(2)}` : `₱${financialImpact.toFixed(2)}`;

                        // --- REAL MOVEMENT MATH ---
                        const realIn = dailyMovement[item._id]?.in || 0;
                        const realOut = dailyMovement[item._id]?.out || 0;
                        // Since System End = Start + In - Out, then Start = System End - In + Out
                        const calculatedStart = item.stockQty - realIn + realOut;

                        return (
                          <tr key={item._id} className={`border-b border-gray-800/50 hover:bg-dark/30 transition ${hasInput && variance !== 0 ? 'bg-red-900/5' : ''}`}>
                            
                            <td className="py-4">
                              <p className="font-bold text-dark">{item.itemName}</p>
                              <p className="text-[10px] text-dark font-mono mt-1">
                                Start: {calculatedStart.toLocaleString()} | <span className="text-black">In: {realIn.toLocaleString()}</span> | <span className="text-black">Out: {realOut.toLocaleString()}</span>
                              </p>
                              
                              {hasInput && variance !== 0 && !isLocked && (
                                <div className="mt-2 space-y-1.5">
                                  {varianceNoteMode[item._id] ? (
                                    <div className="flex flex-col gap-1">
                                      <div className="flex items-center gap-1">
                                        <span className="text-[9px] text-gray-400 uppercase font-bold tracking-wider">Note</span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setVarianceNoteMode({...varianceNoteMode, [item._id]: false});
                                            setVarianceReasons({...varianceReasons, [item._id]: ''});
                                          }}
                                          className="text-[9px] text-gray-500 hover:text-white ml-auto"
                                        >← back</button>
                                      </div>
                                      <textarea
                                        rows={2}
                                        placeholder="Describe reason..."
                                        value={varianceReasons[item._id] || ''}
                                        onChange={(e) => setVarianceReasons({...varianceReasons, [item._id]: e.target.value})}
                                        className="w-full max-w-[220px] bg-dark border border-gray-600 text-black text-[10px] rounded p-1.5 outline-none focus:border-accent resize-none"
                                      />
                                    </div>
                                  ) : (
                                    <select
                                      value={varianceReasons[item._id] || ''}
                                      onChange={(e) => {
                                        if (e.target.value === '__note__') {
                                          setVarianceNoteMode({...varianceNoteMode, [item._id]: true});
                                          setVarianceReasons({...varianceReasons, [item._id]: ''});
                                        } else {
                                          setVarianceReasons({...varianceReasons, [item._id]: e.target.value});
                                        }
                                      }}
                                      className={`w-full max-w-[200px] bg-dark border text-[10px] rounded p-1 outline-none ${variance > 0 ? 'border-green-700/60 text-green-700 focus:border-green-500' : 'border-red-900/60 text-red-500 focus:border-red-500'}`}
                                    >
                                      <option value="" disabled>Select Reason...</option>
                                      {variance > 0 ? (
                                        <>
                                          <option value="Previous Miscount">Previous Miscount</option>
                                          <option value="__note__">Add Note...</option>
                                        </>
                                      ) : (
                                        <>
                                          <option value="Damaged/Spoiled">Damaged / Spoiled</option>
                                          <option value="Prep Waste">Preparation Waste</option>
                                          <option value="Previous Miscount">Previous Miscount</option>
                                          <option value="Unaccounted Loss">Unaccounted / Suspected Theft</option>
                                          <option value="__note__">Add Note...</option>
                                        </>
                                      )}
                                    </select>
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="py-4 text-right text-dark font-mono text-sm">
                              {item.stockQty.toLocaleString()} <span className="text-[10px] text-dark">{item.unit}</span>
                            </td>

                            <td className="py-4 text-center align-top pt-5">
                              <input 
                                type="number" 
                                placeholder={isLocked ? "LOCKED" : "Count..."} 
                                disabled={isLocked}
                                className={`w-24 bg-dark border rounded p-1.5 outline-none text-center text-sm font-mono transition mx-auto
                                  ${isLocked ? 'border-gray-800 text-gray-600 bg-gray-900/20' :
                                    hasInput && variance < 0 ? 'border-red-500 text-black shadow-[0_0_10px_rgba(239,68,68,0.1)]' :
                                    hasInput && variance > 0 ? 'border-green-500 text-black' :
                                    hasInput && variance === 0 ? 'border-gray-600 text-black' :
                                    'border-gray-700 text-black focus:border-accent'}`
                                }
                                value={hasInput ? actualInput : ''}
                                onChange={(e) => setPhysicalCounts({...physicalCounts, [item._id]: e.target.value})}
                              />
                            </td>

                            <td className={`py-4 text-right font-black font-mono text-sm align-top pt-6 ${variance < 0 ? 'text-red-300' : variance > 0 ? 'text-green-500' : 'text-dark'}`}>
                              {hasInput ? (variance > 0 ? `+${variance}` : variance) : '-'}
                            </td>

                            <td className={`py-4 text-right font-mono text-xs pr-2 font-bold align-top pt-6 ${financialImpact < 0 ? 'text-red-300' : financialImpact > 0 ? 'text-green-400' : 'text-dark'}`}>
                              {hasInput ? formattedImpact : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {/* --- INVENTORY PAGINATION CONTROLS --- */}
                  {totalInvPages > 1 && (
                    <div className="flex justify-between items-center bg-dark p-3 rounded-lg border border-gray-800 mt-4">
                      <button 
                        onClick={() => setInvPage(prev => Math.max(prev - 1, 1))}
                        disabled={invPage === 1}
                        className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                      >
                        <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                      </button>
                      <span className="text-gray-400 text-xs font-bold tracking-widest">
                        PAGE <span className="text-accent text-sm">{invPage}</span> OF {totalInvPages}
                      </span>
                      <button 
                        onClick={() => setInvPage(prev => Math.min(prev + 1, totalInvPages))}
                        disabled={invPage === totalInvPages}
                        className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === totalInvPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                      >
                        <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                      </button>
                    </div>
                  )}

                  {/* SUMMARY FOOTER */}
                  {!isLocked && (
                    <div className="absolute bottom-0 left-0 right-0 bg-surface border-t border-gray-800 p-4 flex justify-between items-center rounded-b-xl">
                      <div className="flex gap-6">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Audit Status</p>
                          <p className={`text-sm font-black flex items-center gap-1 ${isComplete ? 'text-green-400' : 'text-yellow-500'}`}>
                            {isComplete ? <><CheckCircle size={13} /> All Items Counted</> : <><AlertTriangle size={13} /> {itemsCounted} / {inventory.length} Counted</>}
                          </p>
                        </div>
                        <div className="border-l border-gray-800 pl-6">
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Net Variance</p>
                          <p className="text-sm font-black text-gray-300">
                            {`${netVarianceQty > 0 ? '+' : ''}${netVarianceQty} Items`}
                          </p>
                        </div>
                        <div className="border-l border-gray-800 pl-6">
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Total Financial Impact</p>
                          <p className={`text-sm font-black ${netImpact < 0 ? 'text-red-500' : netImpact > 0 ? 'text-green-500' : 'text-gray-300'}`}>
                            {netImpact < 0 ? `-₱${Math.abs(netImpact).toFixed(2)}` : `₱${netImpact.toFixed(2)}`}
                          </p>
                        </div>
                      </div>
                      
                      <button 
                        disabled={!isComplete}
                        onClick={() => {
                          const missingReasons = itemsWithVariance.filter(i => !varianceReasons[i._id]);
                          if (missingReasons.length > 0) return alert("Please assign a reason for all items with variances before submitting.");
                          if(window.confirm(`LOCK END OF DAY?\n\nItems with variance: ${itemsWithVariance.length}\nTotal Financial Impact: ${netImpact < 0 ? '-' : ''}₱${Math.abs(netImpact).toFixed(2)}\n\nThis will update your permanent system stock to match your physical counts. Proceed?`)) {
                            submitPhysicalCounts();
                          }
                        }} 
                        className={`px-8 py-3 rounded font-black uppercase tracking-wider text-xs shadow-lg transition
                          ${!isComplete ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-500 shadow-red-500/20'}`}
                      >
                        {isComplete ? 'Submit & Lock EOD' : 'Incomplete Audit'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          {/* RIGHT COLUMN: Procurement Panel */}
          <div className="w-full xl:w-96 bg-surface border border-gray-800 rounded-xl p-6 h-fit">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-800 pb-2">Procurement (Receive Inventory)</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Item Name</label>
                <input 
                  type="text" 
                  list="inventory-names" 
                  placeholder="e.g., Condensed Milk" 
                  value={invForm.itemName} 
                  onChange={e => {
                    const typed = e.target.value;
                    const match = inventory.find(i => i.itemName.toLowerCase() === typed.toLowerCase());
                    setInvForm({...invForm, itemName: typed, unit: match ? match.unit : invForm.unit});
                  }} 
                  className="w-full bg-dark border border-gray-700 rounded p-2 text-black outline-none focus:border-accent" 
                />
                <datalist id="inventory-names">
                  {inventory.map(inv => <option key={inv._id} value={inv.itemName} />)}
                </datalist>
                
                {inventory.some(i => i.itemName.toLowerCase() === invForm.itemName.toLowerCase().trim()) && (
                  <p className="text-[10px] text-accent font-bold mt-1 uppercase tracking-wider">★ Existing Item: Will be Restocked</p>
                )}
              </div>
              <div className="flex gap-2">
                 <div className="w-1/3">
                   <label className="text-[10px] text-gray-400 block mb-1 uppercase font-bold">Qty Bought</label>
                   <input type="number" placeholder="Cans/Packs" value={invForm.packQty} onChange={e => setInvForm({...invForm, packQty: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-black outline-none focus:border-accent" />
                 </div>
                 <div className="w-1/3">
                   <label className="text-[10px] text-gray-400 block mb-1 uppercase font-bold">Weight/Vol</label>
                   <input type="number" placeholder="Per Pack" value={invForm.unitPerPack} onChange={e => setInvForm({...invForm, unitPerPack: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-black outline-none focus:border-accent" />
                 </div>
                 <div className="w-1/3">
                   <label className="text-[10px] text-gray-400 block mb-1 uppercase font-bold">Unit</label>
                   <select value={invForm.unit} onChange={e => setInvForm({...invForm, unit: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-black outline-none focus:border-accent">
                     <option value="" disabled>Select...</option>
                     <option value="g">Grams (g)</option>
                     <option value="ml">mL (ml)</option>
                     <option value="pcs">Pieces (pcs)</option>
                   </select>
                 </div>
              </div>
              
              {/* --- UPDATED PRICE SECTION WITH CASH VALIDATION --- */}
              {/* --- UPDATED PRICE SECTION WITH RED INPUT WARNING --- */}
              {(() => {
                const totalPurchaseCost = (parseFloat(invForm.packQty) || 0) * (parseFloat(invForm.costPerPack) || 0);
                const isOverBudget = cashOnHand < totalPurchaseCost;

                return (
                  <div>
                    <div className="flex justify-between items-end mb-1">
                      <label className={`text-[10px] uppercase font-bold transition-colors ${isOverBudget ? 'text-red-400' : 'text-gray-400'}`}>
                        Price Paid Per Pack/Can (P)
                      </label>
                      <span className={`text-[10px] font-bold tracking-wider ${isOverBudget ? 'text-red-400 animate-pulse' : 'text-green-400'}`}>
                        Available Cash: ₱{cashOnHand.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    
                    <input 
                      type="number" 
                      placeholder="e.g., 45.00" 
                      value={invForm.costPerPack} 
                      onChange={e => setInvForm({...invForm, costPerPack: e.target.value})} 
                      className={`w-full bg-dark border rounded p-2 outline-none transition-all ${
                        isOverBudget 
                        ? 'border-red-500  text-red-400 focus:border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                        : 'border-gray-700 text-black focus:border-accent'
                      }`} 
                    />
                  </div>
                );
              })()}
              
              {(invForm.packQty && invForm.unitPerPack && invForm.costPerPack && invForm.unit) && (
                <div className="bg-dark/50 p-3 rounded border border-gray-700 text-sm">
                  <p className="text-black font-bold mb-1">System will save to inventory:</p>
                  <div className="flex justify-between font-bold text-white mb-1">
                    <span>Total Stock Added:</span>
                    <span className="text-dark">{(invForm.packQty * invForm.unitPerPack).toLocaleString()} {invForm.unit}</span>
                  </div>
                  <div className="flex justify-between font-bold text-dark mb-1">
                    <span>Cost per {invForm.unit}:</span>
                    <span className="text-dark">P{(invForm.costPerPack / invForm.unitPerPack).toFixed(4)}</span>
                  </div>
                  
                  {/* --- NEW: TOTAL COST ROW --- */}
                  <div className="flex justify-between font-bold text-white border-t border-gray-700 pt-2 mt-2">
                    <span>Total Purchase Cost:</span>
                    <span className={cashOnHand < (invForm.packQty * invForm.costPerPack) ? "text-red-400" : "text-black"}>
                      P{(invForm.packQty * invForm.costPerPack).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              
              {/* --- UPDATED SUBMIT BUTTON (DISABLED IF INSUFFICIENT FUNDS) --- */}
              <button 
                onClick={addInventory} 
                disabled={cashOnHand < (invForm.packQty * invForm.costPerPack)}
                className={`w-full font-bold py-3 rounded transition shadow-lg ${cashOnHand < (invForm.packQty * invForm.costPerPack) ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-accent text-dark hover:bg-dark hover:text-accent shadow-accent/20'}`}
              >
                {cashOnHand < (invForm.packQty * invForm.costPerPack) ? 'Insufficient Funds' : 'Add to Stock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- ACCOUNTING & LEDGER TAB --- */}
      {activeTab === 'ledger' && (
        <div className="flex flex-col xl:flex-row gap-8">
          
          {/* LEFT COLUMN: Balances & New Entry Form */}
          <div className="w-full xl:w-1/3 space-y-6">
            
            {/* --- LIVE CASH ON HAND --- */}
            <div className="bg-accent border border-accent/30 rounded-xl p-6 shadow-lg shadow-accent/5">
              <p className="text-black text-xs font-bold uppercase tracking-wider mb-1">Live Cash on Hand</p>
              <p className="text-4xl font-black text-dark">P{cashOnHand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>

            <div className="bg-surface border border-gray-800 rounded-xl p-6 h-fit">
              <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">New Journal Entry</h3>
              <div className="space-y-4">
                <input type="text" placeholder="Description / Memo" value={jeForm.description} onChange={e => setJeForm({...jeForm, description: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-black outline-none" />
                {jeForm.lines.map((line, idx) => (
                  <div key={idx} className="bg-accent p-3 rounded border border-gray-700 space-y-2">
                    <select value={line.accountCode} onChange={(e) => {
                      const acc = standardAccounts.find(a => a.accountCode === e.target.value);
                      const newLines = [...jeForm.lines];
                      newLines[idx] = { ...line, accountCode: acc.accountCode, accountName: acc.accountName };
                      setJeForm({...jeForm, lines: newLines});
                    }} className="w-full bg-dark border border-gray-600 rounded p-2 text-sm text-black">
                      <option value="">Select Account...</option>
                      {standardAccounts.map(acc => <option key={acc.accountCode} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <input type="number" placeholder="Debit" value={line.debit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].debit = e.target.value; nl[idx].credit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-dark border border-gray-600 rounded p-2 text-sm text-black placeholder-gray-500" />
                      <input type="number" placeholder="Credit" value={line.credit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].credit = e.target.value; nl[idx].debit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-dark border border-gray-600 rounded p-2 text-sm text-black placeholder-gray-500" />
                    </div>
                  </div>
                ))}
                <button onClick={() => setJeForm({...jeForm, lines: [...jeForm.lines, {accountCode:'', accountName:'', debit:'', credit:''}]})} className="text-xs text-accent hover:text-white">+ Add Line</button>
                <div className="border-t border-gray-800 pt-4 mt-4 flex justify-between items-center">
                  <div className="text-xs text-gray-400">
                    Debits: {jeForm.lines.reduce((s, l) => s + Number(l.debit||0), 0)} <br/>
                    Credits: {jeForm.lines.reduce((s, l) => s + Number(l.credit||0), 0)}
                  </div>
                  <button onClick={async () => {
                    await apiFetch(`/api/journal`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(jeForm) });
                    setJeForm({ description: '', lines: [{accountCode:'', accountName:'', debit:'', credit:''}, {accountCode:'', accountName:'', debit:'', credit:''}] });
                    fetchERPData();
                  }} className="bg-accent text-dark font-bold py-2 px-4 rounded hover:bg-dark hover:text-accent transition shadow-lg shadow-accent/20">Post Entry</button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: General Ledger */}
          <div className="flex-1 bg-surface border border-gray-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
              <h3 className="text-xl font-bold text-white">General Ledger</h3>
              <button onClick={exportLedgerToPDF} className="text-[10px] bg-accent border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-dark hover:text-accent transition font-bold uppercase tracking-wider">
                Export Ledger
              </button>
            </div>
            <div className="space-y-4">
              {currentEntries.map(entry => (
                <div key={entry._id} className="bg-dark border border-gray-700 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
                    <span className="text-accent font-bold">{entry.reference}</span>
                    <span className="text-black text-sm">{new Date(entry.date).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-black mb-3 font-semibold">{entry.description}</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-black text-left"><th className="pb-2">Account</th><th className="pb-2 text-right">Debit</th><th className="pb-2 text-right">Credit</th></tr></thead>
                    <tbody>
                      {entry.lines.map((line, idx) => (
                        <tr key={idx} className="border-t border-gray-800/50">
                          <td className={`py-1 ${line.credit > 0 ? 'pl-6 text-black' : 'text-gray-600'}`}>{line.accountCode} - {line.accountName}</td>
                          <td className="py-1 text-right text-gray-600">{line.debit > 0 ? line.debit.toFixed(2) : ''}</td>
                          <td className="py-1 text-right text-gray-600">{line.credit > 0 ? line.credit.toFixed(2) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {/* --- ACCOUNTING PAGINATION CONTROLS --- */}
              {totalAccountingPages > 1 && (
                <div className="flex justify-between items-center bg-dark p-3 rounded-lg border border-gray-800 mt-4">
                  <button 
                    onClick={() => setAccountingPage(prev => Math.max(prev - 1, 1))}
                    disabled={accountingPage === 1}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                  </button>
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    PAGE <span className="text-accent text-sm">{accountingPage}</span> OF {totalAccountingPages}
                  </span>
                  <button 
                    onClick={() => setAccountingPage(prev => Math.min(prev + 1, totalAccountingPages))}
                    disabled={accountingPage === totalAccountingPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === totalAccountingPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* --- PRICING & DISCOUNTS TAB --- */}
      {activeTab === 'pricing' && (
        <div className="flex flex-col lg:flex-row gap-6 h-auto lg:h-[calc(100vh-180px)]">
          
          {/* LEFT COLUMN: Read-Only Pricing Table */}
          <div className="flex-1 bg-surface border border-gray-800 rounded-xl p-6 overflow-y-auto custom-scrollbar min-h-[400px] lg:min-h-0 lg:h-full">
            <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Product Pricing Masterlist</h3>
            
            {/* Added overflow-x wrapper so it scrolls sideways on small screens instead of breaking the layout */}
            <div className="overflow-x-auto pr-2">
              <table className="w-full text-left text-sm min-w-[500px]">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="pb-3 uppercase tracking-wider text-xs">Product Name</th>
                    <th className="pb-3 uppercase tracking-wider text-xs">Category</th>
                    <th className="pb-3 text-right uppercase tracking-wider text-xs">Size / Option</th>
                    <th className="pb-3 text-right uppercase tracking-wider text-xs">Selling Price</th>
                  </tr>
                </thead>
                <tbody>
                  {products.length === 0 ? (
                    <tr><td colSpan="4" className="py-4 text-center text-gray-500">No products found.</td></tr>
                  ) : currentPricingProducts.flatMap(p => {
                    // We now track the exact productId and sizeIndex so the backend knows what to update
                    const rows = [{ id: `${p._id}-base`, productId: p._id, sizeIndex: null, name: p.name, cat: p.category, size: p.baseSize || 'Regular', price: p.basePrice || p.price || 0 }];
                    if (p.sizes) {
                      p.sizes.forEach((s, idx) => {
                        rows.push({ id: `${p._id}-size-${idx}`, productId: p._id, sizeIndex: idx, name: '', cat: '', size: s.name, price: s.price });
                      });
                    }
                    return rows;
                  }).map((row) => (
                    <tr key={row.id} className={`border-gray-800/50 hover:bg-dark/30 transition ${row.name !== '' ? 'border-t' : ''}`}>
                      <td className={`py-2 font-bold ${row.name !== '' ? 'text-gray-200 pt-4' : ''}`}>{row.name}</td>
                      <td className={`py-2 text-xs text-gray-500 ${row.name !== '' ? 'pt-4' : ''}`}>{row.cat}</td>
                      <td className={`py-2 text-right text-gray-400 ${row.name !== '' ? 'pt-4' : ''}`}>{row.size}</td>
                      
                      {/* --- INLINE EDITING UI --- */}
                      <td className={`py-2 text-right font-mono font-bold text-accent ${row.name !== '' ? 'pt-4' : ''}`}>
                        {editPriceId === row.id ? (
                          <div className="flex justify-end items-center gap-2">
                            <input 
                              type="number" 
                              step="0.01" 
                              className="w-20 bg-dark border border-accent rounded px-2 py-1 text-black outline-none text-right"
                              value={editPriceVal}
                              onChange={(e) => setEditPriceVal(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => { if (e.key === 'Enter') handleInlinePriceUpdate(row.productId, row.sizeIndex); }}
                            />
                            <button onClick={() => handleInlinePriceUpdate(row.productId, row.sizeIndex)} className="text-green-400 hover:text-green-300 flex items-center"><Check size={14} /></button>
                            <button onClick={() => setEditPriceId(null)} className="text-red-400 hover:text-red-300">✕</button>
                          </div>
                        ) : (
                          <div 
                            className="cursor-pointer hover:bg-white/10 px-2 py-1 rounded inline-flex items-center gap-2 transition group"
                            onClick={() => { setEditPriceId(row.id); setEditPriceVal(row.price); }}
                          >
                            P{Number(row.price).toFixed(2)}
                            <span className="text-[10px] text-gray-500 group-hover:text-accent">✎</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* --- PRICING PAGINATION CONTROLS --- */}
            {totalPricingPages > 1 && (
              <div className="flex justify-between items-center bg-dark p-3 rounded-lg border border-gray-800 mt-4 shrink-0">
                <button 
                  onClick={() => setPricingPage(prev => Math.max(prev - 1, 1))}
                  disabled={pricingPage === 1}
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${pricingPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                </button>
                <span className="text-gray-400 text-xs font-bold tracking-widest">
                  PAGE <span className="text-accent text-sm">{pricingPage}</span> OF {totalPricingPages}
                </span>
                <button 
                  onClick={() => setPricingPage(prev => Math.min(prev + 1, totalPricingPages))}
                  disabled={pricingPage === totalPricingPages}
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${pricingPage === totalPricingPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                </button>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Discount CRUD */}
          {/* Changed width breaks to lg:w-80 so it perfectly fits beside the table on tablets */}
          <div className="w-full lg:w-80 xl:w-96 bg-surface border border-gray-800 rounded-xl p-6 min-h-[400px] lg:min-h-0 lg:h-full overflow-y-auto custom-scrollbar flex flex-col">
            <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Discount Rules</h3>
            
            <div className="flex-1 overflow-y-auto mb-6 pr-2 scrollbar-thin scrollbar-thumb-gray-700">
              <div className="space-y-3">
                {discounts.length === 0 ? (
                  <p className="text-sm text-gray-500 italic text-center py-4">No custom discounts set.</p>
                ) : discounts.map(d => (
                  <div key={d._id} className="bg-dark p-3 rounded-lg border border-gray-700 flex justify-between items-center">
                    <div>
                      {/* Fixed black text bug here! */}
                      <p className="font-bold text-accent text-sm">{d.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{d.percentage}% OFF</p>
                    </div>
                    <button 
                      onClick={async () => {
                        if (window.confirm(`Delete ${d.name} discount?`)) {
                          await apiFetch(`/api/discounts/${d._id}`, { method: 'DELETE' });
                          fetchData(); // Refresh the list
                        }
                      }} 
                      className="text-red-500 hover:text-red-400 font-bold px-2 py-1 bg-red-900/20 rounded transition"
                    >
                      Del
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-800 pt-4 mt-auto shrink-0">
              <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-3">Add New Discount</h4>
              <form 
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!discountForm.name || !discountForm.percentage) return;
                  await apiFetch(`/api/discounts`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: discountForm.name, percentage: Number(discountForm.percentage) })
                  });
                  setDiscountForm({ name: '', percentage: '' });
                  fetchData(); // Refresh the list
                }} 
                className="space-y-3"
              >
                <div>
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Discount Name</label>
                  <input type="text" placeholder="e.g., PWD, Senior Citizen" value={discountForm.name} onChange={(e) => setDiscountForm({...discountForm, name: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-sm text-black outline-none focus:border-accent" required />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Percentage (%)</label>
                  <input type="number" placeholder="e.g., 20" max="100" min="1" value={discountForm.percentage} onChange={(e) => setDiscountForm({...discountForm, percentage: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-sm text-black outline-none focus:border-accent" required />
                </div>
                <button type="submit" className="w-full bg-accent text-dark font-black py-3 rounded hover:bg-white transition shadow-lg shadow-accent/20 uppercase tracking-wider text-xs">
                  Save Rule
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

{/* --- AUDIT REPORT --- */}
      {activeTab === 'audit' && (() => {
        const now = new Date();
        const cutoff = auditFilter === 'today'
          ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
          : auditFilter === '7d'
          ? new Date(now - 7 * 86400000)
          : auditFilter === '30d'
          ? new Date(now - 30 * 86400000)
          : new Date(0);

        const allOrdersPool = [
          ...orders,
          ...archivedOrders,
        ];
        const inRange = allOrdersPool.filter(o => new Date(o.createdAt) >= cutoff);

        const cancelled = inRange.filter(o => o.status === 'Cancelled' || o.status === 'Voided');
        const comps = inRange.filter(o => o.isComplimentary && o.status === 'Completed');
        const discounted = inRange.filter(o => !o.isComplimentary && o.status === 'Completed' && (o.discount || 0) > 0);
        const staffSet = new Set(inRange.filter(o => o.cashier && o.cashier !== 'System').map(o => o.cashier));

        const totalCancelledValue = cancelled.reduce((s, o) => s + (o.subtotal || 0), 0);
        const totalCompValue = comps.reduce((s, o) => s + (o.subtotal || 0), 0);
        const totalDiscountValue = discounted.reduce((s, o) => s + (o.discount || 0), 0);

        const fmtDate = (d) => {
          const dt = new Date(d);
          return dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' ' +
            dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        };

        return (
          <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">

            {/* Header + Filter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  <ShieldCheck size={20} className="text-brand" /> Audit Report
                </h2>
                <p className="text-white/30 text-xs font-medium mt-0.5">Exception log — cancelled orders, complimentaries, and discounts</p>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[['today','Today'],['7d','7 Days'],['30d','30 Days'],['all','All Time']].map(([val, lbl]) => (
                  <button key={val} onClick={() => setAuditFilter(val)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition ${auditFilter === val ? 'bg-brand text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-surface border border-white/8 rounded-xl p-4">
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-1">Cancelled / Voided</p>
                <p className="text-2xl font-black text-red-400">{cancelled.length}</p>
                <p className="text-[10px] text-red-400/60 font-bold mt-0.5">₱{totalCancelledValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lost</p>
              </div>
              <div className="bg-surface border border-white/8 rounded-xl p-4">
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-1">Complimentary</p>
                <p className="text-2xl font-black text-yellow-400">{comps.length}</p>
                <p className="text-[10px] text-yellow-400/60 font-bold mt-0.5">₱{totalCompValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} waived</p>
              </div>
              <div className="bg-surface border border-white/8 rounded-xl p-4">
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-1">Discounts Given</p>
                <p className="text-2xl font-black text-brand">{discounted.length}</p>
                <p className="text-[10px] text-brand/60 font-bold mt-0.5">₱{totalDiscountValue.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} off</p>
              </div>
              <div className="bg-surface border border-white/8 rounded-xl p-4">
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-wider mb-1">Active Staff</p>
                <p className="text-2xl font-black text-white">{staffSet.size}</p>
                <p className="text-[10px] text-white/30 font-bold mt-0.5">in period</p>
              </div>
            </div>

            {/* Cancelled / Voided Table */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                <XCircle size={14} className="text-red-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Cancelled &amp; Voided Orders</h3>
                <span className="ml-auto text-[10px] bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-bold">{cancelled.length}</span>
              </div>
              {cancelled.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">No cancelled or voided orders in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[540px]">
                    <thead>
                      <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <th className="px-5 py-2.5">Date / Time</th>
                        <th className="px-5 py-2.5">Customer</th>
                        <th className="px-5 py-2.5">Cashier</th>
                        <th className="px-5 py-2.5 text-right">Amount</th>
                        <th className="px-5 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cancelled.slice(0, 50).map(o => (
                        <tr key={o._id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition">
                          <td className="px-5 py-2.5 text-xs text-white/40 font-mono">{fmtDate(o.createdAt)}</td>
                          <td className="px-5 py-2.5 text-xs text-white/70 font-bold">{o.customerName || '—'}</td>
                          <td className="px-5 py-2.5 text-xs text-white/40">{o.cashier || '—'}</td>
                          <td className="px-5 py-2.5 text-xs text-right font-mono text-red-400">₱{(o.subtotal || 0).toFixed(2)}</td>
                          <td className="px-5 py-2.5">
                            <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${o.status === 'Voided' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'}`}>{o.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {cancelled.length > 50 && <p className="text-white/20 text-[10px] text-center py-2 font-bold">Showing 50 of {cancelled.length} — narrow the date range to see more</p>}
                </div>
              )}
            </div>

            {/* Complimentary Orders Table */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                <Gift size={14} className="text-yellow-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Complimentary Orders</h3>
                <span className="ml-auto text-[10px] bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-full font-bold">{comps.length}</span>
              </div>
              {comps.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">No complimentary orders in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[560px]">
                    <thead>
                      <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <th className="px-5 py-2.5">Date / Time</th>
                        <th className="px-5 py-2.5">Customer</th>
                        <th className="px-5 py-2.5">Reason</th>
                        <th className="px-5 py-2.5">Cashier</th>
                        <th className="px-5 py-2.5 text-right">Value Waived</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comps.slice(0, 50).map(o => (
                        <tr key={o._id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition">
                          <td className="px-5 py-2.5 text-xs text-white/40 font-mono">{fmtDate(o.createdAt)}</td>
                          <td className="px-5 py-2.5 text-xs text-white/70 font-bold">{o.customerName || '—'}</td>
                          <td className="px-5 py-2.5 text-xs text-yellow-400/80">{COMP_REASON_LABELS[o.reasonType] || o.reasonType || o.reasonNote || '—'}</td>
                          <td className="px-5 py-2.5 text-xs text-white/40">{o.cashier || '—'}</td>
                          <td className="px-5 py-2.5 text-xs text-right font-mono text-yellow-400">₱{(o.subtotal || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {comps.length > 50 && <p className="text-white/20 text-[10px] text-center py-2 font-bold">Showing 50 of {comps.length} — narrow the date range to see more</p>}
                </div>
              )}
            </div>

            {/* Discount Activity Table */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                <DollarSign size={14} className="text-brand" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Discount Activity</h3>
                <span className="ml-auto text-[10px] bg-brand/15 text-brand px-2 py-0.5 rounded-full font-bold">{discounted.length}</span>
              </div>
              {discounted.length === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">No discounted orders in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[560px]">
                    <thead>
                      <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <th className="px-5 py-2.5">Date / Time</th>
                        <th className="px-5 py-2.5">Customer</th>
                        <th className="px-5 py-2.5">Type</th>
                        <th className="px-5 py-2.5">Cashier</th>
                        <th className="px-5 py-2.5 text-right">Discount Amt</th>
                        <th className="px-5 py-2.5 text-right">Net Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discounted.slice(0, 50).map(o => (
                        <tr key={o._id} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition">
                          <td className="px-5 py-2.5 text-xs text-white/40 font-mono">{fmtDate(o.createdAt)}</td>
                          <td className="px-5 py-2.5 text-xs text-white/70 font-bold">{o.customerName || '—'}</td>
                          <td className="px-5 py-2.5 text-xs text-brand/80 font-bold">{o.discountType || 'Promo'}</td>
                          <td className="px-5 py-2.5 text-xs text-white/40">{o.cashier || '—'}</td>
                          <td className="px-5 py-2.5 text-xs text-right font-mono text-brand">-₱{(o.discount || 0).toFixed(2)}</td>
                          <td className="px-5 py-2.5 text-xs text-right font-mono text-white/70">₱{(o.total || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {discounted.length > 50 && <p className="text-white/20 text-[10px] text-center py-2 font-bold">Showing 50 of {discounted.length} — narrow the date range to see more</p>}
                </div>
              )}
            </div>

            {/* Staff Activity Summary */}
            <div className="bg-surface border border-white/8 rounded-xl overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-white/8 flex items-center gap-2">
                <Users size={14} className="text-white/50" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">Staff Activity</h3>
              </div>
              {staffSet.size === 0 ? (
                <p className="text-white/20 text-sm p-6 text-center font-bold">No staff activity in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[440px]">
                    <thead>
                      <tr className="text-white/25 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
                        <th className="px-5 py-2.5">Staff Name</th>
                        <th className="px-5 py-2.5 text-right">Orders</th>
                        <th className="px-5 py-2.5 text-right">Cancelled</th>
                        <th className="px-5 py-2.5 text-right">Comps</th>
                        <th className="px-5 py-2.5 text-right">Net Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...staffSet].sort().map(name => {
                        const myOrders = inRange.filter(o => o.cashier === name);
                        const myCompleted = myOrders.filter(o => o.status === 'Completed' && !o.isComplimentary);
                        const myCancelled = myOrders.filter(o => o.status === 'Cancelled' || o.status === 'Voided');
                        const myComps = myOrders.filter(o => o.isComplimentary);
                        const myNet = myCompleted.reduce((s, o) => s + (o.total || 0), 0);
                        return (
                          <tr key={name} className="border-b border-white/5 last:border-0 hover:bg-white/3 transition">
                            <td className="px-5 py-2.5 text-xs text-white/80 font-black">{name}</td>
                            <td className="px-5 py-2.5 text-xs text-right text-white/50 font-mono">{myOrders.length}</td>
                            <td className="px-5 py-2.5 text-xs text-right font-mono">
                              <span className={myCancelled.length > 0 ? 'text-red-400' : 'text-white/20'}>{myCancelled.length}</span>
                            </td>
                            <td className="px-5 py-2.5 text-xs text-right font-mono">
                              <span className={myComps.length > 0 ? 'text-yellow-400' : 'text-white/20'}>{myComps.length}</span>
                            </td>
                            <td className="px-5 py-2.5 text-xs text-right font-mono text-brand font-bold">₱{myNet.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        );
      })()}

{/* --- MENU SETUP (PRODUCTS/CATEGORIES) --- */}
      {activeTab === 'products' && (
        // FIX 1: Changed h-fixed to h-auto on mobile, and added gap-6
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-auto lg:h-[calc(100vh-180px)]">
          
          {/* LEFT COLUMN: Menu Items, Categories, and Add-Ons */}
          {/* FIX 2: Added min-h-[500px] so it doesn't get crushed on mobile */}
          <div className="flex-1 bg-surface border border-white/8 shadow-md rounded-xl p-4 sm:p-6 overflow-y-auto custom-scrollbar min-h-[500px] lg:min-h-0">

            {/* 1. Menu Items List */}
            <h3 className="text-xl font-bold mb-4 text-white border-b border-white/8 pb-2">Menu Items</h3>
            <div className="space-y-3">
              {currentProducts.map(p => (
                <div key={p._id} className="flex flex-col sm:flex-row gap-4 p-4 border border-white/8 rounded-xl bg-surface-2 items-start sm:items-center">
                  
                  {/* Top section on mobile: Image + Text */}
                  <div className="flex gap-4 flex-1 w-full">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded-lg shadow-sm border border-white/10 shrink-0" />
                    ) : (
                      <div className="w-16 h-16 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center text-xs text-white/30 font-bold shrink-0">No Img</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-white truncate w-full sm:w-auto">{p.name} <span className="text-xs text-brand/70 ml-1">({p.category})</span></h4>
                        {(() => {
                          const est = getEstimatedStock(p.baseRecipe);
                          if (est === null) return null;
                          return (
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${est <= 0 ? 'bg-red-500/15 text-red-400' : est <= 5 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-green-500/15 text-green-400'}`}>
                              {est <= 0 ? 'Out of Stock' : `Est: ${est} left`}
                            </span>
                          );
                        })()}
                      </div>
                      {p.description && <p className="text-xs text-white/40 mt-1 line-clamp-2">{p.description}</p>}
                      <p className="text-sm text-white/70 font-bold mt-1">P{Number(p.basePrice || p.price || 0).toFixed(2)} {p.baseSize && <span className="text-xs text-white/30 font-normal">({p.baseSize})</span>} {p.sizes?.length > 0 && <span className="text-brand/70 text-xs ml-1">(+ {p.sizes.length} sizes)</span>}</p>
                    </div>
                  </div>

                  {/* Edit button: Full width on mobile, auto width on desktop */}
                  <div className="w-full sm:w-auto mt-2 sm:mt-0 shrink-0">
                    <button 
                      onClick={() => { 
                        setEditingProduct(p); 
                        setFormData({ 
                          name: p.name || '', category: p.category || '', description: p.description || '', 
                          basePrice: Number(p.basePrice || p.price || 0), baseSize: p.baseSize || '', 
                          sizes: p.sizes || [], image: p.image || '', baseRecipe: p.baseRecipe || [], addOns: p.addOns || []
                        }); 
                      }} 
                      className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-white/10 text-white rounded-lg text-sm font-bold hover:bg-brand hover:text-white transition flex items-center justify-center gap-2"
                    >
                      <Edit size={14} /> Edit
                    </button>
                  </div>
                </div>
              ))}
              {/* --- PAGINATION CONTROLS --- */}
            {totalPages > 1 && (
              <div className="flex justify-between items-center bg-dark p-4 rounded-xl border border-gray-800 mt-6 shrink-0">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1"><ChevronLeft size={12} /> Previous</span>
                </button>
                
                <span className="text-gray-400 text-sm font-bold tracking-widest">
                  PAGE <span className="text-accent text-lg">{currentPage}</span> OF {totalPages}
                </span>
                
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === totalPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                </button>
              </div>
            )}
            </div>
            
            {/* 2. Manage Categories */}
            <div className="mt-8 border-t border-white/8 pt-6">
              <h3 className="text-xl font-bold mb-4 text-white border-b border-white/8 pb-2">Manage Categories & Routing</h3>
              <form onSubmit={handleSaveCategory} className="flex gap-3 mb-6">
                <input
                  type="text"
                  value={catForm.name}
                  onChange={e => setCatForm({...catForm, name: e.target.value})}
                  placeholder="Category Name"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-semibold placeholder-white/20"
                  required
                />
                <select
                  value={catForm.department}
                  onChange={e => setCatForm({...catForm, department: e.target.value})}
                  className="w-32 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-bold"
                >
                  <option value="Kitchen">Kitchen</option>
                  <option value="Bar">Bar</option>
                </select>
                <button type="submit" className="bg-accent text-white font-bold px-6 py-2 rounded-lg hover:bg-opacity-90 transition shadow-md">
                  {editingCategory ? 'Update' : 'Add'}
                </button>
                {editingCategory && (
                  <button type="button" onClick={() => { setEditingCategory(null); setCatForm({ name: '', department: 'Kitchen' }); }} className="bg-white/10 text-white/70 font-bold px-4 py-2 rounded-lg hover:bg-white/20 transition">
                    Cancel
                  </button>
                )}
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {categories.map(c => (
                  <div key={c._id} className="flex justify-between items-center p-3 border border-white/8 rounded-xl bg-surface-2">
                    <div>
                      <span className="font-bold text-sm text-white block">{c.name}</span>
                      <span className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Routes to: {c.department || 'Kitchen'}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingCategory(c); setCatForm({ name: c.name, department: c.department || 'Kitchen' }); }} className="text-white/40 hover:text-brand p-1.5 rounded"><Edit size={16} /></button>
                      <button onClick={() => deleteCategory(c._id)} className="text-red-400 hover:text-red-300 p-1.5 rounded"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. MANAGE GLOBAL ADD-ONS */}
            <div className="mt-8 border-t border-white/8 pt-6">
              <h3 className="text-xl font-bold mb-4 text-white border-b border-white/8 pb-2">Manage Global Add-Ons (Sinkers, Shots)</h3>
              <form onSubmit={handleSaveAddOn} className="flex gap-3 mb-6">
                <input
                  type="text"
                  placeholder="Name (e.g. Popping Boba)"
                  value={addOnForm.name}
                  onChange={e => setAddOnForm({...addOnForm, name: e.target.value})}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-semibold placeholder-white/20"
                  required
                />
                <input
                  type="number"
                  placeholder="Price"
                  value={addOnForm.price}
                  onChange={e => setAddOnForm({...addOnForm, price: e.target.value})}
                  className="w-24 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-bold placeholder-white/20"
                  required
                />
                <select
                  value={addOnForm.category}
                  onChange={e => setAddOnForm({...addOnForm, category: e.target.value})}
                  className="w-32 bg-white/5 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-brand font-bold"
                >
                  <option value="Extras">Extras</option>
                  <option value="Sinkers">Sinkers</option>
                  <option value="Milks">Milks</option>
                </select>
                <button type="submit" className="bg-brand text-white font-bold px-6 py-2 rounded-lg hover:bg-brand-dark transition shadow-md">Add</button>
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {globalAddOns.map(a => (
                  <div key={a._id} className="flex justify-between items-center p-3 border border-white/8 rounded-xl bg-surface-2">
                    <div>
                      <span className="font-bold text-sm text-white block">{a.name}</span>
                      <span className="text-[10px] uppercase font-bold text-brand/70 tracking-wider">{a.category} • +P{a.price}</span>
                    </div>
                    <button onClick={() => deleteAddOn(a._id)} className="text-red-400 hover:text-red-300 bg-red-500/10 p-1.5 rounded"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Add Product Form */}
          {/* FIX 3: Added min-h-[600px] on mobile so the form has room to breathe */}
          <div className="w-full lg:w-96 bg-surface border border-white/8 rounded-xl p-4 sm:p-6 flex flex-col min-h-[600px] lg:min-h-0 lg:h-full overflow-hidden shadow-md">
            <h3 className="text-xl font-bold text-white mb-4 border-b border-white/8 pb-2 shrink-0">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </h3>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
              <form onSubmit={handleSaveProduct} className="space-y-4">
                {/* Basic Info */}
                <div>
                  <label className="block text-sm font-bold text-white/60 mb-2">Product Image</label>
                  <div className="flex items-center gap-4">
                    {formData.image ? (
                      <img src={formData.image} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-white/10 shadow-sm" />
                    ) : (
                      <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center text-xs text-white/25 font-bold">None</div>
                    )}
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm text-white/40 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-white/10 file:text-white hover:file:bg-white/20 cursor-pointer transition" />
                  </div>
                </div>
                <div><label className="block text-sm font-bold text-white/60 mb-1">Name</label><input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-brand font-semibold placeholder-white/20" /></div>
                <div>
                  <label className="block text-sm font-bold text-white/60 mb-1">Category</label>
                  <select required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-brand font-semibold">
                    <option value="" disabled>Select Category...</option>
                    {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className="block text-sm font-bold text-white/60 mb-1">Description</label><textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-brand h-20 placeholder-white/20 font-medium" /></div>
                
                {/* Base Size & Materials */}
                <div className="bg-surface-2 p-4 rounded-xl border border-white/8 mt-6">
                  <label className="block text-sm font-black text-white/80 mb-3 uppercase tracking-wider">Base Size / Standard Recipe</label>
                  <div className="flex gap-2 mb-2">
                    <input type="text" placeholder="Size Name (e.g. Regular)" value={formData.baseSize || ''} onChange={e => setFormData({...formData, baseSize: e.target.value})} className="w-1/2 bg-white/5 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-brand font-bold placeholder-white/20" />
                    <div className="w-1/2 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 font-bold">₱</span>
                      <input type="number" step="0.01" placeholder="Selling Price" value={formData.basePrice} onChange={e => setFormData({...formData, basePrice: parseFloat(e.target.value) || 0})} className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 pl-8 text-white outline-none focus:border-brand font-bold" />
                    </div>
                  </div>
                  
                  {(() => {
                    const baseCost = calcRecipeCost(formData.baseRecipe);
                    const basePriceVal = parseFloat(formData.basePrice) || 0;
                    const suggestedBasePrice = baseCost > 0 ? (baseCost / 0.7).toFixed(2) : '0.00';
                    const baseMargin = basePriceVal > 0 ? (((basePriceVal - baseCost) / basePriceVal) * 100).toFixed(1) : '0.0';
                    return baseCost > 0 ? (
                      <div className="flex justify-between text-[10px] px-1 mb-3">
                        <span className={parseFloat(baseMargin) >= 30 ? "text-green-400 font-black" : "text-yellow-400 font-black"}>Margin: {baseMargin}%</span>
                        <button type="button" onClick={() => setFormData({...formData, basePrice: parseFloat(suggestedBasePrice)})} className="text-white/30 hover:text-brand font-bold transition">Set 30% Margin (₱{suggestedBasePrice})</button>
                      </div>
                    ) : <div className="mb-3"></div>;
                  })()}
                  
                  <div className="bg-black/20 p-3 rounded-lg border border-white/8">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs text-white/40 font-black uppercase tracking-wider">Base Materials</span>
                      <span className="text-xs text-white font-black">Cost: ₱{calcRecipeCost(formData.baseRecipe).toFixed(2)}</span>
                    </div>
                    {(formData.baseRecipe || []).map((mat, i) => (
                      <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                        <span className="flex-1 text-white/70 font-semibold truncate">{mat.name}</span>
                        <input type="number" value={mat.qty} onChange={e => updateMaterialQty(e.target.value, i, null)} className="w-16 bg-white/5 border border-white/10 rounded p-1.5 text-center text-white font-bold" />
                        <span className="text-white/40 w-8 text-xs font-bold">{mat.unit}</span>
                        <button type="button" onClick={() => removeMaterial(i, null)} className="text-red-400 hover:text-red-300 ml-2"><X size={16} /></button>
                      </div>
                    ))}
                    <div className="mt-4 pt-3 border-t border-white/5">
                      <div className="text-[10px] text-brand uppercase font-black mb-2 tracking-widest flex items-center gap-1"><Plus size={12}/> Tap to Add Material</div>
                      <div className="max-h-32 overflow-y-auto bg-black/20 border border-white/8 rounded-lg custom-scrollbar p-1">
                        {inventory.length === 0 ? (
                          <p className="p-2 text-xs text-white/30 italic font-medium">No inventory available.</p>
                        ) : (
                          inventory.map(inv => (
                            <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, null)} className="w-full text-left px-3 py-2 text-xs text-white/60 font-bold hover:bg-white/10 transition rounded flex justify-between items-center">
                              <span className="truncate pr-2">{inv.itemName}</span>
                              <span className="text-white/30 shrink-0 font-mono">₱{inv.unitCost.toFixed(2)}/{inv.unit}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Extra Sizes */}
                <div className="border-t border-white/8 pt-5 mt-4">
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-sm font-black text-white/80 uppercase tracking-wider">Extra Sizes (Small, Large)</label>
                    <button type="button" onClick={addSize} className="text-xs bg-white/10 px-3 py-1.5 rounded-full font-bold text-white/70 border border-white/10 hover:bg-brand/20 hover:text-brand hover:border-brand/30 transition flex items-center gap-1"><Plus size={14}/> Add Size</button>
                  </div>

                  {(formData.sizes || []).map((size, idx) => (
                    <div key={idx} className="bg-surface-2 p-4 rounded-xl border border-white/8 mb-4">
                      <div className="flex gap-2 mb-2">
                        <input type="text" placeholder="Size Name" value={size.name} onChange={e => updateSize(idx, 'name', e.target.value)} className="w-1/2 bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white font-bold placeholder-white/20" required />
                        <input type="number" step="0.01" placeholder="Price" value={size.price} onChange={e => updateSize(idx, 'price', e.target.value)} className="w-1/3 bg-white/5 border border-white/10 rounded-lg p-2 text-sm text-white font-bold placeholder-white/20" required />
                        <button type="button" onClick={() => removeSize(idx)} className="text-white/30 hover:text-red-400 font-bold ml-auto px-2"><X size={20} /></button>
                      </div>

                      <div className="bg-black/20 p-3 rounded-lg border border-white/8 mt-3">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs text-white/40 font-black uppercase tracking-wider">{size.name || 'New Size'} Materials</span>
                          <span className="text-xs text-white font-black">Cost: ₱{calcRecipeCost(size.recipe).toFixed(2)}</span>
                        </div>
                        {(size.recipe || []).map((mat, i) => (
                          <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                            <span className="flex-1 text-white/70 font-semibold truncate">{mat.name}</span>
                            <input type="number" value={mat.qty} onChange={e => updateMaterialQty(e.target.value, i, idx)} className="w-16 bg-white/5 border border-white/10 rounded p-1.5 text-center text-white font-bold" />
                            <span className="text-white/40 w-8 text-xs font-bold">{mat.unit}</span>
                            <button type="button" onClick={() => removeMaterial(i, idx)} className="text-red-400 hover:text-red-300 ml-2"><X size={16} /></button>
                          </div>
                        ))}
                        <div className="mt-4 pt-3 border-t border-white/5">
                          <div className="text-[10px] text-brand uppercase font-black mb-2 tracking-widest flex items-center gap-1"><Plus size={12}/> Tap to Add Material</div>
                          <div className="max-h-28 overflow-y-auto bg-black/20 border border-white/8 rounded-lg custom-scrollbar p-1">
                            {inventory.map(inv => (
                              <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, idx)} className="w-full text-left px-3 py-2 text-xs text-white/60 font-bold hover:bg-white/10 transition rounded flex justify-between items-center">
                                <span className="truncate pr-2">{inv.itemName}</span>
                                <span className="text-white/30 shrink-0 font-mono">₱{inv.unitCost.toFixed(2)}/{inv.unit}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* --- OPTIONAL ADD-ONS CHECKBOXES --- */}
                <div className="border-t border-white/8 pt-5 mt-4 mb-4">
                  <label className="text-sm font-black text-white/80 uppercase tracking-wider mb-3 block">Attach Add-Ons</label>
                  <div className="grid grid-cols-2 gap-2">
                    {globalAddOns.map(addon => {
                      const isAttached = (formData.addOns || []).some(a => a.name === addon.name);
                      return (
                        <label key={addon._id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border-2 transition ${isAttached ? 'border-brand bg-brand/10 shadow-sm shadow-brand/10' : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'}`}>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-accent cursor-pointer"
                            checked={isAttached}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({ ...formData, addOns: [...(formData.addOns || []), { name: addon.name, price: addon.price, recipe: [] }] });
                              } else {
                                setFormData({ ...formData, addOns: (formData.addOns || []).filter(a => a.name !== addon.name) });
                              }
                            }}
                          />
                          <div className="flex flex-col">
                             <span className="text-sm font-bold text-white leading-tight">{addon.name}</span>
                             <span className="text-[10px] text-accent font-black uppercase tracking-widest">+₱{addon.price}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Save Buttons */}
                <div className="flex gap-3 mt-6 pt-4 border-t border-white/8">
                  {editingProduct && (
                    <button type="button" onClick={() => deleteProduct(editingProduct._id)} className="bg-red-500/10 text-red-400 font-bold py-3 px-4 rounded-xl hover:bg-red-500/20 transition flex items-center justify-center border border-red-500/20">
                      <Trash2 size={20} />
                    </button>
                  )}
                  <button type="submit" className="flex-1 bg-accent text-white font-black py-4 rounded-xl hover:bg-opacity-90 shadow-lg shadow-accent/20 transition uppercase tracking-wider text-sm">
                    {editingProduct ? 'Update Product' : 'Save Product'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      
      {/* --- STOCK MOVEMENT HISTORY MODAL --- */}
      {historyModalOpen && (() => {
        const totalHistPages = Math.ceil(stockHistory.length / HIST_PAGE_SIZE);
        const pagedHistory = stockHistory.slice((historyPage - 1) * HIST_PAGE_SIZE, historyPage * HIST_PAGE_SIZE);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-surface p-6 rounded-xl border border-gray-700 shadow-2xl flex flex-col max-w-2xl w-full max-h-[85vh]">
              <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3 flex-shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-white">Stock Card: <span className="text-accent">{historyItemName}</span></h2>
                  {stockHistory.length > 0 && <p className="text-[10px] text-gray-500 mt-0.5">{stockHistory.length} entries total</p>}
                </div>
                <button onClick={() => setHistoryModalOpen(false)} className="text-gray-400 hover:text-white font-bold text-xl">✕</button>
              </div>

              <div className="overflow-y-auto custom-scrollbar flex-1">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="text-gray-500 border-b border-gray-800 text-xs uppercase tracking-wider">
                      <th className="pb-2">Date</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2 text-right">In/Out</th>
                      <th className="pb-2 text-right">Unit Cost</th>
                      <th className="pb-2 text-right">Balance</th>
                      <th className="pb-2 pl-4">Remarks / Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockHistory.length === 0 ? (
                      <tr><td colSpan="6" className="py-4 text-center text-gray-500">No movement history recorded yet.</td></tr>
                    ) : pagedHistory.map((log, idx) => (
                      <tr key={idx} className="border-b border-gray-800/50 hover:bg-dark/30">
                        <td className="py-2 text-gray-400 text-xs">{new Date(log.date).toLocaleString()}</td>
                        <td className="py-2 font-bold text-gray-300">{log.type}</td>
                        <td className={`py-2 text-right font-mono font-bold ${log.qtyChange < 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {log.qtyChange > 0 ? `+${log.qtyChange}` : log.qtyChange}
                        </td>
                        <td className="py-2 text-right text-gray-400 font-mono text-xs">P{(log.unitCost || 0).toFixed(4)}</td>
                        <td className="py-2 text-right text-accent font-bold font-mono">{log.balanceAfter}</td>
                        <td className="py-2 pl-4 text-gray-500 text-xs">{log.remarks || log.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalHistPages > 1 && (
                <div className="flex justify-between items-center border-t border-gray-800 pt-3 mt-3 flex-shrink-0">
                  <button
                    onClick={() => setHistoryPage(p => Math.max(p - 1, 1))}
                    disabled={historyPage === 1}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${historyPage === 1 ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface-2 border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1"><ChevronLeft size={12} /> Prev</span>
                  </button>
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    PAGE <span className="text-accent text-sm">{historyPage}</span> OF {totalHistPages}
                  </span>
                  <button
                    onClick={() => setHistoryPage(p => Math.min(p + 1, totalHistPages))}
                    disabled={historyPage === totalHistPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${historyPage === totalHistPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface-2 border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    <span className="flex items-center gap-1">Next <ChevronRight size={12} /></span>
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
        </div>
      </div>
    </div>
  );
}
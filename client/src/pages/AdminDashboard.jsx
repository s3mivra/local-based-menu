import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Menu, Maximize, Minimize, X, Lock, Unlock, QrCode, TrendingUp, Package, Users, Settings, DollarSign, ShoppingCart, ChefHat, BarChart3, FileText, AlertCircle, Plus, Edit, Trash2, Eye, Download, RefreshCw, CheckCircle, Clock, Coffee, Minus } from 'lucide-react';
import jsPDF from 'jspdf';
import QRCode from 'react-qr-code';
import autoTable from 'jspdf-autotable';
const API_URL = 'https://local-based-menu-production.up.railway.app';
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || 'http://192.168.100.2:3000';

const socket = io(API_URL, {
  transports: ['websocket'],
  upgrade: false
});

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

export default function AdminDashboard() {
  const [pinInput, setPinInput] = useState('');
  const [paymentSelections, setPaymentSelections] = useState({});
  const ADMIN_PIN = '1234'; 

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
  const SECRET_TOKEN = 'cafe2026';
  const [countdown, setCountdown] = useState('');

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
  const [discountedItems, setDiscountedItems] = useState({}); // Tracks selected items per order

  // Change your default state to check local storage first
  const [activeAdmin, setActiveAdmin] = useState(() => {
    const saved = localStorage.getItem('kasa_admin');
    return saved ? JSON.parse(saved) : null;
  });
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('kasa_admin'));

  const [compSelections, setCompSelections] = useState({});
  const [shiftFilter, setShiftFilter] = useState('All');
  const [users, setUsers] = useState([]); // Stores the employee list

  const [globalAddOns, setGlobalAddOns] = useState([]);
  const [addOnForm, setAddOnForm] = useState({ name: '', price: '', category: 'Extras' });

  // --- MANUAL POS STATES ---
  const [isPosOpen, setIsPosOpen] = useState(false);
  const [posCart, setPosCart] = useState([]);
  const [posCategory, setPosCategory] = useState('All');
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
    
    if (response.status === 401 || response.status === 403) {
      setIsAuthenticated(false);
      setActiveAdmin(null);
      localStorage.removeItem('semivra_token');
    }
    return response;
  };

  // Update the login handler to save to local storage
  const handleSystemLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/users/login`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      
      if (data.success) {
        // TIER 1: Save the secure token to the browser
        localStorage.setItem('semivra_token', data.token); 
        setIsAuthenticated(true);
        setActiveAdmin(data.user); 
      } else {
        alert("Access Denied: Invalid name or password.");
      }
    } catch (err) { 
      console.error("Login failed", err); 
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('semivra_token'); 
    setIsAuthenticated(false);
    setLoginForm({name: '', password: ''});
    setActiveAdmin(null);
  };

  useEffect(() => {
    const token = localStorage.getItem('semivra_token');
    if (token) {
      // In a full production app, you'd verify the token with the backend here.
      // For now, if the token exists in storage, we bypass the login screen.
      setIsAuthenticated(true);
    }
  }, []);

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
      
      const jeRes = await apiFetch(`/api/journal`);
      if (jeRes.ok) setJournalEntries((await jeRes.json()).entries || []);
      
      const balRes = await apiFetch(`/api/finance/balances`);
      if (balRes.ok) setCashOnHand((await balRes.json()).cashOnHand || 0);
    } catch (err) { console.error('Failed to fetch ERP data', err); }
  };

  const fetchEODData = async () => {
    try {
      const res = await apiFetch(`/api/inventory/eod-data`);
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
        const employeesOnly = data.users.filter(u => u.name !== 'Super Admin');
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
      
      const archRes = await apiFetch(`/api/orders/archives?t=${cacheBuster}`, { cache: 'no-store' });
      if (archRes.ok) setArchivedOrders((await archRes.json()).archives || []);
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

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);
      const diff = midnight - now;

      const h = Math.floor((diff / (1000 * 60 * 60)) % 24).toString().padStart(2, '0');
      const m = Math.floor((diff / 1000 / 60) % 60).toString().padStart(2, '0');
      const s = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');

      setCountdown(`${h}h ${m}m ${s}s`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { if (isAuthenticated) fetchDiscounts(); }, [isAuthenticated]);

  // --- REAL-TIME AUTO REFRESH ---
  useEffect(() => {
    // Listen for inventory/restock/EOD updates
    socket.on('erpUpdated', () => {
      fetchERPData(); // Refresh your live inventory
      if (invSubTab === 'eod') {
        fetchEODData(); // Refresh the EOD math instantly
      }
    });

    // Listen for sales happening on the POS
    socket.on('orderUpdated', () => {
      fetchERPData(); 
      if (invSubTab === 'eod') {
        fetchEODData(); 
      }
    });

    // Cleanup listeners when component unmounts
    return () => {
      socket.off('erpUpdated');
      socket.off('orderUpdated');
    };
  }, [invSubTab]); // Re-run if they change sub-tabs

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchOrders();
    fetchData();
    fetchERPData();
    fetchUsers(); // <-- THE FIX: Load the employees!

    socket.on('newOrder', (order) => { setOrders(prev => [order, ...prev]); playKitchenDing(); });
    socket.on('orderUpdated', (updated) => setOrders(prev => prev.map(o => o._id === updated._id ? updated : o)));
    socket.on('menuUpdated', fetchData);
    socket.on('ordersArchived', fetchOrders); 
    socket.on('erpUpdated', fetchERPData); 

    return () => {
      socket.off('newOrder'); socket.off('orderUpdated'); socket.off('menuUpdated'); socket.off('ordersArchived'); socket.off('erpUpdated');
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
    
    const newItem = {
      productId: posSelectedProduct._id,
      name: finalName,
      price: finalPrice,
      quantity: 1,
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
      // FIX: If it's a delivery, auto-set the payment method. Otherwise, default to Cash!
      paymentMethod: ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(posTable) ? posTable : 'Cash',
      cashier: activeAdmin ? activeAdmin.name : 'System',
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
    // 1. Grab the order so we can check if it's a delivery
    const order = orders.find(o => o._id === orderId);
    
    const payload = { status: newStatus, cashier: activeAdmin ? activeAdmin.name : 'System' };
    
    if (newStatus === 'Preparing') {
      // 2. BULLETPROOF OVERRIDE: If it's a delivery, force it! Otherwise, use dropdown/existing.
      if (order && ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(order.table)) {
        payload.paymentMethod = order.table;
      } else {
        payload.paymentMethod = paymentSelections[orderId] || (order ? order.paymentMethod : 'Cash') || 'Cash';
      }
    }
    
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
    const empName = compSelections[orderId];
    if (!empName) return alert("Please select an employee for the complimentary item.");
    await apiFetch(`/api/orders/${orderId}`, { 
      method: 'PUT',
      body: JSON.stringify({ isComplimentary: true, employeeName: empName, discountPercent: 100, isVatExempt: true }) 
    });
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
    
    if (selectedObj && (selectedObj.name.toLowerCase().includes('pwd') || selectedObj.name.toLowerCase().includes('senior'))) {
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
  // --- 🖨️ THERMAL RECEIPT / ORDER SLIP PRINTER ---
  const printOrderSlip = async (order) => {
    try {
      // 1. Request Bluetooth Device (Chrome will pop up a pairing menu)
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'] // Standard 58mm Printer UUIDs
      });

      console.log('Connecting to GATT Server...');
      const server = await device.gatt.connect();

      // 2. Find the Printer Service and Writable Characteristic
      const services = await server.getPrimaryServices();
      let printCharacteristic = null;

      for (const service of services) {
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            printCharacteristic = char;
            break;
          }
        }
        if (printCharacteristic) break;
      }

      if (!printCharacteristic) throw new Error("Could not find printer write channel");

      // 3. The ESC/POS Encoder (Translates text to Printer Hardware Bytes)
      const encoder = new TextEncoder();
      let receiptData = [];

      const addBytes = (bytes) => receiptData.push(...bytes);
      const addText = (text) => addBytes(Array.from(encoder.encode(text)));

      // ESC/POS Commands
      const ESC_INIT = [0x1b, 0x40]; // Initialize printer
      const ESC_CENTER = [0x1b, 0x61, 0x01]; // Center align
      const ESC_LEFT = [0x1b, 0x61, 0x00]; // Left align
      const ESC_BOLD_ON = [0x1b, 0x45, 0x01]; // Bold text
      const ESC_BOLD_OFF = [0x1b, 0x45, 0x00]; // Normal text
      const LF = [0x0a]; // Line feed (Enter)

      // --- BUILD THE RECEIPT ---
      addBytes(ESC_INIT);
      addBytes(ESC_CENTER);
      addBytes(ESC_BOLD_ON);
      addText("KASA LOKAL\n");
      addBytes(ESC_BOLD_OFF);
      addText("Angeles City, Pampanga\n");
      addText("--------------------------------\n"); // 32 chars wide for 58mm
      
      addBytes(ESC_LEFT);
      addText(`Order #: ${order.orderNumber}\n`);
      addText(`Type: ${order.table}\n`);
      addText(`Date: ${new Date(order.createdAt || Date.now()).toLocaleString()}\n`);
      addText("--------------------------------\n");

      // Items
      order.items.forEach(item => {
        const addOnTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + Number(a.price || 0), 0);
        const lineTotal = (item.price + addOnTotal) * item.quantity;
        
        addBytes(ESC_BOLD_ON);
        addText(`${item.quantity}x ${item.name.substring(0, 15).padEnd(15)} P${lineTotal.toFixed(2).padStart(8)}\n`);
        addBytes(ESC_BOLD_OFF);

        if (item.selectedAddOns && item.selectedAddOns.length > 0) {
          item.selectedAddOns.forEach(addon => {
            addText(`  + ${addon.name.substring(0, 15).padEnd(15)} P${addon.price.toFixed(2).padStart(8)}\n`);
          });
        }
      });

      addBytes(ESC_CENTER);
      addText("--------------------------------\n");
      addBytes(ESC_BOLD_ON);
      addText(`TOTAL: P${(order.total || 0).toFixed(2)}\n`);
      addBytes(ESC_BOLD_OFF);
      addText("--------------------------------\n");
      addText("Thank you for supporting Lokal!\n");
      
      // Feed extra paper to safely clear the physical tear bar/cutter
      for (let i = 0; i < 8; i++) {
        addBytes(LF); 
      }

      // Optional: If your specific printer supports the ESC/POS Auto-Cut command, 
      // uncommenting these two lines will trigger the mechanical blade:
      // const GS_V = [0x1d, 0x56, 0x41, 0x00]; 
      // addBytes(GS_V);
      // 4. Send Bytes to Printer (in chunks of 512 bytes for Bluetooth stability)
      // 4. Send Bytes to Printer (Dynamic Spoon-feeding for long orders)
      const dataArray = new Uint8Array(receiptData);
      const chunkSize = 256; // Lowered from 512 for better hardware compatibility
      
      // Helper function to safely pause the Bluetooth stream
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      console.log(`Sending ${dataArray.length} bytes to printer...`);

      for (let i = 0; i < dataArray.length; i += chunkSize) {
        const chunk = dataArray.slice(i, i + chunkSize);
        await printCharacteristic.writeValue(chunk);
        
        // THE MAGIC FIX: Wait 100 milliseconds before sending the next chunk
        // This gives the printer time to print and clear its tiny memory!
        await sleep(100); 
      }

      console.log("Print job completely finished!");

      // Disconnect cleanly
      server.disconnect();

    } catch (error) {
      console.error("Bluetooth Print Error:", error);
      alert("Print failed: " + error.message + "\n\nMake sure Bluetooth is on and the printer is paired!");
    }
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
        body: JSON.stringify({ reason, adminName: activeAdmin ? activeAdmin.name : 'Admin' })
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
      const uniqueId = Math.floor(1000 + Math.random() * 9000);
      const newTable = `T-${uniqueId}`;
      
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
        setPhysicalCounts({}); // Clear the inputs
        setVarianceReasons({}); // Clear the reasons
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
        grouped[date].discount += o.discount || 0;
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
      grouped[date].discount += o.discount || 0;
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
    await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) }); 
    setEditingProduct(null); 
    setFormData({ name: '', description: '', category: '', basePrice: '', baseSize: '', sizes: [], image: '', baseRecipe: [] }); 
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
  const todayRevenue = todayCompleted.reduce((sum, o) => sum + o.total, 0);
  const todayVat = todayCompleted.reduce((sum, o) => sum + o.vatAmount, 0);

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
  // 🔥 ANALYTICS ENGINE 🔥
  // ==========================================
  const allCompletedOrders = [...orders.filter(o => o.status === 'Completed'), ...archivedOrders.filter(o => o.status === 'Completed')];
  
  // 1. Daily Sales & Best Day
  const dailyRevenueMap = {};
  let totalAllTimeRevenue = 0;
  allCompletedOrders.forEach(o => {
    const dateStr = new Date(o.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    if (!dailyRevenueMap[dateStr]) dailyRevenueMap[dateStr] = 0;
    dailyRevenueMap[dateStr] += o.total;
    totalAllTimeRevenue += o.total;
  });
  
  let bestDay = { date: 'N/A', revenue: 0 };
  const dailyRevenueList = Object.entries(dailyRevenueMap).map(([date, revenue]) => {
    if (revenue > bestDay.revenue) bestDay = { date, revenue };
    return { date, revenue };
  });

  // 2. Top Products
  const productStats = {};
  allCompletedOrders.forEach(o => {
    o.items.forEach(item => {
      const baseName = item.name.replace(/\s*\(.*?\)\s*/g, '').trim(); // Groups "Spanish Latte (Large)" into "Spanish Latte"
      if (!productStats[baseName]) productStats[baseName] = { qty: 0, revenue: 0 };
      productStats[baseName].qty += item.quantity;
      productStats[baseName].revenue += (item.price * item.quantity);
    });
  });
  const topProducts = Object.entries(productStats)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5); // Top 5

  // 3. Stock Movement (Current State)
  const sortedInventory = [...inventory].sort((a, b) => a.stockQty - b.stockQty);
  const lowestStock = sortedInventory.slice(0, 5);
  const highestStock = [...sortedInventory].reverse().slice(0, 5);

  // --- NEW: 4. Raw Material Velocity & Forecasting ---
  
  // A. Calculate exactly how many days of sales data we have
  let daysElapsed = 1; // Default to 1 to prevent dividing by zero
  if (allCompletedOrders.length > 0) {
    const dates = allCompletedOrders.map(o => new Date(o.createdAt).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    // Convert milliseconds to days, and ensure it's at least 1 day
    daysElapsed = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));
  }

  // ---   KITCHEN & BAR ROUTING LOGIC ---
  const displayOrders = filteredOrders.filter(order => {
    if (departmentFilter === 'Kitchen') {
      // Show orders containing items smartly tagged for Kitchen
      return order.items.some(item => (item.department || 'Kitchen') === 'Kitchen');
    }
    if (departmentFilter === 'Bar') {
      // Show orders containing items smartly tagged for Bar
      return order.items.some(item => item.department === 'Bar');
    }
    return true; // Show 'All'
  });

  const rawMaterialUsage = {};
  allCompletedOrders.forEach(o => {
    o.items.forEach(orderItem => {
      let product = products.find(p => p._id === orderItem.productId);
      if (!product) {
         const baseName = orderItem.name.replace(/\s*\(.*?\)\s*/g, '').trim();
         product = products.find(p => p.name === baseName);
      }
      
      if (product) {
        let recipe = product.baseRecipe || [];
        const sizeMatch = orderItem.name.match(/\(([^)]+)\)$/);
        if (sizeMatch) {
           const sizeObj = product.sizes?.find(s => s.name === sizeMatch[1]);
           if (sizeObj && sizeObj.recipe?.length > 0) recipe = sizeObj.recipe;
        }

        recipe.forEach(ing => {
           if (!rawMaterialUsage[ing.name]) {
              // Grab the current live stock so we can calculate runway
              const invItem = inventory.find(i => i.itemName.toLowerCase() === ing.name.toLowerCase());
              const currentStock = invItem ? invItem.stockQty : 0;
              
              rawMaterialUsage[ing.name] = { name: ing.name, qtyUsed: 0, unit: ing.unit, currentStock };
           }
           rawMaterialUsage[ing.name].qtyUsed += (ing.qty * orderItem.quantity);
        });
      }
    });
  });

  // B. Process the forecasting math
  const mostUsedStock = Object.values(rawMaterialUsage)
    .sort((a, b) => b.qtyUsed - a.qtyUsed)
    .slice(0, 5)
    .map(item => {
      const dailyAvg = item.qtyUsed / daysElapsed;
      const daysLeft = dailyAvg > 0 ? (item.currentStock / dailyAvg) : Infinity;
      
      return {
        ...item,
        dailyAvg,
        daysLeft: Math.floor(daysLeft), // How many days until we run out?
        weeklyNeed: Math.ceil(dailyAvg * 7), // How much to buy for 7 days
        monthlyNeed: Math.ceil(dailyAvg * 30) // How much to buy for 30 days
      };
    });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-light flex flex-col items-center justify-center p-4">
        <form onSubmit={handleSystemLogin} className="bg-surface p-8 rounded-xl border border-surface-800 shadow-2xl max-w-sm w-full text-center">
          <h2 className="text-2xl font-black text-white tracking-widest mb-2 uppercase">System Locked</h2>
          <p className="text-gray-400 text-sm mb-6">Enter credentials to access the dashboard.</p>
          <input type="text" placeholder="Admin Name" value={loginForm.name} onChange={(e) => setLoginForm({...loginForm, name: e.target.value})} className="w-full bg-surface border-2 border-gray-700 focus:border-accent text-center text-white py-3 rounded-lg outline-none mb-3 font-bold" required autoFocus />
          <input type="password" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({...loginForm, password: e.target.value})} className="w-full bg-surface border-2 border-gray-700 focus:border-accent text-center text-white py-3 rounded-lg outline-none mb-6 font-bold tracking-widest" required />
          <button type="submit" className="w-full bg-accent text-dark font-black py-4 rounded-lg hover:bg-yellow-500 transition shadow-lg shadow-accent/20 uppercase tracking-widest">AUTHENTICATE</button>
        </form>
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
  // If you filter your orders first (like Kitchen View), make sure to slice the filtered array!
  const currentOrders = orders.slice(indexOfFirstOrder, indexOfLastOrder);
  const totalOrdersPages = Math.ceil(orders.length / ordersItemsPerPage);

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

  return (
    <div className="min-h-screen bg-dark text-white p-6 lg:p-8">
      
      {/* HEADER & NAV */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-gray-800 pb-4 gap-4">
        
        {/* BRAND & DYNAMIC TABS */}
        <div className="flex items-center gap-6 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          
          {/* THE BRAND TOGGLE */}
          <div 
            onClick={() => {
              if (navMode === 'libellus') {
                setNavMode('negotium');
                setActiveTab('history');
              } else {
                setNavMode('libellus');
                setActiveTab('orders');
              }
            }}
            className="flex flex-col cursor-pointer group pr-6 border-r border-gray-700 select-none"
          >
            {/* SEMIVRA CAFE is now the BIGGER primary text */}
            <span className="text-3xl font-black text-accent transition group-hover:text-black tracking-tight leading-none mb-1">
              KASA LOKAL
            </span>
            {/* SEMIVRA LIBELLUS is now smaller, uniform, and ALL CAPS */}
            <span className="text-[11px] text-gray-500 font-bold uppercase tracking-[0.2em] transition group-hover:text-black">
              SEMIVRA <span className="text-accent">{navMode === 'libellus' ? 'LIBELLUS' : 'NEGOTIUM'}</span>
            </span>
          </div>

          {/* THE TABS */}
          <div className="flex gap-6">
            {navMode === 'libellus' ? (
              <>
                <button onClick={() => setActiveTab('orders')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'orders' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Active Orders</button>
                <button onClick={() => setActiveTab('inventory')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'inventory' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Inventory</button>
                <button onClick={() => setActiveTab('products')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'products' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Menu Setup</button>
              </>
            ) : (
              <>
                <button onClick={() => setActiveTab('history')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'history' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>History</button>
                <button onClick={() => setActiveTab('analytics')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'analytics' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Analytics</button>
                <button onClick={() => setActiveTab('ledger')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'ledger' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Accounting</button>
                <button onClick={() => setActiveTab('pricing')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'pricing' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Pricing & Discounts</button>
              </>
            )}
          </div>
        </div>

        {/* RIGHT CONTROLS */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="hidden md:flex flex-col items-end mr-4">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Auto-Close In</span>
            <span className="text-accent font-black tracking-wider">{countdown}</span>
          </div>

          {/* NEW FULLSCREEN BUTTON */}
          <button 
            onClick={(e) => { e.preventDefault(); toggleFullScreen(); }}
            className="flex items-center justify-center bg-dark border border-gray-700 text-gray-400 p-2.5 rounded-md hover:text-white hover:border-gray-500 transition shadow-sm"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>

          <button 
            onClick={(e) => { e.preventDefault(); handleShowQR(); }} 
            className="flex-1 md:flex-none bg-accent border border-shadowAccent text-white px-4 py-2 rounded-md font-bold hover:border-accent hover:bg-white hover:text-accent transition"
          >
            Show QR
          </button>
          <button 
            onClick={() => { setIsAuthenticated(false); setActiveAdmin(null); localStorage.removeItem('kasa_admin'); }}
            className="flex-1 md:flex-none border  bg-red-500 text-white px-4 py-2 rounded-md font-bold hover:bg-white hover:text-red-500 hover:border-red-500 transition"
          >
            Lock
          </button>
        </div>
      </div>

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

      {/* --- ANALYTICS DASHBOARD TAB --- */}
      {activeTab === 'analytics' && (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto animate-fade-in">
          
          {/* TOP ROW: High-Level Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-accent border border-accent/20 rounded-xl p-6 shadow-lg shadow-accent/5 flex flex-col justify-center">
              <p className="text-black text-xs font-bold uppercase tracking-wider mb-1">Total All-Time Revenue</p>
              <p className="text-4xl font-black text-dark mb-2">P{totalAllTimeRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="text-sm text-black font-medium">From {allCompletedOrders.length} total completed orders.</p>
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

          {/* BOTTOM ROW: Daily Trend & Stock Movement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Daily Sales List */}
            <div className="bg-surface border border-gray-800 rounded-xl p-6 flex flex-col max-h-96">
              <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
                <h3 className="text-white font-bold">Daily Revenue Trend</h3>
                <button onClick={exportAnalyticsToPDF} className="text-[10px] bg-accent border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-dark hover:text-accent transition font-bold uppercase tracking-wider">
                  Export Trend
                </button>
              </div>
              <div className="overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700 flex-1 space-y-2">
                {dailyRevenueList.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-4">No daily data available.</p>
                ) : dailyRevenueList.reverse().map((day, i) => {
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
              {/* --- UPGRADED: High Velocity & Forecasting --- */}
              <div className="bg-surface border border-accent/30 rounded-xl p-5 flex flex-col shadow-lg shadow-accent/5">
                <h3 className="text-accent text-sm font-bold uppercase tracking-wider mb-4 border-b border-accent/20 pb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent"></span> High Velocity & Forecast
                </h3>
                <div className="space-y-4">
                  {mostUsedStock.length === 0 ? (
                    <p className="text-gray-600 text-xs">No usage data yet.</p>
                  ) : mostUsedStock.map((item, idx) => (
                    <div key={idx} className="flex flex-col mb-1 border-b border-accent/10 pb-3 last:border-0 last:pb-0">
                      
                      {/* Top Row: Name and Total Used */}
                      <div className="flex justify-between items-center text-sm mb-2">
                        <span className="text-gray-200 font-bold truncate pr-2">{item.name}</span>
                        <span className="text-accent font-bold bg-accent/10 px-2 py-0.5 rounded text-xs">
                          {item.qtyUsed.toLocaleString()} {item.unit} Used total
                        </span>
                      </div>

                      {/* Bottom Row: Predictive Metrics Grid */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-dark p-2 rounded flex flex-col items-center justify-center border border-gray-800/50">
                          <p className="text-[9px] text-gray-500 uppercase font-bold tracking-widest mb-1 text-center leading-tight">Stock Lasts</p>
                          <p className={`text-sm font-black ${item.daysLeft <= 3 ? 'text-red-400 animate-pulse' : item.daysLeft <= 7 ? 'text-yellow-500' : 'text-green-400'}`}>
                            {item.daysLeft === Infinity || isNaN(item.daysLeft) ? '∞' : `${item.daysLeft} Days`}
                          </p>
                        </div>
                        
                        <div className="bg-dark p-2 rounded flex flex-col items-center justify-center border border-gray-800/50">
                          <p className="text-[9px] text-gray-500 uppercase font-bold tracking-widest mb-1 text-center leading-tight">Buy (1 Wk)</p>
                          <p className="text-sm font-bold text-black">
                            {item.weeklyNeed.toLocaleString()} <span className="text-[10px] font-normal text-gray-500">{item.unit}</span>
                          </p>
                        </div>
                        
                        <div className="bg-dark p-2 rounded flex flex-col items-center justify-center border border-gray-800/50">
                          <p className="text-[9px] text-gray-500 uppercase font-bold tracking-widest mb-1 text-center leading-tight">Buy (1 Mo)</p>
                          <p className="text-sm font-bold text-black">
                            {item.monthlyNeed.toLocaleString()} <span className="text-[10px] font-normal text-gray-500">{item.unit}</span>
                          </p>
                        </div>
                      </div>

                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-surface border border-red-900/30 rounded-xl p-5 flex flex-col">
                  <h3 className="text-red-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-red-900/30 pb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Low Stock (Risk)
                  </h3>
                  <div className="space-y-3">
                    {lowestStock.length === 0 ? (
                      <p className="text-gray-600 text-xs">Inventory is empty.</p>
                    ) : lowestStock.map(item => (
                      <div key={item._id} className="flex justify-between text-sm">
                        <span className="text-gray-300 truncate pr-2">{item.itemName}</span>
                        <span className={`font-black ${item.stockQty <= 0 ? 'text-red-500' : 'text-yellow-500'}`}>{item.stockQty.toLocaleString()}{item.unit}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-surface border border-gray-800 rounded-xl p-5 flex flex-col">
                  <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-gray-800 pb-2">
                    Overstock Watch
                  </h3>
                  <div className="space-y-3">
                    {highestStock.length === 0 ? (
                      <p className="text-gray-600 text-xs">Inventory is empty.</p>
                    ) : highestStock.map(item => (
                      <div key={item._id} className="flex justify-between text-sm">
                        <span className="text-gray-400 truncate pr-2">{item.itemName}</span>
                        <span className="text-gray-300 font-bold">{item.stockQty.toLocaleString()}{item.unit}</span>
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
                    <button onClick={() => setIsPosOpen(false)} className="text-red-500 hover:text-white font-bold px-4 py-2 bg-red-900/20 hover:bg-red-600 rounded uppercase text-xs tracking-wider transition">
                      ← Back to Orders
                    </button>
                  </div>
                  
                  <div className="p-3 border-b border-gray-800 bg-dark/50 flex gap-2 overflow-x-auto custom-scrollbar shrink-0">
                    <button onClick={() => setPosCategory('All')} className={`px-4 py-2 rounded font-bold whitespace-nowrap text-xs uppercase tracking-wider transition ${posCategory === 'All' ? 'bg-accent text-dark' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>All</button>
                    {categories.map(c => (
                      <button key={c._id} onClick={() => setPosCategory(c.name)} className={`px-4 py-2 rounded font-bold whitespace-nowrap text-xs uppercase tracking-wider transition ${posCategory === c.name ? 'bg-accent text-dark' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{c.name}</button>
                    ))}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4 content-start custom-scrollbar">
                    {products.filter(p => posCategory === 'All' || p.category === posCategory).map(p => (
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
                </div>

                {/* RIGHT: Cart & Checkout */}
                <div className="w-full lg:w-96 flex flex-col shrink-0 h-[500px] lg:h-full bg-surface border border-gray-800 rounded-xl overflow-hidden shadow-lg min-h-0">
                  <div className="p-4 border-b border-gray-800 bg-dark shrink-0">
                    <input type="text" placeholder="Customer / Driver Name" value={posCustomerName} onChange={e => setPosCustomerName(e.target.value)} className="w-full bg-dark border border-gray-700 p-2.5 rounded-lg text-black font-bold mb-3 outline-none focus:border-accent text-sm" />
                    <div className="flex gap-2">
                      {/* FIX: Removed the Payment Dropdown. Now it just takes the Table/Delivery type! */}
                      <select value={posTable} onChange={e => setPosTable(e.target.value)} className="w-full bg-dark border border-gray-700 p-2 rounded-lg text-xs font-bold text-black outline-none">
                        <option value="Takeout">🚶 Takeout</option>
                        <option value="Grab Delivery">🛵 Grab Delivery</option>
                        <option value="Foodpanda">🐼 Foodpanda</option>
                        <option value="Manual Delivery">📦 Manual/Direct</option>
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
                <div className="flex justify-between items-center mb-6 bg-white p-3 rounded-xl border-2 border-accent shadow-sm relative flex-wrap gap-4">
                  <div className="flex gap-2 overflow-x-auto">
                    {['All', 'Kitchen', 'Bar'].map(dept => (
                      <button 
                        key={dept} 
                        onClick={() => setDepartmentFilter(dept)} 
                        className={`px-6 py-2 rounded-lg text-sm font-black uppercase tracking-widest transition whitespace-nowrap ${departmentFilter === dept ? 'bg-accent text-white shadow-md' : 'bg-transparent text-gray-500 hover:text-accent'}`}
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
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col">
                          {['All', 'Pending', 'Preparing', 'Completed', 'Cancelled'].map(filter => (
                            <button 
                              key={filter} 
                              onClick={() => { setOrderFilter(filter); setIsStatusMenuOpen(false); }} 
                              className={`px-4 py-3 text-left text-sm font-bold transition hover:bg-gray-100 ${orderFilter === filter ? 'bg-accent/10 text-accent border-l-4 border-accent' : 'text-gray-700 border-l-4 border-transparent'}`}
                            >
                              {filter}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <button 
                      onClick={() => setIsPosOpen(true)}
                      className="px-6 py-2 bg-dark text-accent border border-accent rounded-lg text-sm font-black uppercase tracking-widest hover:bg-accent hover:text-dark transition shadow-md whitespace-nowrap flex items-center gap-2"
                    >
                      <Plus size={16} /> Manual Order
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {displayOrders.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-gray-500 font-bold uppercase tracking-widest">No orders in {departmentFilter} queue.</div>
                  ) : displayOrders.map(order => (
                    <div key={order._id} className={`bg-accent rounded-xl p-5 border flex flex-col shadow-lg transition-all ${order.status === 'Completed' ? 'border-green-600 shadow-green-600/20' : order.status === 'Cancelled' || order.status === 'Voided' ? 'border-red-500 opacity-75' : 'border-accentShadow'}`}>
                      
                      <div className="flex justify-between items-center mb-4 border-b border-white/30 pb-3">
                        <h2 className="text-lg font-black flex items-center gap-2 flex-wrap text-white">
                          <span>{order.orderNumber}</span>
                          {order.customerName && (
                            <span className="text-sm bg-black text-white px-2 py-0.5 rounded shadow-sm">
                              {order.customerName}
                            </span>
                          )}
                          {order.table && <span className="text-sm font-bold text-white/90 uppercase tracking-wider">({order.table})</span>}
                        </h2>
                        
                        <div className="flex items-center gap-2">
                          <button onClick={() => printOrderSlip(order)} className="p-1.5 bg-white text-accent rounded hover:bg-gray-100 transition shadow-sm" title="Print Slip">
                            🖨️
                          </button>
                          <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider text-white ${order.status === 'Pending' ? 'bg-red-500 animate-pulse' : order.status === 'Preparing' ? 'bg-yellow-500 text-black' : order.status === 'Completed' ? 'bg-green-600' : 'bg-gray-800'}`}>
                            {order.status}
                          </span>
                        </div>
                      </div>
                      
                      <div className="space-y-3 mb-4 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                        {['Kitchen', 'Bar'].map(dept => {
                          const deptItems = order.items.map((item, idx) => ({ ...item, originalIdx: idx })).filter(i => (i.department || 'Kitchen') === dept);
                          
                          if (deptItems.length === 0) return null;
                          if (departmentFilter !== 'All' && departmentFilter !== dept) return null;

                          return (
                            <div key={dept} className="bg-dark/30 rounded-lg p-2 border border-white/10">
                              <h4 className="text-[10px] uppercase text-white font-bold mb-2 pb-1 border-b border-gray-700 tracking-widest">{dept} Station</h4>
                              {deptItems.map(item => {
                                const currentSelection = discountedItems[order._id];
                                const isSelected = currentSelection ? currentSelection.includes(item.originalIdx) : true;
                                
                                return (
                                  <div key={item.originalIdx} className="mb-2">
                                    <div className="flex justify-between items-center text-sm">
                                      <div className="flex items-center gap-2">
                                        {order.status === 'Pending' && (
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleItemDiscount(order._id, item.originalIdx)}
                                            className="w-3 h-3 cursor-pointer rounded"
                                          />
                                        )}
                                        <span className={`font-bold ${isSelected ? 'text-white' : 'text-white/50'}`}>
                                          {item.quantity}x {item.name}
                                        </span>
                                      </div>
                                      
                                      {(order.status === 'Preparing' || order.status === 'Ready') ? (
                                        // ... (Keep your existing Prep/Finish buttons here)
                                        <div className="flex items-center gap-1">
                                          {item.itemStatus === 'Received' && (
                                            <button onClick={() => updateItemStatus(order, item.originalIdx, 'Preparing')} className="bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 hover:bg-yellow-500 hover:text-black px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition shadow-sm">Prep</button>
                                          )}
                                          {item.itemStatus === 'Preparing' && (
                                            <button onClick={() => updateItemStatus(order, item.originalIdx, 'Finished')} className="bg-accent/20 text-accent border border-accent/50 hover:bg-accent hover:text-black px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider transition shadow-sm">Finish</button>
                                          )}
                                          {item.itemStatus === 'Finished' && (
                                            <span className="text-green-500 text-[10px] font-black uppercase tracking-wider px-1">✔ Done</span>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          {/* --- NEW: Dynamic Isolated Item Discount Dropdown --- */}
                                          {order.status === 'Pending' && (
                                            <select 
                                              className="bg-dark border border-gray-600 rounded text-[9px] text-black outline-none px-1 py-0.5 h-6 cursor-pointer max-w-[100px] truncate"
                                              value={item.discountPercent || ''}
                                              onChange={(e) => applyItemDiscount(order._id, item.originalIdx, e.target.value)}
                                            >
                                              <option value="">No Disc.</option>
                                              {/* FIX: Pulls directly from your custom Discounts database! */}
                                              {discounts.map(d => (
                                                <option key={d._id} value={d.percentage}>
                                                  {d.name} ({d.percentage}%)
                                                </option>
                                              ))}
                                            </select>
                                          )}
                                          
                                          {/* Price Display (Shows Strikethrough if discounted) */}
                                          <div className="flex flex-col items-end">
                                            {item.discountPercent > 0 ? (
                                              <>
                                                <span className="text-gray-500 line-through text-[10px] font-mono">
                                                  P{((item.price + (item.selectedAddOns?.reduce((s, a) => s + Number(a.price), 0) || 0)) * item.quantity).toFixed(2)}
                                                </span>
                                                <span className="text-accent font-mono font-bold text-sm">
                                                  P{(((item.price + (item.selectedAddOns?.reduce((s, a) => s + Number(a.price), 0) || 0)) * item.quantity) * (1 - item.discountPercent / 100)).toFixed(2)}
                                                </span>
                                              </>
                                            ) : (
                                              <span className="text-white font-mono font-bold text-sm">
                                                P{((item.price + (item.selectedAddOns?.reduce((s, a) => s + Number(a.price), 0) || 0)) * item.quantity).toFixed(2)}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {item.selectedAddOns && item.selectedAddOns.length > 0 && (
                                      <div className="pl-6 mt-1 space-y-1">
                                        {item.selectedAddOns.map((addon, aIdx) => (
                                          <div key={aIdx} className="flex justify-between items-center text-[11px] text-black bg-black/20 px-2 py-1 rounded border border-white/5">
                                            <span className="flex items-center gap-1">
                                              <span className="text-accent text-[8px]">▶</span> {addon.name} <span className="text-[9px]">(+P{addon.price})</span>
                                            </span>
                                            {order.status === 'Pending' && (
                                              <button 
                                                onClick={() => removeAddOnFromOrder(order, item.originalIdx, aIdx)}
                                                className="text-gray-500 hover:text-red-400 transition bg-dark p-1 rounded"
                                              >
                                                <X size={12} />
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex-1"></div>

                      {order.status === 'Pending' ? (
                        <div className="flex justify-between items-center text-xs text-white border-t border-white/30 pt-3 mb-3">
                          <span className="font-bold uppercase tracking-wider">Complimentary?</span>
                          <div className="flex gap-1">
                            <select className="bg-white text-black text-[10px] rounded p-1.5 border-none outline-none font-bold" onChange={(e) => setCompSelections({...compSelections, [order._id]: e.target.value})}>
                              <option value="">Select Employee...</option>
                              {users.map(u => <option key={u._id} value={u.name}>{u.name}</option>)}
                            </select>
                            <button onClick={() => applyComplimentary(order._id)} className="bg-white hover:bg-gray-200 text-accent px-2 rounded font-black transition">✔</button>
                          </div>
                        </div>
                      ) : order.isComplimentary && (
                        <div className="flex justify-between items-center text-xs text-white border-t border-white/30 pt-3 mb-3">
                          <span className="font-bold uppercase tracking-wider text-accent">Complimentary Order:</span>
                          <span className="font-bold text-white bg-black/50 px-2 py-1 rounded">{order.employeeName}</span>
                        </div>
                      )}

                      <div className="bg-dark p-4 rounded-lg shadow-inner space-y-2 mb-4">
                        <div className="flex justify-between text-xs text-gray-500 font-bold">
                          <span>Gross Sales:</span><span>P{order.subtotal.toFixed(2)}</span>
                        </div>
                        
                        <div className="flex justify-between items-center text-xs text-gray-500 font-bold">
                          <div className="flex items-center gap-2">
                            <span>VAT ({order.vatRate > 0 ? (order.vatRate * 100).toFixed(0) : 0}%):</span>
                            {order.status === 'Pending' && (
                              <button 
                                onClick={() => toggleVat(order._id, order.vatRate)} 
                                className="bg-accent hover:bg-accentShadow text-white px-2 py-0.5 rounded text-[9px] uppercase font-black transition shadow-sm"
                              >
                                {order.vatRate > 0 ? 'Off' : 'On'}
                              </button>
                            )}
                          </div>
                          <span>P{order.vatAmount.toFixed(2)}</span>
                        </div>

                        <div className="flex justify-between items-center text-xs text-gray-500 font-bold border-b border-gray-200 pb-2">
                          <div className="flex items-center gap-2 w-full pr-2">
                            <span className="whitespace-nowrap">Discount ({order.discountPercent || 0}%):</span>
                            {order.status === 'Pending' && (
                              <div className="flex gap-1 items-center flex-1 justify-end">
                                <select 
                                  className="w-full max-w-[100px] bg-gray-100 border border-gray-300 rounded px-1 text-[10px] text-black outline-none h-6"
                                  value={discountInputs[order._id] || ''}
                                  onChange={(e) => setDiscountInputs(prev => ({ ...prev, [order._id]: e.target.value }))}
                                >
                                  <option value="">Select...</option>
                                  <option value="custom">Manual %</option>
                                  {discounts.map(d => <option key={d._id} value={d.percentage}>{d.name} ({d.percentage}%)</option>)}
                                </select>
                                
                                {discountInputs[order._id] === 'custom' && (
                                  <input 
                                    type="number" 
                                    placeholder="%" 
                                    className="w-10 bg-gray-100 border border-gray-300 rounded px-1 text-center text-black outline-none h-6"
                                    onChange={(e) => setDiscountInputs(prev => ({ ...prev, [order._id]: e.target.value }))} 
                                  />
                                )}
                                
                                <button onClick={() => applyDiscount(order._id)} className="bg-accent hover:bg-accentShadow text-white px-2 rounded font-black transition h-6">✔</button>
                                {order.discountPercent > 0 && <button onClick={() => applyDiscount(order._id, true)} className="bg-red-50 text-red-500 px-2 rounded font-black h-6 border border-red-500 shadow-sm">X</button>}
                              </div>
                            )}
                          </div>
                          <span className="text-red-500 whitespace-nowrap font-mono">-P{(order.discount || 0).toFixed(2)}</span>
                        </div>
                        
                        {order.discountType && order.discountType !== 'None' && (
                           <div className="flex justify-between text-[9px] text-gray-400 font-black uppercase tracking-widest pt-1">
                             <span>Type:</span>
                             <span className={order.discountType === 'SC/PWD' ? 'text-accent' : 'text-gray-500'}>{order.discountType}</span>
                           </div>
                        )}

                        <div className="flex justify-between font-black text-lg pt-1 text-black">
                          <span>Total:</span><span className="text-accent tracking-wider">P{order.total.toFixed(2)}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 mt-auto">
                        {order.status === 'Pending' && departmentFilter === 'All' && (() => {
                          const isDelivery = ['Grab Delivery', 'Foodpanda', 'Manual Delivery'].includes(order.table);
                          const displayPayment = isDelivery ? order.table : (paymentSelections[order._id] || order.paymentMethod || 'Cash');

                          return (
                            <div className="flex flex-col w-full gap-2">
                              {/* FIX: Smart dropdown that auto-locks for delivery orders! */}
                              <select 
                                 value={displayPayment} 
                                 disabled={isDelivery}
                                 onChange={(e) => setPaymentSelections(prev => ({ ...prev, [order._id]: e.target.value }))}
                                 className={`w-full border-2 rounded-lg p-2.5 text-sm font-bold outline-none shadow-sm transition ${isDelivery ? 'bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed' : 'bg-white text-black border-transparent focus:border-accent'}`}
                              >
                                <optgroup label="In-Store Payments">
                                  <option value="Cash">💰 Cash</option>
                                  <option value="Bank Transfer">🏦 Bank Transfer</option>
                                </optgroup>
                                <optgroup label="E-Wallets">
                                  <option value="GCash">📱 GCash</option>
                                  <option value="Maya">📱 Maya</option>
                                  <option value="Maribank">📱 Maribank / Seabank</option>
                                  <option value="Other E-Wallet">📱 Other E-Wallet</option>
                                </optgroup>
                                <optgroup label="Delivery Partners">
                                  <option value="Grab Delivery">🛵 GrabFood</option>
                                  <option value="Foodpanda">🐼 Foodpanda</option>
                                  <option value="Manual Delivery">📦 Manual/Direct</option>
                                </optgroup>
                              </select>
                              
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => {
                                    // Bulletproof guarantee: Forces the backend to receive the delivery type as the payment method
                                    if (isDelivery && paymentSelections[order._id] !== order.table) {
                                      setPaymentSelections(prev => ({ ...prev, [order._id]: order.table }));
                                    }
                                    setTimeout(() => updateStatus(order._id, 'Preparing'), 0);
                                  }} 
                                  className="flex-1 bg-white text-accent py-3 rounded-lg hover:bg-gray-100 font-black text-xs uppercase tracking-widest transition shadow-md"
                                >
                                  Pay & Send
                                </button>
                                <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500 text-white py-3 px-4 rounded-lg hover:bg-red-600 font-black text-xs transition uppercase shadow-md">Drop</button>
                              </div>
                            </div>
                          );
                        })()}
                        
                        {order.status === 'Preparing' && (
                          <div className="flex gap-2 mt-2">
                            {order.items.every(i => i.itemStatus === 'Finished') ? (
                              departmentFilter === 'All' ? (
                                <button onClick={() => updateStatus(order._id, 'Ready')} className="flex-1 bg-yellow-500 text-black py-3 rounded-lg hover:bg-yellow-400 font-black uppercase tracking-widest text-xs shadow-md transition">
                                  Mark Ready to Serve
                                </button>
                              ) : (
                                <div className="flex-1 flex items-center justify-center bg-green-500/20 text-green-400 border border-green-500/50 rounded-lg text-[10px] font-bold uppercase tracking-widest py-3">
                                  All Items Finished
                                </div>
                              )
                            ) : (
                              <div className="flex-1 flex items-center justify-center bg-dark text-gray-500 border border-gray-700 rounded-lg text-[10px] font-bold uppercase tracking-widest py-3">
                                Waiting on Kitchen/Bar...
                              </div>
                            )}
                            
                            {departmentFilter === 'All' && (
                              <button onClick={() => updateStatus(order._id, 'Cancelled')} className="bg-red-500 text-white py-3 px-4 rounded-lg hover:bg-red-600 font-black text-xs transition uppercase shadow-md">Drop</button>
                            )}
                          </div>
                        )}

                        {order.status === 'Ready' && departmentFilter === 'All' && (
                          <div className="flex gap-2">
                            <button onClick={() => updateStatus(order._id, 'Completed')} className="flex-1 bg-green-500 text-white py-3 rounded-lg hover:bg-green-600 font-black uppercase tracking-widest text-xs shadow-md transition">
                              Give to Cust.
                            </button>
                            <button onClick={() => updateStatus(order._id, 'Cancelled')} className="flex-1 bg-red-500 text-white py-3 px-4 rounded-lg hover:bg-red-600 font-black text-xs transition uppercase shadow-md">Drop</button>
                          </div>
                        )}

                        {order.status === 'Completed' && departmentFilter === 'All' && (
                          <button onClick={() => handleVoidOrder(order._id)} className="w-full bg-white border border-red-500 text-red-500 py-2.5 rounded-lg hover:bg-red-50 font-bold text-xs uppercase tracking-widest transition">
                            Void / Refund Order
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
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
        const shiftRevenue = todayShiftOrders.reduce((sum, o) => sum + o.total, 0);
        const shiftVat = todayShiftOrders.reduce((sum, o) => sum + o.vatAmount, 0);

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
                <p className="text-dark text-xs font-bold uppercase tracking-wider mb-1">Revenue</p>
                <p className="text-4xl font-black text-white">P{shiftRevenue.toFixed(2)}</p>
              </div>
              <div className="flex justify-between border-t border-dark pt-4">
                <div>
                  <p className="text-dark text-[10px] font-bold uppercase tracking-wider">Completed Orders</p>
                  <p className="text-lg font-bold text-dark">{todayShiftOrders.length}</p>
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
                        <span className="text-gray-500 text-xs">{expandedDays[date] ? '▲' : '▼'}</span>
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
                              <span>{expandedOrderLists[date] ? '▲' : '▼'}</span>
                            </button>
                            <button onClick={() => exportDayToPDF(date, data.orders)} className="text-[10px] bg-dark border border-gray-600 text-black px-2 py-1 rounded hover:bg-gray-800 hover:text-white transition font-bold uppercase tracking-wider">
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
                    ◀ Prev
                  </button>
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    PAGE <span className="text-accent text-sm">{invPage}</span> OF {totalInvPages}
                  </span>
                  <button 
                    onClick={() => setInvPage(prev => Math.min(prev + 1, totalInvPages))}
                    disabled={invPage === totalInvPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === totalInvPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    Next ▶
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
                                <select 
                                  value={varianceReasons[item._id] || ''} 
                                  onChange={(e) => setVarianceReasons({...varianceReasons, [item._id]: e.target.value})}
                                  className="mt-2 w-full max-w-[200px] bg-dark border border-red-900/60 text-red-500 text-[10px] rounded p-1 outline-none focus:border-red-500"
                                >
                                  <option value="" disabled>Select Reason...</option>
                                  <option value="Damaged/Spoiled">Damaged / Spoiled</option>
                                  <option value="Prep Waste">Preparation Waste</option>
                                  <option value="Previous Miscount">Previous Miscount</option>
                                  <option value="Unaccounted Loss">Unaccounted / Suspected Theft</option>
                                </select>
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
                                    hasInput && variance < 0 ? 'border-red-500 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.1)]' : 
                                    hasInput && variance > 0 ? 'border-green-500 text-green-400' : 
                                    hasInput && variance === 0 ? 'border-gray-600 text-gray-300' : 
                                    'border-gray-700 text-white focus:border-accent'}`
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
                        ◀ Prev
                      </button>
                      <span className="text-gray-400 text-xs font-bold tracking-widest">
                        PAGE <span className="text-accent text-sm">{invPage}</span> OF {totalInvPages}
                      </span>
                      <button 
                        onClick={() => setInvPage(prev => Math.min(prev + 1, totalInvPages))}
                        disabled={invPage === totalInvPages}
                        className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${invPage === totalInvPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                      >
                        Next ▶
                      </button>
                    </div>
                  )}

                  {/* SUMMARY FOOTER */}
                  {!isLocked && (
                    <div className="absolute bottom-0 left-0 right-0 bg-surface border-t border-gray-800 p-4 flex justify-between items-center rounded-b-xl">
                      <div className="flex gap-6">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Audit Status</p>
                          <p className={`text-sm font-black ${isComplete ? 'text-green-400' : 'text-yellow-500'}`}>
                            {isComplete ? 'All Items Counted ✓' : `${itemsCounted} / ${inventory.length} Counted ⚠`}
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
                    ◀ Prev
                  </button>
                  <span className="text-gray-400 text-xs font-bold tracking-widest">
                    PAGE <span className="text-accent text-sm">{accountingPage}</span> OF {totalAccountingPages}
                  </span>
                  <button 
                    onClick={() => setAccountingPage(prev => Math.min(prev + 1, totalAccountingPages))}
                    disabled={accountingPage === totalAccountingPages}
                    className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${accountingPage === totalAccountingPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                  >
                    Next ▶
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
                            <button onClick={() => handleInlinePriceUpdate(row.productId, row.sizeIndex)} className="text-green-400 hover:text-green-300">✔</button>
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
                  ◀ Prev
                </button>
                <span className="text-gray-400 text-xs font-bold tracking-widest">
                  PAGE <span className="text-accent text-sm">{pricingPage}</span> OF {totalPricingPages}
                </span>
                <button 
                  onClick={() => setPricingPage(prev => Math.min(prev + 1, totalPricingPages))}
                  disabled={pricingPage === totalPricingPages}
                  className={`px-4 py-1.5 rounded font-bold uppercase tracking-wider text-[10px] transition ${pricingPage === totalPricingPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  Next ▶
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
{/* --- MENU SETUP (PRODUCTS/CATEGORIES) --- */}
      {activeTab === 'products' && (
        // FIX 1: Changed h-fixed to h-auto on mobile, and added gap-6
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 h-auto lg:h-[calc(100vh-180px)]">
          
          {/* LEFT COLUMN: Menu Items, Categories, and Add-Ons */}
          {/* FIX 2: Added min-h-[500px] so it doesn't get crushed on mobile */}
          <div className="flex-1 bg-white border border-gray-200 shadow-md rounded-xl p-4 sm:p-6 overflow-y-auto custom-scrollbar min-h-[500px] lg:min-h-0">
            
            {/* 1. Menu Items List */}
            <h3 className="text-xl font-bold mb-4 text-gray-900 border-b border-gray-200 pb-2">Menu Items</h3>
            <div className="space-y-3">
              {currentProducts.map(p => (
                <div key={p._id} className="flex flex-col sm:flex-row gap-4 p-4 border border-gray-200 rounded-xl bg-gray-50 items-start sm:items-center shadow-sm">
                  
                  {/* Top section on mobile: Image + Text */}
                  <div className="flex gap-4 flex-1 w-full">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded-lg shadow-sm border border-gray-200 shrink-0" />
                    ) : (
                      <div className="w-16 h-16 bg-gray-200 rounded-lg border border-gray-300 flex items-center justify-center text-xs text-gray-500 font-bold shrink-0">No Img</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-gray-900 truncate w-full sm:w-auto">{p.name} <span className="text-xs text-accent ml-1">({p.category})</span></h4>
                        {(() => {
                          const est = getEstimatedStock(p.baseRecipe);
                          if (est === null) return null;
                          return (
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${est <= 0 ? 'bg-red-100 text-red-600' : est <= 5 ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                              {est <= 0 ? 'Out of Stock' : `Est: ${est} left`}
                            </span>
                          );
                        })()}
                      </div>
                      {p.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.description}</p>}
                      <p className="text-sm text-gray-700 font-bold mt-1">P{Number(p.basePrice || p.price || 0).toFixed(2)} {p.baseSize && <span className="text-xs text-gray-500 font-normal">({p.baseSize})</span>} {p.sizes?.length > 0 && <span className="text-accent text-xs ml-1">(+ {p.sizes.length} sizes)</span>}</p>
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
                      className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-gray-200 text-gray-900 rounded-lg text-sm font-bold hover:bg-gray-300 transition flex items-center justify-center gap-2"
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
                  ◀ Previous
                </button>
                
                <span className="text-gray-400 text-sm font-bold tracking-widest">
                  PAGE <span className="text-accent text-lg">{currentPage}</span> OF {totalPages}
                </span>
                
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={`px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-xs transition ${currentPage === totalPages ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-surface border border-gray-700 text-white hover:border-accent hover:text-accent'}`}
                >
                  Next ▶
                </button>
              </div>
            )}
            </div>
            
            {/* 2. Manage Categories */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <h3 className="text-xl font-bold mb-4 text-gray-900 border-b border-gray-200 pb-2">Manage Categories & Routing</h3>
              <form onSubmit={handleSaveCategory} className="flex gap-3 mb-6">
                <input 
                  type="text" 
                  value={catForm.name} 
                  onChange={e => setCatForm({...catForm, name: e.target.value})} 
                  placeholder="Category Name" 
                  className="flex-1 bg-gray-50 border border-gray-300 rounded-lg p-3 text-gray-900 outline-none focus:border-accent font-semibold" 
                  required 
                />
                <select 
                  value={catForm.department} 
                  onChange={e => setCatForm({...catForm, department: e.target.value})} 
                  className="w-32 bg-gray-50 border border-gray-300 rounded-lg p-3 text-gray-900 outline-none focus:border-accent font-bold"
                >
                  <option value="Kitchen">Kitchen</option>
                  <option value="Bar">Bar</option>
                </select>
                <button type="submit" className="bg-accent text-white font-bold px-6 py-2 rounded-lg hover:bg-opacity-90 transition shadow-md">
                  {editingCategory ? 'Update' : 'Add'}
                </button>
                {editingCategory && (
                  <button type="button" onClick={() => { setEditingCategory(null); setCatForm({ name: '', department: 'Kitchen' }); }} className="bg-gray-200 text-gray-700 font-bold px-4 py-2 rounded-lg hover:bg-gray-300 transition">
                    Cancel
                  </button>
                )}
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {categories.map(c => (
                  <div key={c._id} className="flex justify-between items-center p-3 border border-gray-200 rounded-xl bg-gray-50 shadow-sm">
                    <div>
                      <span className="font-bold text-sm text-gray-900 block">{c.name}</span>
                      <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Routes to: {c.department || 'Kitchen'}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingCategory(c); setCatForm({ name: c.name, department: c.department || 'Kitchen' }); }} className="text-gray-500 hover:text-accent p-1.5 rounded"><Edit size={16} /></button>
                      <button onClick={() => deleteCategory(c._id)} className="text-red-500 hover:text-red-600 p-1.5 rounded"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. MANAGE GLOBAL ADD-ONS */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <h3 className="text-xl font-bold mb-4 text-gray-900 border-b border-gray-200 pb-2">Manage Global Add-Ons (Sinkers, Shots)</h3>
              <form onSubmit={handleSaveAddOn} className="flex gap-3 mb-6">
                <input 
                  type="text" 
                  placeholder="Name (e.g. Popping Boba)" 
                  value={addOnForm.name} 
                  onChange={e => setAddOnForm({...addOnForm, name: e.target.value})} 
                  className="flex-1 bg-gray-50 border border-gray-300 rounded-lg p-3 text-gray-900 outline-none focus:border-accent font-semibold" 
                  required 
                />
                <input 
                  type="number" 
                  placeholder="Price" 
                  value={addOnForm.price} 
                  onChange={e => setAddOnForm({...addOnForm, price: e.target.value})} 
                  className="w-24 bg-gray-50 border border-gray-300 rounded-lg p-3 text-gray-900 outline-none focus:border-accent font-bold" 
                  required 
                />
                <select 
                  value={addOnForm.category} 
                  onChange={e => setAddOnForm({...addOnForm, category: e.target.value})} 
                  className="w-32 bg-gray-50 border border-gray-300 rounded-lg p-3 text-gray-900 outline-none focus:border-accent font-bold"
                >
                  <option value="Extras">Extras</option>
                  <option value="Sinkers">Sinkers</option>
                  <option value="Milks">Milks</option>
                </select>
                <button type="submit" className="bg-accent text-white font-bold px-6 py-2 rounded-lg hover:bg-opacity-90 transition shadow-md">Add</button>
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {globalAddOns.map(a => (
                  <div key={a._id} className="flex justify-between items-center p-3 border border-gray-200 rounded-xl bg-gray-50 shadow-sm">
                    <div>
                      <span className="font-bold text-sm text-gray-900 block">{a.name}</span>
                      <span className="text-[10px] uppercase font-bold text-accent tracking-wider">{a.category} • +P{a.price}</span>
                    </div>
                    <button onClick={() => deleteAddOn(a._id)} className="text-red-500 hover:text-red-600 bg-red-50 p-1.5 rounded"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Add Product Form */}
          {/* FIX 3: Added min-h-[600px] on mobile so the form has room to breathe */}
          <div className="w-full lg:w-96 bg-white border border-gray-200 rounded-xl p-4 sm:p-6 flex flex-col min-h-[600px] lg:min-h-0 lg:h-full overflow-hidden shadow-md">
            <h3 className="text-xl font-bold text-gray-900 mb-4 border-b border-gray-200 pb-2 shrink-0">
              {editingProduct ? 'Edit Product' : 'Add Product'}
            </h3>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-4">
              <form onSubmit={handleSaveProduct} className="space-y-4">
                {/* Basic Info */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Product Image</label>
                  <div className="flex items-center gap-4">
                    {formData.image ? (
                      <img src={formData.image} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-gray-200 shadow-sm" />
                    ) : (
                      <div className="w-16 h-16 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-400 font-bold">None</div>
                    )}
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-gray-100 file:text-gray-900 hover:file:bg-gray-200 cursor-pointer transition" />
                  </div>
                </div>
                <div><label className="block text-sm font-bold text-gray-700 mb-1">Name</label><input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-gray-900 outline-none focus:border-accent font-semibold" /></div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Category</label>
                  <select required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-gray-900 outline-none focus:border-accent font-semibold">
                    <option value="" disabled>Select Category...</option>
                    {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className="block text-sm font-bold text-gray-700 mb-1">Description</label><textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-gray-900 outline-none focus:border-accent h-20 placeholder-gray-400 font-medium" /></div>
                
                {/* Base Size & Materials */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mt-6 shadow-sm">
                  <label className="block text-sm font-black text-gray-900 mb-3 uppercase tracking-wider">Base Size / Standard Recipe</label>
                  <div className="flex gap-2 mb-2">
                    <input type="text" placeholder="Size Name (e.g. Regular)" value={formData.baseSize || ''} onChange={e => setFormData({...formData, baseSize: e.target.value})} className="w-1/2 bg-white border border-gray-300 rounded-lg p-2.5 text-gray-900 outline-none focus:border-accent font-bold" />
                    <div className="w-1/2 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">₱</span>
                      <input type="number" step="0.01" placeholder="Selling Price" value={formData.basePrice} onChange={e => setFormData({...formData, basePrice: parseFloat(e.target.value) || 0})} className="w-full bg-white border border-gray-300 rounded-lg p-2.5 pl-8 text-gray-900 outline-none focus:border-accent font-bold" />
                    </div>
                  </div>
                  
                  {(() => {
                    const baseCost = calcRecipeCost(formData.baseRecipe);
                    const basePriceVal = parseFloat(formData.basePrice) || 0;
                    const suggestedBasePrice = baseCost > 0 ? (baseCost / 0.7).toFixed(2) : '0.00';
                    const baseMargin = basePriceVal > 0 ? (((basePriceVal - baseCost) / basePriceVal) * 100).toFixed(1) : '0.0';
                    return baseCost > 0 ? (
                      <div className="flex justify-between text-[10px] px-1 mb-3">
                        <span className={parseFloat(baseMargin) >= 30 ? "text-green-600 font-black" : "text-yellow-600 font-black"}>Margin: {baseMargin}%</span>
                        <button type="button" onClick={() => setFormData({...formData, basePrice: parseFloat(suggestedBasePrice)})} className="text-gray-500 hover:text-accent font-bold transition">Set 30% Margin (₱{suggestedBasePrice})</button>
                      </div>
                    ) : <div className="mb-3"></div>;
                  })()}
                  
                  <div className="bg-white p-3 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs text-gray-600 font-black uppercase tracking-wider">Base Materials</span>
                      <span className="text-xs text-gray-900 font-black">Cost: ₱{calcRecipeCost(formData.baseRecipe).toFixed(2)}</span>
                    </div>
                    {(formData.baseRecipe || []).map((mat, i) => (
                      <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                        <span className="flex-1 text-gray-700 font-semibold truncate">{mat.name}</span>
                        <input type="number" value={mat.qty} onChange={e => updateMaterialQty(e.target.value, i, null)} className="w-16 bg-gray-50 border border-gray-300 rounded p-1.5 text-center text-gray-900 font-bold" />
                        <span className="text-gray-500 w-8 text-xs font-bold">{mat.unit}</span>
                        <button type="button" onClick={() => removeMaterial(i, null)} className="text-red-400 hover:text-red-600 ml-2"><X size={16} /></button>
                      </div>
                    ))}
                    <div className="mt-4 pt-3 border-t border-gray-100">
                      <div className="text-[10px] text-accent uppercase font-black mb-2 tracking-widest flex items-center gap-1"><Plus size={12}/> Tap to Add Material</div>
                      <div className="max-h-32 overflow-y-auto bg-gray-50 border border-gray-200 rounded-lg scrollbar-thin scrollbar-thumb-gray-300 p-1">
                        {inventory.length === 0 ? (
                          <p className="p-2 text-xs text-gray-500 italic font-medium">No inventory available.</p>
                        ) : (
                          inventory.map(inv => (
                            <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, null)} className="w-full text-left px-3 py-2 text-xs text-gray-700 font-bold hover:bg-gray-200 transition rounded flex justify-between items-center">
                              <span className="truncate pr-2">{inv.itemName}</span>
                              <span className="text-gray-400 shrink-0 font-mono">₱{inv.unitCost.toFixed(2)}/{inv.unit}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Extra Sizes */}
                <div className="border-t border-gray-200 pt-5 mt-4">
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-sm font-black text-gray-900 uppercase tracking-wider">Extra Sizes (Small, Large)</label>
                    <button type="button" onClick={addSize} className="text-xs bg-gray-100 px-3 py-1.5 rounded-full font-bold text-gray-700 border border-gray-300 hover:bg-gray-200 transition flex items-center gap-1"><Plus size={14}/> Add Size</button>
                  </div>
                  
                  {(formData.sizes || []).map((size, idx) => (
                    <div key={idx} className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4 shadow-sm">
                      <div className="flex gap-2 mb-2">
                        <input type="text" placeholder="Size Name" value={size.name} onChange={e => updateSize(idx, 'name', e.target.value)} className="w-1/2 bg-white border border-gray-300 rounded-lg p-2 text-sm text-gray-900 font-bold" required />
                        <input type="number" step="0.01" placeholder="Price" value={size.price} onChange={e => updateSize(idx, 'price', e.target.value)} className="w-1/3 bg-white border border-gray-300 rounded-lg p-2 text-sm text-gray-900 font-bold" required />
                        <button type="button" onClick={() => removeSize(idx)} className="text-gray-400 hover:text-red-500 font-bold ml-auto px-2"><X size={20} /></button>
                      </div>
                      
                      <div className="bg-white p-3 rounded-lg border border-gray-200 mt-3">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs text-gray-600 font-black uppercase tracking-wider">{size.name || 'New Size'} Materials</span>
                          <span className="text-xs text-gray-900 font-black">Cost: ₱{calcRecipeCost(size.recipe).toFixed(2)}</span>
                        </div>
                        {(size.recipe || []).map((mat, i) => (
                          <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                            <span className="flex-1 text-gray-700 font-semibold truncate">{mat.name}</span>
                            <input type="number" value={mat.qty} onChange={e => updateMaterialQty(e.target.value, i, idx)} className="w-16 bg-gray-50 border border-gray-300 rounded p-1.5 text-center text-gray-900 font-bold" />
                            <span className="text-gray-500 w-8 text-xs font-bold">{mat.unit}</span>
                            <button type="button" onClick={() => removeMaterial(i, idx)} className="text-red-400 hover:text-red-600 ml-2"><X size={16} /></button>
                          </div>
                        ))}
                        <div className="mt-4 pt-3 border-t border-gray-100">
                          <div className="text-[10px] text-accent uppercase font-black mb-2 tracking-widest flex items-center gap-1"><Plus size={12}/> Tap to Add Material</div>
                          <div className="max-h-28 overflow-y-auto bg-gray-50 border border-gray-200 rounded-lg scrollbar-thin scrollbar-thumb-gray-300 p-1">
                            {inventory.map(inv => (
                              <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, idx)} className="w-full text-left px-3 py-2 text-xs text-gray-700 font-bold hover:bg-gray-200 transition rounded flex justify-between items-center">
                                <span className="truncate pr-2">{inv.itemName}</span>
                                <span className="text-gray-400 shrink-0 font-mono">₱{inv.unitCost.toFixed(2)}/{inv.unit}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* --- OPTIONAL ADD-ONS CHECKBOXES --- */}
                <div className="border-t border-gray-200 pt-5 mt-4 mb-4">
                  <label className="text-sm font-black text-gray-900 uppercase tracking-wider mb-3 block">Attach Add-Ons</label>
                  <div className="grid grid-cols-2 gap-2">
                    {globalAddOns.map(addon => {
                      const isAttached = (formData.addOns || []).some(a => a.name === addon.name);
                      return (
                        <label key={addon._id} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border-2 transition ${isAttached ? 'border-accent bg-accent/10 shadow-sm' : 'border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300'}`}>
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
                             <span className="text-sm font-bold text-gray-900 leading-tight">{addon.name}</span>
                             <span className="text-[10px] text-accent font-black uppercase tracking-widest">+₱{addon.price}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Save Buttons */}
                <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
                  {editingProduct && (
                    <button type="button" onClick={() => deleteProduct(editingProduct._id)} className="bg-red-50 text-red-600 font-bold py-3 px-4 rounded-xl hover:bg-red-100 transition flex items-center justify-center border border-red-200">
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
      {historyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-6 rounded-xl border border-gray-700 shadow-2xl flex flex-col max-w-2xl w-full max-h-[80vh]">
            <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3">
              <h2 className="text-xl font-bold text-white">Stock Card: <span className="text-accent">{historyItemName}</span></h2>
              <button onClick={() => setHistoryModalOpen(false)} className="text-gray-400 hover:text-white font-bold text-xl">✕</button>
            </div>
            
            <div className="overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800 text-xs uppercase tracking-wider">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2 text-right">In/Out</th>
                    <th className="pb-2 text-right">Unit Cost</th> {/* <-- ADDED */}
                    <th className="pb-2 text-right">Balance</th>
                    <th className="pb-2 pl-4">Remarks / Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {stockHistory.length === 0 ? (
                    <tr><td colSpan="6" className="py-4 text-center text-gray-500">No movement history recorded yet.</td></tr>
                  ) : stockHistory.map((log, idx) => (
                    <tr key={idx} className="border-b border-gray-800/50 hover:bg-dark/30">
                      <td className="py-2 text-gray-400 text-xs">{new Date(log.date).toLocaleString()}</td>
                      <td className="py-2 font-bold text-gray-300">{log.type}</td>
                      <td className={`py-2 text-right font-mono font-bold ${log.qtyChange < 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {log.qtyChange > 0 ? `+${log.qtyChange}` : log.qtyChange}
                      </td>
                      
                      {/* --- ADDED COST DATA --- */}
                      <td className="py-2 text-right text-gray-400 font-mono text-xs">P{(log.unitCost || 0).toFixed(4)}</td>
                      
                      <td className="py-2 text-right text-accent font-bold font-mono">{log.balanceAfter}</td>
                      <td className="py-2 pl-4 text-gray-500 text-xs">{log.remarks || log.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
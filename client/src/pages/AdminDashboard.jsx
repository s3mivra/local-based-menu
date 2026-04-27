import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import QRCode from '../components/QRCode.jsx';

const API_URL = 'https://local-based-menu.onrender.com';
//const API_URL = 'http://192.168.100.2:5002'; // Change back to Render URL when deploying!
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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [paymentSelections, setPaymentSelections] = useState({});
  const ADMIN_PIN = '1234'; 

  const [activeTab, setActiveTab] = useState('orders');
  const [orderFilter, setOrderFilter] = useState('All'); 
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
    baseRecipe: [] 
  });
  const [newCatName, setNewCatName] = useState('');

  const [autoTableId, setAutoTableId] = useState('');
  const SECRET_TOKEN = 'cafe2026';
  const [countdown, setCountdown] = useState('');

  const [inventory, setInventory] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [invForm, setInvForm] = useState({ itemName: '', packQty: '', unitPerPack: '', unit: '', costPerPack: '' });
  
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
    { accountCode: '6000', accountName: 'Operating Expenses', type: 'Expense' }
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

  const fetchData = async () => {
    try {
      const pRes = await fetch(`${API_URL}/api/products`);
      if (pRes.ok) setProducts((await pRes.json()).products || []);
      const cRes = await fetch(`${API_URL}/api/categories`);
      if (cRes.ok) setCategories((await cRes.json()).categories || []);
    } catch (err) { console.error('Failed to fetch menu data', err); }
  };

  const fetchOrders = async () => {
    try {
      const cacheBuster = new Date().getTime(); 
      const res = await fetch(`${API_URL}/api/orders?t=${cacheBuster}`, { cache: 'no-store' });
      if (res.ok) setOrders((await res.json()).orders || []);
      const archRes = await fetch(`${API_URL}/api/orders/archives?t=${cacheBuster}`, { cache: 'no-store' });
      if (archRes.ok) setArchivedOrders((await archRes.json()).archives || []);
    } catch (err) { console.error('Failed to fetch orders', err); }
  };

  const fetchERPData = async () => {
    try {
      const invRes = await fetch(`${API_URL}/api/inventory`);
      if (invRes.ok) setInventory((await invRes.json()).items || []);
      const jeRes = await fetch(`${API_URL}/api/journal`);
      if (jeRes.ok) setJournalEntries((await jeRes.json()).entries || []);
    } catch (err) { console.error('Failed to fetch ERP data', err); }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchOrders();
    fetchData();
    fetchERPData(); 

    socket.on('newOrder', (order) => { setOrders(prev => [order, ...prev]); playKitchenDing(); });
    socket.on('orderUpdated', (updated) => setOrders(prev => prev.map(o => o._id === updated._id ? updated : o)));
    socket.on('menuUpdated', fetchData);
    socket.on('ordersArchived', fetchOrders); 
    socket.on('erpUpdated', fetchERPData); 

    return () => {
      socket.off('newOrder'); socket.off('orderUpdated'); socket.off('menuUpdated'); socket.off('ordersArchived'); socket.off('erpUpdated');
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-dark flex flex-col items-center justify-center p-4">
        <div className="bg-surface p-8 rounded-xl border border-gray-800 shadow-2xl max-w-sm w-full text-center">
          <h2 className="text-2xl font-black text-white tracking-widest mb-2 uppercase">System Locked</h2>
          <p className="text-gray-400 text-sm mb-6">Enter Admin PIN to access the dashboard.</p>
          <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pinInput === ADMIN_PIN && setIsAuthenticated(true)} className="w-full bg-dark border-2 border-gray-700 focus:border-accent text-center text-3xl text-white tracking-[0.5em] py-4 rounded-lg outline-none mb-4 font-mono" maxLength={4} autoFocus />
          <button onClick={() => pinInput === ADMIN_PIN ? setIsAuthenticated(true) : alert("Incorrect PIN")} className="w-full bg-accent text-dark font-black py-4 rounded-lg hover:bg-yellow-500 transition shadow-lg shadow-accent/20">UNLOCK</button>
        </div>
      </div>
    );
  }

  const updateStatus = async (orderId, newStatus) => {
    const payload = { status: newStatus };
    if (newStatus === 'Completed') {
      payload.paymentMethod = paymentSelections[orderId] || 'Cash';
    }

    setOrders(prev => prev.map(o => o._id === orderId ? { ...o, ...payload } : o));
    socket.emit('updateOrderStatus', { orderId, status: newStatus });
    await fetch(`${API_URL}/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  };
  const toggleVat = async (orderId, currentVatRate) => { await fetch(`${API_URL}/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isVatExempt: currentVatRate > 0 }) }); };
  const applyDiscount = async (orderId, isRemoving = false) => {
    const percent = isRemoving ? 0 : parseFloat(discountInputs[orderId] || 0);
    if (percent < 0 || percent > 100) return alert('Discount must be between 0% and 100%');
    await fetch(`${API_URL}/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discountPercent: percent }) });
    if (isRemoving) setDiscountInputs(prev => ({ ...prev, [orderId]: '' }));
  };
  const archiveDay = async () => {
    if (!window.confirm("Are you sure you want to close the day? This will archive everything.")) return;
    setOrders([]); 
    try { await fetch(`${API_URL}/api/orders/archive`, { method: 'POST' }); await fetchOrders(); } catch (err) { console.error("Failed to archive:", err); }
  };

  const handleShowQR = () => {
    const uniqueId = Math.floor(1000 + Math.random() * 9000);
    setAutoTableId(`T-${uniqueId}`);
    setShowQR(true);
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
      await fetch(`${API_URL}/api/inventory/restock/${existingItem._id}`, { 
        method: 'POST', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ addedStock: totalStockAdded, totalCost }) 
      });
    } else {
      // ADD BRAND NEW ITEM
      const costPerMicroUnit = parseFloat(invForm.costPerPack) / parseFloat(invForm.unitPerPack);
      const payload = { itemName: itemNameClean, stockQty: totalStockAdded, unit: invForm.unit, unitCost: costPerMicroUnit };
      
      const res = await fetch(`${API_URL}/api/inventory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data.success) return alert(data.error);
    }

    setInvForm({ itemName: '', packQty: '', unitPerPack: '', unit: '', costPerPack: '' });
    fetchERPData();
  };
  const deleteInventory = async (id) => { if(window.confirm('Delete inventory item?')) { await fetch(`${API_URL}/api/inventory/${id}`, { method: 'DELETE' }); fetchERPData(); } };

  const generateCSV = (ordersList, filename) => {
    if (ordersList.length === 0) return alert("No orders to export.");
    const headers = ['Date', 'Order Number', 'Table', 'Status', 'Items', 'Subtotal', 'VAT', 'Discount', 'Total'];
    const rows = ordersList.map(order => {
      const date = new Date(order.createdAt).toLocaleString();
      const itemsStr = order.items.map(i => `${i.quantity}x ${i.name}`).join(' | ');
      return [ `"${date}"`, `"${order.orderNumber}"`, `"${order.table || 'Takeout'}"`, `"${order.status}"`, `"${itemsStr}"`, order.subtotal.toFixed(2), order.vatAmount.toFixed(2), order.discount.toFixed(2), order.total.toFixed(2) ].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
  };
  const exportAllToCSV = () => {
    const allOrdersToExport = [...orders.filter(o => o.status === 'Completed'), ...archivedOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    generateCSV(allOrdersToExport, `Sales_Export_ALL_${new Date().toISOString().split('T')[0]}.csv`);
  };
  const exportDayToCSV = (dateString, dayOrders) => { generateCSV(dayOrders, `Sales_Export_${dateString.replace(/,/g, '').replace(/ /g, '_')}.csv`); };

  const handleAddCategory = async (e) => { e.preventDefault(); if(!newCatName.trim()) return; await fetch(`${API_URL}/api/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCatName }) }); setNewCatName(''); };
  const deleteCategory = async (id) => { if(window.confirm('Delete category?')) await fetch(`${API_URL}/api/categories/${id}`, { method: 'DELETE' }); };

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
    const url = editingProduct ? `${API_URL}/api/products/${editingProduct._id}` : `${API_URL}/api/products`; 
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) }); 
    setEditingProduct(null); 
    setFormData({ name: '', description: '', category: '', basePrice: '', baseSize: '', sizes: [], image: '', baseRecipe: [] }); 
  };
  const deleteProduct = async (id) => { 
    if(window.confirm("Delete this product permanently?")) {
      await fetch(`${API_URL}/api/products/${id}`, { method: 'DELETE' }); 
      if (editingProduct && editingProduct._id === id) { setEditingProduct(null); setFormData({ name: '', description: '', category: '', basePrice: '', baseSize: '', sizes: [], image: '', baseRecipe: [] }); }
    }
  };
  
  const addSize = () => setFormData({ ...formData, sizes: [...formData.sizes, { name: '', price: 0 }] });
  const updateSize = (index, field, value) => { const newSizes = [...formData.sizes]; newSizes[index][field] = field === 'price' ? parseFloat(value) || 0 : value; setFormData({ ...formData, sizes: newSizes }); };
  const removeSize = (index) => setFormData({ ...formData, sizes: formData.sizes.filter((_, i) => i !== index) });

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

  // 3. Stock Movement
  const sortedInventory = [...inventory].sort((a, b) => a.stockQty - b.stockQty);
  const lowestStock = sortedInventory.slice(0, 5);
  const highestStock = [...sortedInventory].reverse().slice(0, 5);

  // --- NEW EXPORT FUNCTIONS ---
  const downloadCSVFile = (csvContent, filename) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
  };

  const exportInventoryToCSV = () => {
    if (inventory.length === 0) return alert("No inventory to export.");
    const headers = ['Item Name', 'Stock Qty', 'Unit', 'Unit Cost', 'Total Value'];
    const rows = inventory.map(i => `"${i.itemName}",${i.stockQty},"${i.unit}",${i.unitCost.toFixed(4)},${(i.stockQty * i.unitCost).toFixed(2)}`);
    downloadCSVFile([headers.join(','), ...rows].join('\n'), `Inventory_Report_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportLedgerToCSV = () => {
    if (journalEntries.length === 0) return alert("No entries to export.");
    const headers = ['Date', 'Reference', 'Description', 'Account Code', 'Account Name', 'Debit', 'Credit'];
    const rows = [];
    journalEntries.forEach(entry => {
      const date = new Date(entry.date).toLocaleString();
      entry.lines.forEach(line => {
        rows.push(`"${date}","${entry.reference}","${entry.description}","${line.accountCode}","${line.accountName}",${line.debit || 0},${line.credit || 0}`);
      });
    });
    downloadCSVFile([headers.join(','), ...rows].join('\n'), `General_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const exportAnalyticsToCSV = () => {
    if (dailyRevenueList.length === 0) return alert("No analytics data to export.");
    const headers = ['Date', 'Revenue'];
    const rows = dailyRevenueList.map(d => `"${d.date}",${d.revenue.toFixed(2)}`);
    downloadCSVFile([headers.join(','), ...rows].join('\n'), `Daily_Sales_Trend_${new Date().toISOString().split('T')[0]}.csv`);
  };

  return (
    <div className="min-h-screen bg-dark text-white p-6 lg:p-8">
      
      {/* HEADER & NAV */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-gray-800 pb-4 gap-4">
        <div className="flex gap-6 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
          <button onClick={() => setActiveTab('orders')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'orders' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Active Orders</button>
          <button onClick={() => setActiveTab('history')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'history' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>History</button>
          
          {/* NEW ANALYTICS TAB */}
          <button onClick={() => setActiveTab('analytics')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'analytics' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Analytics</button>
          
          <button onClick={() => setActiveTab('inventory')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'inventory' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Inventory</button>
          <button onClick={() => setActiveTab('ledger')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'ledger' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Accounting</button>
          <button onClick={() => setActiveTab('products')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'products' ? 'text-gray-300' : 'text-gray-600 hover:text-gray-400'}`}>Menu Setup</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="hidden md:flex flex-col items-end mr-4">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Auto-Close In</span>
            <span className="text-accent font-black tracking-wider">{countdown}</span>
          </div>
          <button onClick={handleShowQR} className="flex-1 md:flex-none bg-dark border border-gray-600 text-white px-4 py-2 rounded-md font-bold hover:bg-gray-800 transition">Show QR</button>
          <button onClick={() => { setIsAuthenticated(false); setPinInput(''); }} className="flex-1 md:flex-none bg-red-900/50 text-red-500 px-4 py-2 rounded-md font-bold hover:bg-red-900 transition">Lock</button>
        </div>
      </div>

      {/* QR MODAL */}
      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-8 rounded-xl border border-gray-700 shadow-2xl flex flex-col items-center max-w-sm w-full relative">
            <button onClick={() => setShowQR(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white font-bold text-xl">✕</button>
            <h2 className="text-2xl font-bold mb-1 text-white">Customer QR</h2>
            <div className="bg-dark px-6 py-2 rounded-full border border-gray-700 mb-6 mt-2 flex items-center gap-2">
              <span className="text-gray-400 text-sm font-bold uppercase tracking-wider">Session ID:</span>
              <span className="text-accent font-black text-lg">{autoTableId}</span>
            </div>
            <div className="bg-white p-2 rounded-lg shadow-inner">
              <QRCode url={`${FRONTEND_URL}/?table=${autoTableId}&token=${SECRET_TOKEN}`} size={200} />
            </div>
            <button onClick={handleShowQR} className="mt-6 w-full bg-surface border border-accent text-accent font-bold py-3 rounded-md hover:bg-accent hover:text-dark transition uppercase tracking-widest text-sm">Generate Next QR</button>
            <button onClick={() => setShowQR(false)} className="mt-3 w-full bg-dark border border-gray-600 text-white font-bold py-3 rounded-md hover:bg-gray-800 transition text-sm">Close</button>
          </div>
        </div>
      )}

      {/* --- ANALYTICS DASHBOARD TAB --- */}
      {activeTab === 'analytics' && (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto animate-fade-in">
          
          {/* TOP ROW: High-Level Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gradient-to-br from-surface to-dark border border-accent/20 rounded-xl p-6 shadow-lg shadow-accent/5 flex flex-col justify-center">
              <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Total All-Time Revenue</p>
              <p className="text-4xl font-black text-accent mb-2">P{totalAllTimeRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="text-sm text-gray-500 font-medium">From {allCompletedOrders.length} total completed orders.</p>
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
            {/* Daily Sales List */}
            <div className="bg-surface border border-gray-800 rounded-xl p-6 flex flex-col max-h-96">
              <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
                <h3 className="text-white font-bold">Daily Revenue Trend</h3>
                <button onClick={exportAnalyticsToCSV} className="text-[10px] bg-dark border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-800 hover:text-white transition font-bold uppercase tracking-wider">
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

            {/* Inventory Alerts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-surface border border-red-900/30 rounded-xl p-5 flex flex-col">
                <h3 className="text-red-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-red-900/30 pb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Low Stock Alert
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

              <div className="bg-surface border border-green-900/30 rounded-xl p-5 flex flex-col">
                <h3 className="text-green-400 text-sm font-bold uppercase tracking-wider mb-4 border-b border-green-900/30 pb-2">
                  High Stock / Overstock
                </h3>
                <div className="space-y-3">
                  {highestStock.length === 0 ? (
                    <p className="text-gray-600 text-xs">Inventory is empty.</p>
                  ) : highestStock.map(item => (
                    <div key={item._id} className="flex justify-between text-sm">
                      <span className="text-gray-300 truncate pr-2">{item.itemName}</span>
                      <span className="text-green-500 font-bold">{item.stockQty.toLocaleString()}{item.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* --- ACTIVE ORDERS TAB (Kitchen View) --- */}
      {activeTab === 'orders' && (
        <div className="w-full">
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            {['All', 'Pending', 'Preparing', 'Completed', 'Cancelled'].map(filter => (
              <button key={filter} onClick={() => setOrderFilter(filter)} className={`px-4 py-2 rounded-full text-sm font-bold transition whitespace-nowrap ${orderFilter === filter ? 'bg-accent text-dark' : 'bg-surface border border-gray-700 text-gray-400 hover:text-white'}`}>
                {filter}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredOrders.length === 0 ? (
              <div className="col-span-full text-center py-12 text-gray-500">No {orderFilter.toLowerCase()} orders found.</div>
            ) : filteredOrders.map(order => (
              <div key={order._id} className="bg-surface rounded-xl p-5 border border-gray-800 flex flex-col shadow-lg">
                <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3">
                  <h2 className="text-lg font-black">
                    {order.orderNumber} 
                    {order.table && <span className="text-sm font-bold text-accent ml-2 uppercase tracking-wider">({order.table})</span>}
                  </h2>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${order.status === 'Pending' ? 'bg-red-900/50 text-red-400' : order.status === 'Preparing' ? 'bg-yellow-900/50 text-accent' : order.status === 'Completed' ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{order.status}</span>
                </div>
                
                <div className="space-y-2 mb-4 flex-1">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="font-semibold text-gray-200">{item.quantity}x {item.name}</span>
                      <span className="text-gray-500">P{(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="bg-dark/50 p-3 rounded-lg border border-gray-800/50 space-y-2 mb-4">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Subtotal:</span><span>P{order.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-gray-400">
                    <div className="flex items-center gap-2">
                      <span>VAT ({(order.vatRate * 100).toFixed(0)}%):</span>
                      {(order.status === 'Pending' || order.status === 'Preparing') && (
                        <button onClick={() => toggleVat(order._id, order.vatRate)} className="bg-gray-700 hover:bg-gray-600 text-white px-1.5 py-0.5 rounded text-[9px] uppercase font-bold">{order.vatRate > 0 ? 'Off' : 'On'}</button>
                      )}
                    </div>
                    <span>P{order.vatAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-gray-400 border-b border-gray-800/50 pb-2">
                    <div className="flex items-center gap-2">
                      <span>Discount ({order.discountPercent || 0}%):</span>
                      {(order.status === 'Pending' || order.status === 'Preparing') && (
                        <div className="flex gap-1">
                          <input type="number" placeholder="%" className="w-10 bg-dark border border-gray-600 rounded px-1 text-center text-white outline-none" value={discountInputs[order._id] !== undefined ? discountInputs[order._id] : (order.discountPercent || '')} onChange={(e) => setDiscountInputs(prev => ({ ...prev, [order._id]: e.target.value }))} />
                          <button onClick={() => applyDiscount(order._id)} className="bg-gray-700 hover:bg-accent hover:text-dark text-white px-1.5 rounded font-bold transition">✓</button>
                          {order.discountPercent > 0 && <button onClick={() => applyDiscount(order._id, true)} className="bg-red-900/50 text-red-400 px-1.5 rounded font-bold">✕</button>}
                        </div>
                      )}
                    </div>
                    <span className="text-green-400">-P{(order.discount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-black text-lg pt-1">
                    <span>Total:</span><span className="text-accent">P{order.total.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex gap-2 mt-auto">
                  {order.status === 'Pending' && (
                    <>
                      <button onClick={() => updateStatus(order._id, 'Preparing')} className="flex-1 bg-surface border border-accent text-accent py-2.5 rounded-lg hover:bg-accent hover:text-dark font-bold text-sm transition">Start Prep</button>
                      <button onClick={() => updateStatus(order._id, 'Cancelled')} className="flex-1 bg-surface border border-red-500/50 text-red-400 py-2.5 rounded-lg hover:bg-red-900/50 font-bold text-sm transition">Cancel</button>
                    </>
                  )}
                  {order.status === 'Preparing' && (
                    <div className="flex flex-col w-full gap-2">
                      <select 
                        value={paymentSelections[order._id] || 'Cash'} 
                        onChange={(e) => setPaymentSelections(prev => ({ ...prev, [order._id]: e.target.value }))}
                        className="w-full bg-dark border border-gray-600 rounded p-2 text-sm text-white outline-none focus:border-accent"
                      >
                        <option value="Cash">Cash</option>
                        <option value="E-Wallet">E-Wallet</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                      </select>
                      <button onClick={() => updateStatus(order._id, 'Completed')} className="w-full bg-accent text-dark py-2.5 rounded-lg hover:bg-yellow-500 font-bold text-sm shadow-lg shadow-accent/10 transition">
                        Mark Completed
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- SALES HISTORY & REGISTER TAB --- */}
      {activeTab === 'history' && (
        <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
          <div className="bg-surface border border-accent/20 rounded-xl p-6 shadow-xl shadow-accent/5">
            <h3 className="text-accent font-black tracking-widest uppercase text-sm mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span> Active Register
            </h3>
            <div className="space-y-4 mb-6">
              <div>
                <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Today's Revenue</p>
                <p className="text-4xl font-black text-white">P{todayRevenue.toFixed(2)}</p>
              </div>
              <div className="flex justify-between border-t border-gray-800 pt-4">
                <div>
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Completed Orders</p>
                  <p className="text-lg font-bold text-gray-300">{todayCompleted.length}</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">VAT Collected</p>
                  <p className="text-lg font-bold text-gray-300">P{todayVat.toFixed(2)}</p>
                </div>
              </div>
            </div>
            <button onClick={archiveDay} className="w-full bg-red-900/20 border border-red-900 text-red-400 hover:bg-red-600 hover:text-white font-bold py-3 rounded-lg transition text-sm">
              Close Register & Archive Day
            </button>
          </div>

          <div className="bg-surface border border-gray-800 rounded-xl p-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-dark/20 rounded-t-xl">
              <h3 className="text-gray-300 font-bold text-sm tracking-wider uppercase">Sales History</h3>
              <button onClick={exportAllToCSV} className="text-[10px] bg-dark border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-800 hover:text-white transition font-bold uppercase tracking-wider">
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
                            <button onClick={() => exportDayToCSV(date, data.orders)} className="text-[10px] bg-dark border border-gray-600 text-gray-300 px-2 py-1 rounded hover:bg-gray-800 hover:text-white transition font-bold uppercase tracking-wider">
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
                                      <span className="text-xs font-bold text-gray-300">P{order.total.toFixed(2)}</span>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    {order.items.map((item, idx) => (
                                      <div key={idx} className="flex justify-between text-[11px] text-gray-400">
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
      )}

      {/* --- INVENTORY TAB --- */}
      {activeTab === 'inventory' && (
        <div className="flex flex-col xl:flex-row gap-8">
          
          <div className="flex-1 bg-surface border border-gray-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
              <h3 className="text-xl font-bold text-accent">Inventory Management</h3>
              <button onClick={exportInventoryToCSV} className="text-[10px] bg-dark border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-800 hover:text-white transition font-bold uppercase tracking-wider">
                Export Inventory
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="pb-3">Item Name</th>
                    <th className="pb-3 text-right">Stock Qty</th>
                    <th className="pb-3">Unit</th>
                    <th className="pb-3 text-right">Unit Cost</th>
                    <th className="pb-3 text-right">Total Value</th>
                    <th className="pb-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map(item => (
                    <tr key={item._id} className="border-b border-gray-800/50 hover:bg-dark/30">
                      <td className="py-3 font-bold text-gray-200">{item.itemName}</td>
                      <td className={`py-3 text-right font-bold ${item.stockQty < 10 ? 'text-red-400' : 'text-gray-300'}`}>{item.stockQty}</td>
                      <td className="py-3 text-gray-500 pl-2">{item.unit}</td>
                      <td className="py-3 text-right text-gray-400">P{item.unitCost.toFixed(4)}</td>
                      <td className="py-3 text-right text-accent font-semibold">P{(item.stockQty * item.unitCost).toFixed(2)}</td>
                      <td className="py-3 text-center">
                         <button onClick={() => deleteInventory(item._id)} className="text-red-500 hover:text-red-400 text-xs font-bold px-2 py-1 bg-red-900/20 rounded transition">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {inventory.length === 0 && <tr><td colSpan="6" className="py-6 text-center text-gray-500">No inventory items found. Add some on the right.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="w-full xl:w-96 bg-surface border border-gray-800 rounded-xl p-6 h-fit">
            <h3 className="text-lg font-bold text-white mb-4 border-b border-gray-800 pb-2">Receive New Inventory</h3>
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
                    // If they select an existing item, auto-fill the unit so they don't mess it up!
                    setInvForm({...invForm, itemName: typed, unit: match ? match.unit : invForm.unit});
                  }} 
                  className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" 
                />
                <datalist id="inventory-names">
                  {inventory.map(inv => <option key={inv._id} value={inv.itemName} />)}
                </datalist>
                
                {/* Visual Hint for Restock Mode */}
                {inventory.some(i => i.itemName.toLowerCase() === invForm.itemName.toLowerCase().trim()) && (
                  <p className="text-[10px] text-accent font-bold mt-1 uppercase tracking-wider">★ Existing Item: Will be Restocked</p>
                )}
              </div>
              <div className="flex gap-2">
                 <div className="w-1/3">
                   <label className="text-[10px] text-gray-400 block mb-1 uppercase font-bold">Qty Bought</label>
                   <input type="number" placeholder="Cans/Packs" value={invForm.packQty} onChange={e => setInvForm({...invForm, packQty: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" />
                 </div>
                 <div className="w-1/3">
                   <label className="text-[10px] text-gray-400 block mb-1 uppercase font-bold">Weight/Vol</label>
                   <input type="number" placeholder="Per Pack" value={invForm.unitPerPack} onChange={e => setInvForm({...invForm, unitPerPack: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" />
                 </div>
                 <div className="w-1/3">
                   <label className="text-[10px] text-gray-400 block mb-1 uppercase font-bold">Unit</label>
                   <select value={invForm.unit} onChange={e => setInvForm({...invForm, unit: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent">
                     <option value="" disabled>Select...</option>
                     <option value="g">Grams (g)</option>
                     <option value="ml">mL (ml)</option>
                     <option value="pcs">Pieces (pcs)</option>
                   </select>
                 </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1 uppercase font-bold">Price Paid Per Pack/Can (P)</label>
                <input type="number" placeholder="e.g., 45.00" value={invForm.costPerPack} onChange={e => setInvForm({...invForm, costPerPack: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" />
              </div>
              {(invForm.packQty && invForm.unitPerPack && invForm.costPerPack && invForm.unit) && (
                <div className="bg-dark/50 p-3 rounded border border-gray-700 text-sm">
                  <p className="text-gray-400 mb-1">System will save to inventory:</p>
                  <div className="flex justify-between font-bold text-white mb-1">
                    <span>Total Stock Added:</span>
                    <span className="text-accent">{(invForm.packQty * invForm.unitPerPack).toLocaleString()} {invForm.unit}</span>
                  </div>
                  <div className="flex justify-between font-bold text-white">
                    <span>Cost per {invForm.unit}:</span>
                    <span className="text-accent">P{(invForm.costPerPack / invForm.unitPerPack).toFixed(4)}</span>
                  </div>
                </div>
              )}
              <button onClick={addInventory} className="w-full bg-accent text-dark font-bold py-3 rounded hover:bg-yellow-500 transition shadow-lg shadow-accent/20">Add to Stock</button>
            </div>
          </div>
        </div>
      )}

      {/* --- ACCOUNTING & LEDGER TAB --- */}
      {activeTab === 'ledger' && (
        <div className="flex flex-col xl:flex-row gap-8">
          <div className="w-full xl:w-1/3 bg-surface border border-gray-800 rounded-xl p-6 h-fit">
            <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">New Journal Entry</h3>
            <div className="space-y-4">
              <input type="text" placeholder="Description / Memo" value={jeForm.description} onChange={e => setJeForm({...jeForm, description: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none" />
              {jeForm.lines.map((line, idx) => (
                <div key={idx} className="bg-dark p-3 rounded border border-gray-700 space-y-2">
                  <select value={line.accountCode} onChange={(e) => {
                    const acc = standardAccounts.find(a => a.accountCode === e.target.value);
                    const newLines = [...jeForm.lines];
                    newLines[idx] = { ...line, accountCode: acc.accountCode, accountName: acc.accountName };
                    setJeForm({...jeForm, lines: newLines});
                  }} className="w-full bg-dark border border-gray-600 rounded p-2 text-sm text-white">
                    <option value="">Select Account...</option>
                    {standardAccounts.map(acc => <option key={acc.accountCode} value={acc.accountCode}>{acc.accountCode} - {acc.accountName}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <input type="number" placeholder="Debit" value={line.debit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].debit = e.target.value; nl[idx].credit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-dark border border-gray-600 rounded p-2 text-sm text-white placeholder-gray-500" />
                    <input type="number" placeholder="Credit" value={line.credit} onChange={e => { const nl = [...jeForm.lines]; nl[idx].credit = e.target.value; nl[idx].debit = ''; setJeForm({...jeForm, lines: nl}); }} className="w-1/2 bg-dark border border-gray-600 rounded p-2 text-sm text-white placeholder-gray-500" />
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
                  await fetch(`${API_URL}/api/journal`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(jeForm) });
                  setJeForm({ description: '', lines: [{accountCode:'', accountName:'', debit:'', credit:''}, {accountCode:'', accountName:'', debit:'', credit:''}] });
                  fetchERPData();
                }} className="bg-accent text-dark font-bold py-2 px-4 rounded hover:bg-yellow-500">Post Entry</button>
              </div>
            </div>
          </div>
          <div className="flex-1 bg-surface border border-gray-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
              <h3 className="text-xl font-bold text-white">General Ledger</h3>
              <button onClick={exportLedgerToCSV} className="text-[10px] bg-dark border border-gray-600 text-gray-300 px-3 py-1.5 rounded hover:bg-gray-800 hover:text-white transition font-bold uppercase tracking-wider">
                Export Ledger
              </button>
            </div>
            <div className="space-y-4">
              {journalEntries.map(entry => (
                <div key={entry._id} className="bg-dark border border-gray-700 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
                    <span className="text-accent font-bold">{entry.reference}</span>
                    <span className="text-gray-400 text-sm">{new Date(entry.date).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-white mb-3 font-semibold">{entry.description}</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-gray-500 text-left"><th className="pb-2">Account</th><th className="pb-2 text-right">Debit</th><th className="pb-2 text-right">Credit</th></tr></thead>
                    <tbody>
                      {entry.lines.map((line, idx) => (
                        <tr key={idx} className="border-t border-gray-800/50">
                          <td className={`py-1 ${line.credit > 0 ? 'pl-6 text-gray-400' : 'text-gray-200'}`}>{line.accountCode} - {line.accountName}</td>
                          <td className="py-1 text-right text-gray-300">{line.debit > 0 ? line.debit.toFixed(2) : ''}</td>
                          <td className="py-1 text-right text-gray-300">{line.credit > 0 ? line.credit.toFixed(2) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- MENU SETUP (PRODUCTS/CATEGORIES) --- */}
      {activeTab === 'products' && (
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="flex-1 bg-surface border border-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Menu Items</h3>
            <div className="space-y-3">
              {products.map(p => (
                <div key={p._id} className="flex gap-4 p-4 border border-gray-800 rounded bg-dark items-center">
                  {p.image ? (
                    <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded shadow-md border border-gray-700" />
                  ) : (
                    <div className="w-16 h-16 bg-gray-800 rounded border border-gray-700 flex items-center justify-center text-xs text-gray-500">No Img</div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold">{p.name} <span className="text-xs text-accent ml-2">({p.category})</span></h4>
                      
                      {/* --- ESTIMATED STOCK BADGE --- */}
                      {(() => {
                        const est = getEstimatedStock(p.baseRecipe);
                        if (est === null) return null;
                        return (
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${est <= 0 ? 'bg-red-900/50 text-red-400' : est <= 5 ? 'bg-yellow-900/50 text-yellow-500' : 'bg-green-900/50 text-green-400'}`}>
                            {est <= 0 ? 'Out of Stock' : `Est: ${est} left`}
                          </span>
                        );
                      })()}
                      {/* ----------------------------- */}
                      
                    </div>
                    {p.description && <p className="text-xs text-gray-500 mt-1 line-clamp-1">{p.description}</p>}
                    <p className="text-sm text-gray-400 mt-1">P{Number(p.basePrice || p.price || 0).toFixed(2)} {p.baseSize && <span className="text-xs text-gray-600">({p.baseSize})</span>} {p.sizes?.length > 0 && `(+ ${p.sizes.length} sizes)`}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => { 
                        setEditingProduct(p); 
                        setFormData({ 
                          name: p.name || '', category: p.category || '', description: p.description || '', 
                          basePrice: Number(p.basePrice || p.price || 0), baseSize: p.baseSize || '', 
                          sizes: p.sizes || [], image: p.image || '', baseRecipe: p.baseRecipe || []
                        }); 
                      }} 
                      className="px-3 py-1 bg-gray-800 rounded text-sm hover:bg-gray-700"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 border-t border-gray-800 pt-6">
              <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Manage Categories</h3>
              <form onSubmit={handleAddCategory} className="flex gap-3 mb-6">
                <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="New category name..." className="flex-1 bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" required />
                <button type="submit" className="bg-accent text-dark font-bold px-6 py-2 rounded hover:bg-yellow-500">Add</button>
              </form>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {categories.map(c => (
                  <div key={c._id} className="flex justify-between items-center p-3 border border-gray-800 rounded bg-dark">
                    <span className="font-bold text-sm">{c.name}</span>
                    <button onClick={() => deleteCategory(c._id)} className="text-red-500 hover:text-red-400 text-xs font-semibold">✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="w-full lg:w-96 bg-surface border border-gray-800 rounded-lg p-6 h-fit sticky top-8">
            <h3 className="text-xl font-bold text-accent mb-4 border-b border-gray-800 pb-2">{editingProduct ? 'Edit Product' : 'Add Product'}</h3>
            <form onSubmit={handleSaveProduct} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Product Image (WebP Auto-Convert)</label>
                <div className="flex items-center gap-4">
                  {formData.image ? (
                    <img src={formData.image} alt="Preview" className="w-16 h-16 object-cover rounded border border-accent" />
                  ) : (
                    <div className="w-16 h-16 bg-dark border border-gray-700 rounded flex items-center justify-center text-xs text-gray-500">None</div>
                  )}
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gray-800 file:text-white hover:file:bg-gray-700 cursor-pointer" />
                </div>
              </div>
              <div><label className="block text-sm text-gray-400 mb-1">Name</label><input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" /></div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Category</label>
                <select required value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent">
                  <option value="" disabled>Select Category...</option>
                  {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="block text-sm text-gray-400 mb-1">Description</label><textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent h-20 placeholder-gray-600" /></div>
              
              <div className="bg-dark p-4 rounded border border-gray-700 mt-6">
                <label className="block text-sm font-bold text-white mb-2 uppercase tracking-wider">Base Size / Standard Recipe</label>
                <div className="flex gap-2 mb-1">
                  <input type="text" placeholder="Size Name (e.g. Regular)" value={formData.baseSize || ''} onChange={e => setFormData({...formData, baseSize: e.target.value})} className="w-1/2 bg-dark border border-gray-600 rounded p-2 text-white outline-none focus:border-accent" />
                  <input type="number" step="0.01" placeholder="Selling Price" value={formData.basePrice} onChange={e => setFormData({...formData, basePrice: parseFloat(e.target.value) || 0})} className="w-1/2 bg-dark border border-gray-600 rounded p-2 text-white outline-none focus:border-accent" />
                </div>
                {(() => {
                  const baseCost = calcRecipeCost(formData.baseRecipe);
                  const basePriceVal = parseFloat(formData.basePrice) || 0;
                  const suggestedBasePrice = baseCost > 0 ? (baseCost / 0.7).toFixed(2) : '0.00';
                  const baseMargin = basePriceVal > 0 ? (((basePriceVal - baseCost) / basePriceVal) * 100).toFixed(1) : '0.0';
                  return baseCost > 0 ? (
                    <div className="flex justify-between text-[10px] px-1 mb-3">
                      <span className={parseFloat(baseMargin) >= 30 ? "text-green-400 font-bold" : "text-yellow-500 font-bold"}>Margin: {baseMargin}%</span>
                      <button type="button" onClick={() => setFormData({...formData, basePrice: parseFloat(suggestedBasePrice)})} className="text-gray-400 hover:text-accent transition">Set 30% Margin (P{suggestedBasePrice})</button>
                    </div>
                  ) : <div className="mb-3"></div>;
                })()}
                
                <div className="bg-black/30 p-3 rounded mb-2">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-gray-400 font-bold">Base Materials (BOM)</span>
                    <span className="text-xs text-accent font-bold">Cost: P{calcRecipeCost(formData.baseRecipe).toFixed(2)}</span>
                  </div>
                  {(formData.baseRecipe || []).map((mat, i) => (
                    <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                      <span className="flex-1 text-gray-300 truncate">{mat.name}</span>
                      <input type="number" value={mat.qty} onChange={e => updateMaterialQty(e.target.value, i, null)} className="w-16 bg-dark border border-gray-600 rounded p-1 text-center text-white" />
                      <span className="text-gray-500 w-8">{mat.unit}</span>
                      <button type="button" onClick={() => removeMaterial(i, null)} className="text-red-500 hover:text-red-400 font-bold ml-2">✕</button>
                    </div>
                  ))}
                  {/* --- NEW SCROLLABLE MATERIAL PICKER --- */}
                  <div className="mt-3">
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-1 px-1 tracking-wider">Tap to Add Material</div>
                    <div className="max-h-28 overflow-y-auto bg-dark border border-gray-600 rounded scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                      {inventory.length === 0 ? (
                        <p className="p-2 text-xs text-gray-500 italic">No inventory available.</p>
                      ) : (
                        inventory.map(inv => (
                          <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, null)} className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition border-b border-gray-700/50 last:border-0 flex justify-between items-center">
                            <span className="truncate pr-2">+ {inv.itemName}</span>
                            <span className="text-gray-500 shrink-0">P{inv.unitCost.toFixed(4)}/{inv.unit}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-800 pt-4 mt-2">
                <div className="flex justify-between items-center mb-4">
                  <label className="text-sm font-bold text-white uppercase tracking-wider">Extra Sizes (Small, Large)</label>
                  <button type="button" onClick={addSize} className="text-xs bg-dark px-3 py-1.5 rounded font-bold text-accent border border-accent hover:bg-accent hover:text-dark transition">+ Add Size</button>
                </div>
                {(formData.sizes || []).map((size, idx) => (
                  <div key={idx} className="bg-dark p-4 rounded border border-gray-700 mb-4">
                    <div className="flex gap-2 mb-1">
                      <input type="text" placeholder="Size Name" value={size.name} onChange={e => updateSize(idx, 'name', e.target.value)} className="w-1/2 bg-dark border border-gray-600 rounded p-2 text-sm text-white" required />
                      <input type="number" step="0.01" placeholder="Selling Price" value={size.price} onChange={e => updateSize(idx, 'price', e.target.value)} className="w-1/3 bg-dark border border-gray-600 rounded p-2 text-sm text-white" required />
                      <button type="button" onClick={() => removeSize(idx)} className="text-red-500 hover:text-red-400 font-bold ml-auto px-2">✕</button>
                    </div>
                    {(() => {
                      const sizeCost = calcRecipeCost(size.recipe);
                      const sizePriceVal = parseFloat(size.price) || 0;
                      const suggestedSizePrice = sizeCost > 0 ? (sizeCost / 0.7).toFixed(2) : '0.00';
                      const sizeMargin = sizePriceVal > 0 ? (((sizePriceVal - sizeCost) / sizePriceVal) * 100).toFixed(1) : '0.0';
                      return sizeCost > 0 ? (
                        <div className="flex justify-between text-[10px] px-1 mb-3">
                          <span className={parseFloat(sizeMargin) >= 30 ? "text-green-400 font-bold" : "text-yellow-500 font-bold"}>Margin: {sizeMargin}%</span>
                          <button type="button" onClick={() => updateSize(idx, 'price', parseFloat(suggestedSizePrice))} className="text-gray-400 hover:text-accent transition">Set 30% Margin (P{suggestedSizePrice})</button>
                        </div>
                      ) : <div className="mb-3"></div>;
                    })()}
                    <div className="bg-black/30 p-3 rounded">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-gray-400 font-bold">{size.name || 'New Size'} Materials</span>
                        <span className="text-xs text-accent font-bold">Cost: P{calcRecipeCost(size.recipe).toFixed(2)}</span>
                      </div>
                      {(size.recipe || []).map((mat, i) => (
                        <div key={i} className="flex items-center gap-2 mb-2 text-sm">
                          <span className="flex-1 text-gray-300 truncate">{mat.name}</span>
                          <input type="number" value={mat.qty} onChange={e => updateMaterialQty(e.target.value, i, idx)} className="w-16 bg-dark border border-gray-600 rounded p-1 text-center text-white" />
                          <span className="text-gray-500 w-8">{mat.unit}</span>
                          <button type="button" onClick={() => removeMaterial(i, idx)} className="text-red-500 hover:text-red-400 font-bold ml-2">✕</button>
                        </div>
                      ))}
                      {/* --- NEW SCROLLABLE MATERIAL PICKER --- */}
                      <div className="mt-3">
                        <div className="text-[10px] text-gray-500 uppercase font-bold mb-1 px-1 tracking-wider">Tap to Add Material</div>
                        <div className="max-h-28 overflow-y-auto bg-dark border border-gray-600 rounded scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                          {inventory.length === 0 ? (
                            <p className="p-2 text-xs text-gray-500 italic">No inventory available.</p>
                          ) : (
                            inventory.map(inv => (
                              <button type="button" key={inv._id} onClick={() => addMaterialToRecipe(inv._id, idx)} className="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition border-b border-gray-700/50 last:border-0 flex justify-between items-center">
                                <span className="truncate pr-2">+ {inv.itemName}</span>
                                <span className="text-gray-500 shrink-0">P{inv.unitCost.toFixed(4)}/{inv.unit}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-6">
                <button type="submit" className="flex-1 bg-accent text-dark font-black py-4 rounded-lg hover:bg-yellow-500 shadow-lg shadow-accent/20 transition uppercase tracking-wider">
                  {editingProduct ? 'Update Product' : 'Save Product'}
                </button>
                {editingProduct && (
                  <button type="button" onClick={() => deleteProduct(editingProduct._id)} className="bg-red-900/20 border border-red-900 text-red-500 font-black py-4 px-6 rounded-lg hover:bg-red-900 hover:text-white transition uppercase tracking-wider">
                    Delete
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
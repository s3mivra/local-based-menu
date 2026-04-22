import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import QRCode from '../components/QRCode.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.100.2:5001';
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || 'http://192.168.100.2:3000';
const socket = io(API_URL);

// Native Browser Audio Beep
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
  // NEW: Added 'image' to formData
  const [formData, setFormData] = useState({ name: '', description: '', category: '', basePrice: '', baseSize: '', sizes: [], image: '' });
  const [newCatName, setNewCatName] = useState('');

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
      const res = await fetch(`${API_URL}/api/orders`);
      if (res.ok) setOrders((await res.json()).orders || []);
      
      const archRes = await fetch(`${API_URL}/api/orders/archives`);
      if (archRes.ok) setArchivedOrders((await archRes.json()).archives || []);
    } catch (err) { console.error('Failed to fetch orders', err); }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchOrders();
    fetchData();

    socket.on('newOrder', (order) => { setOrders(prev => [order, ...prev]); playKitchenDing(); });
    socket.on('orderUpdated', (updated) => setOrders(prev => prev.map(o => o._id === updated._id ? updated : o)));
    socket.on('menuUpdated', fetchData);
    socket.on('ordersArchived', fetchOrders); 

    return () => {
      socket.off('newOrder'); socket.off('orderUpdated'); socket.off('menuUpdated'); socket.off('ordersArchived');
    };
  }, [isAuthenticated]);

  // --- ACTIONS ---
  const updateStatus = async (orderId, newStatus) => {
    socket.emit('updateOrderStatus', { orderId, status: newStatus });
    await fetch(`${API_URL}/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
  };
  const toggleVat = async (orderId, currentVatRate) => { await fetch(`${API_URL}/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isVatExempt: currentVatRate > 0 }) }); };
  const applyDiscount = async (orderId, isRemoving = false) => {
    const percent = isRemoving ? 0 : parseFloat(discountInputs[orderId] || 0);
    if (percent < 0 || percent > 100) return alert('Discount must be between 0% and 100%');
    await fetch(`${API_URL}/api/orders/${orderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discountPercent: percent }) });
    if (isRemoving) setDiscountInputs(prev => ({ ...prev, [orderId]: '' }));
  };
  const archiveDay = async () => {
    if (!window.confirm("Are you sure you want to close the day? This will archive all completed orders.")) return;
    await fetch(`${API_URL}/api/orders/archive`, { method: 'POST' });
  };

  // --- EXPORT ENGINE ---
  const generateCSV = (ordersList, filename) => {
    if (ordersList.length === 0) return alert("No orders to export.");
    const headers = ['Date', 'Order Number', 'Status', 'Items', 'Subtotal', 'VAT', 'Discount', 'Total'];
    const rows = ordersList.map(order => {
      const date = new Date(order.createdAt).toLocaleString();
      const itemsStr = order.items.map(i => `${i.quantity}x ${i.name}`).join(' | ');
      return [
        `"${date}"`, `"${order.orderNumber}"`, `"${order.status}"`, `"${itemsStr}"`,
        order.subtotal.toFixed(2), order.vatAmount.toFixed(2), order.discount.toFixed(2), order.total.toFixed(2)
      ].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const exportAllToCSV = () => {
    const allOrdersToExport = [...orders.filter(o => o.status === 'Completed'), ...archivedOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    generateCSV(allOrdersToExport, `Sales_Export_ALL_${new Date().toISOString().split('T')[0]}.csv`);
  };
  const exportDayToCSV = (dateString, dayOrders) => {
    const safeDate = dateString.replace(/,/g, '').replace(/ /g, '_');
    generateCSV(dayOrders, `Sales_Export_${safeDate}.csv`);
  };
  
  // --- MENU CRUD & WEBP COMPRESSION ---
  const handleAddCategory = async (e) => { e.preventDefault(); if(!newCatName.trim()) return; await fetch(`${API_URL}/api/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCatName }) }); setNewCatName(''); };
  const deleteCategory = async (id) => { if(window.confirm('Delete category?')) await fetch(`${API_URL}/api/categories/${id}`, { method: 'DELETE' }); };

  // NEW: Process image to WebP instantly
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600; // Optimal size for mobile menus
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const webpBase64 = canvas.toDataURL('image/webp', 0.8);
        setFormData({ ...formData, image: webpBase64 });
      };
    };
  };

  const handleSaveProduct = async (e) => { e.preventDefault(); const method = editingProduct ? 'PUT' : 'POST'; const url = editingProduct ? `${API_URL}/api/products/${editingProduct._id}` : `${API_URL}/api/products`; await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) }); setEditingProduct(null); setFormData({ name: '', description: '', category: '', basePrice: '', baseSize: '', sizes: [], image: '' }); };
  const deleteProduct = async (id) => { if(window.confirm("Delete this product?")) await fetch(`${API_URL}/api/products/${id}`, { method: 'DELETE' }); };
  const addSize = () => setFormData({ ...formData, sizes: [...formData.sizes, { name: '', price: 0 }] });
  const updateSize = (index, field, value) => { const newSizes = [...formData.sizes]; newSizes[index][field] = field === 'price' ? parseFloat(value) || 0 : value; setFormData({ ...formData, sizes: newSizes }); };
  const removeSize = (index) => setFormData({ ...formData, sizes: formData.sizes.filter((_, i) => i !== index) });

  // --- LOGIN SCREEN ---
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

  // --- DATA PROCESSING FOR UI ---
  const filteredOrders = orders.filter(o => orderFilter === 'All' ? true : o.status === orderFilter);
  const todayCompleted = orders.filter(o => o.status === 'Completed');
  const todayRevenue = todayCompleted.reduce((sum, o) => sum + o.total, 0);
  const todayVat = todayCompleted.reduce((sum, o) => sum + o.vatAmount, 0);

  const groupedArchives = archivedOrders.reduce((acc, order) => {
    const date = new Date(order.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (!acc[date]) acc[date] = { orders: [], revenue: 0, vat: 0, discounts: 0 };
    acc[date].orders.push(order);
    acc[date].revenue += order.total;
    acc[date].vat += order.vatAmount;
    acc[date].discounts += order.discount;
    return acc;
  }, {});

  const toggleDay = (date) => setExpandedDays(prev => ({ ...prev, [date]: !prev[date] }));
  const toggleOrderList = (date) => setExpandedOrderLists(prev => ({ ...prev, [date]: !prev[date] })); 

  return (
    <div className="min-h-screen bg-dark text-white p-6 lg:p-8">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-gray-800 pb-4 gap-4">
        <div className="flex gap-6 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
          <button onClick={() => setActiveTab('orders')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'orders' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Orders & Sales</button>
          <button onClick={() => setActiveTab('products')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'products' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Products</button>
          <button onClick={() => setActiveTab('categories')} className={`text-xl font-bold transition whitespace-nowrap ${activeTab === 'categories' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'}`}>Categories</button>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <button onClick={() => setShowQR(true)} className="flex-1 md:flex-none bg-dark border border-gray-600 text-white px-4 py-2 rounded-md font-bold hover:bg-gray-800 transition">Show QR</button>
          <button onClick={() => { setIsAuthenticated(false); setPinInput(''); }} className="flex-1 md:flex-none bg-red-900/50 text-red-500 px-4 py-2 rounded-md font-bold hover:bg-red-900 transition">Lock</button>
        </div>
      </div>

      {/* QR MODAL */}
      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-8 rounded-xl border border-gray-700 shadow-2xl flex flex-col items-center max-w-sm w-full relative">
            <button onClick={() => setShowQR(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white font-bold text-xl">✕</button>
            <h2 className="text-2xl font-bold mb-2 text-white">Customer Menu</h2>
            <p className="text-sm text-gray-400 mb-6 text-center">Let the customer scan this code to order.</p>
            <QRCode url={FRONTEND_URL} size={220} />
            <button onClick={() => setShowQR(false)} className="mt-6 w-full bg-dark border border-gray-600 text-white font-bold py-3 rounded-md hover:bg-gray-800">Close</button>
          </div>
        </div>
      )}

      {/* --- ORDERS & SALES TAB --- */}
      {activeTab === 'orders' && (
        <div className="flex flex-col xl:flex-row gap-8">
          
          {/* LEFT: ORDER MANAGEMENT */}
          <div className="flex-1">
            <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
              {['All', 'Pending', 'Preparing', 'Completed', 'Cancelled'].map(filter => (
                <button key={filter} onClick={() => setOrderFilter(filter)} className={`px-4 py-2 rounded-full text-sm font-bold transition whitespace-nowrap ${orderFilter === filter ? 'bg-accent text-dark' : 'bg-surface border border-gray-700 text-gray-400 hover:text-white'}`}>
                  {filter}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredOrders.length === 0 ? (
                <div className="col-span-full text-center py-12 text-gray-500">No {orderFilter.toLowerCase()} orders found.</div>
              ) : filteredOrders.map(order => (
                <div key={order._id} className="bg-surface rounded-xl p-5 border border-gray-800 flex flex-col shadow-lg">
                  <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3">
                    <h2 className="text-lg font-black">{order.orderNumber}</h2>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${order.status === 'Pending' ? 'bg-red-900/50 text-red-400' : order.status === 'Preparing' ? 'bg-yellow-900/50 text-accent' : order.status === 'Completed' ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-400'}`}>{order.status}</span>
                  </div>
                  
                  <div className="space-y-2 mb-4 flex-1">
                    {order.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="font-semibold text-gray-200">{item.quantity}x {item.name}</span>
                        <span className="text-gray-500">${(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="bg-dark/50 p-3 rounded-lg border border-gray-800/50 space-y-2 mb-4">
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>Subtotal:</span><span>${order.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-gray-400">
                      <div className="flex items-center gap-2">
                        <span>VAT ({(order.vatRate * 100).toFixed(0)}%):</span>
                        {(order.status === 'Pending' || order.status === 'Preparing') && (
                          <button onClick={() => toggleVat(order._id, order.vatRate)} className="bg-gray-700 hover:bg-gray-600 text-white px-1.5 py-0.5 rounded text-[9px] uppercase font-bold">{order.vatRate > 0 ? 'Off' : 'On'}</button>
                        )}
                      </div>
                      <span>${order.vatAmount.toFixed(2)}</span>
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
                      <span className="text-green-400">-${(order.discount || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-black text-lg pt-1">
                      <span>Total:</span><span className="text-accent">${order.total.toFixed(2)}</span>
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
                      <button onClick={() => updateStatus(order._id, 'Completed')} className="flex-1 bg-accent text-dark py-2.5 rounded-lg hover:bg-yellow-500 font-bold text-sm shadow-lg shadow-accent/10 transition">Mark Completed</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: SALES & HISTORY PANE */}
          <div className="w-full xl:w-[400px] flex flex-col gap-6">
            
            {/* Today's Sales Box */}
            <div className="bg-surface border border-accent/20 rounded-xl p-6 shadow-xl shadow-accent/5">
              <h3 className="text-accent font-black tracking-widest uppercase text-sm mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span> Active Register
              </h3>
              <div className="space-y-4 mb-6">
                <div>
                  <p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Today's Revenue</p>
                  <p className="text-4xl font-black text-white">${todayRevenue.toFixed(2)}</p>
                </div>
                <div className="flex justify-between border-t border-gray-800 pt-4">
                  <div>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Completed Orders</p>
                    <p className="text-lg font-bold text-gray-300">{todayCompleted.length}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">VAT Collected</p>
                    <p className="text-lg font-bold text-gray-300">${todayVat.toFixed(2)}</p>
                  </div>
                </div>
              </div>
              <button onClick={archiveDay} className="w-full bg-red-900/20 border border-red-900 text-red-400 hover:bg-red-600 hover:text-white font-bold py-3 rounded-lg transition text-sm">
                Close Register & Archive Day
              </button>
            </div>

            {/* History Accordion */}
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
                          <span className="text-accent font-bold">${data.revenue.toFixed(2)}</span>
                          <span className="text-gray-500 text-xs">{expandedDays[date] ? '▲' : '▼'}</span>
                        </div>
                      </button>
                      
                      {expandedDays[date] && (
                        <div className="p-4 bg-dark/30 border-t border-gray-800/30 flex flex-col gap-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Orders</p><p className="text-sm font-semibold">{data.orders.length}</p></div>
                            <div><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">VAT</p><p className="text-sm font-semibold">${data.vat.toFixed(2)}</p></div>
                            <div className="col-span-2"><p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Discounts</p><p className="text-sm font-semibold text-red-400">-${data.discounts.toFixed(2)}</p></div>
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
                                      <span className="text-xs font-bold text-gray-300">${order.total.toFixed(2)}</span>
                                    </div>
                                    <div className="space-y-1">
                                      {order.items.map((item, idx) => (
                                        <div key={idx} className="flex justify-between text-[11px] text-gray-400">
                                          <span>{item.quantity}x {item.name}</span><span>${(item.price * item.quantity).toFixed(2)}</span>
                                        </div>
                                      ))}
                                    </div>
                                    {(order.discount > 0 || order.vatAmount > 0) && (
                                      <div className="mt-2 pt-2 border-t border-gray-800/50 flex justify-between text-[10px] text-gray-500">
                                        <span>VAT: ${order.vatAmount.toFixed(2)}</span>
                                        {order.discount > 0 && <span className="text-red-400">Disc: -${order.discount.toFixed(2)}</span>}
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
        </div>
      )}

      {/* --- PRODUCTS TAB --- */}
      {activeTab === 'products' && (
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="flex-1 bg-surface border border-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Menu Items</h3>
            <div className="space-y-3">
              {products.map(p => (
                <div key={p._id} className="flex gap-4 p-4 border border-gray-800 rounded bg-dark items-center">
                  
                  {/* NEW: Image Preview in Product List */}
                  {p.image ? (
                    <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded shadow-md border border-gray-700" />
                  ) : (
                    <div className="w-16 h-16 bg-gray-800 rounded border border-gray-700 flex items-center justify-center text-xs text-gray-500">No Img</div>
                  )}

                  <div className="flex-1">
                    <h4 className="font-bold">{p.name} <span className="text-xs text-accent ml-2">({p.category})</span></h4>
                    {p.description && <p className="text-xs text-gray-500 mt-1 line-clamp-1">{p.description}</p>}
                    <p className="text-sm text-gray-400 mt-1">${Number(p.basePrice || p.price || 0).toFixed(2)} {p.baseSize && <span className="text-xs text-gray-600">({p.baseSize})</span>} {p.sizes?.length > 0 && `(+ ${p.sizes.length} sizes)`}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button onClick={() => { setEditingProduct(p); setFormData({ name: p.name || '', category: p.category || '', description: p.description || '', basePrice: Number(p.basePrice || p.price || 0), baseSize: p.baseSize || '', sizes: p.sizes || [], image: p.image || '' }); }} className="px-3 py-1 bg-gray-800 rounded text-sm hover:bg-gray-700">Edit</button>
                    <button onClick={() => deleteProduct(p._id)} className="px-3 py-1 bg-red-900/50 text-red-500 rounded text-sm hover:bg-red-900">Del</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="w-full lg:w-96 bg-surface border border-gray-800 rounded-lg p-6 h-fit sticky top-8">
            <h3 className="text-xl font-bold text-accent mb-4 border-b border-gray-800 pb-2">{editingProduct ? 'Edit Product' : 'Add Product'}</h3>
            <form onSubmit={handleSaveProduct} className="space-y-4">
              
              {/* NEW: IMAGE UPLOAD INPUT */}
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
              <div>
                <label className="block text-sm text-gray-400 mb-1">Base Size & Price</label>
                <div className="flex gap-2">
                  <input type="text" placeholder="Size Name" value={formData.baseSize || ''} onChange={e => setFormData({...formData, baseSize: e.target.value})} className="w-1/2 bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" />
                  <input type="number" step="0.01" placeholder="Price" value={formData.basePrice} onChange={e => setFormData({...formData, basePrice: parseFloat(e.target.value) || 0})} className="w-1/2 bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" />
                </div>
              </div>
              <div className="border-t border-gray-800 pt-4">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-400">Extra Sizes (Optional)</label>
                  <button type="button" onClick={addSize} className="text-xs bg-dark px-2 py-1 rounded text-accent hover:bg-gray-800">+ Add</button>
                </div>
                {(formData.sizes || []).map((size, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <input type="text" placeholder="Name" value={size.name} onChange={e => updateSize(idx, 'name', e.target.value)} className="w-1/2 bg-dark border border-gray-700 rounded p-2 text-sm text-white" required />
                    <input type="number" step="0.01" placeholder="Price" value={size.price} onChange={e => updateSize(idx, 'price', e.target.value)} className="w-1/3 bg-dark border border-gray-700 rounded p-2 text-sm text-white" required />
                    <button type="button" onClick={() => removeSize(idx)} className="text-red-500 hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
              <button type="submit" className="w-full bg-accent text-dark font-bold py-3 rounded mt-4 hover:bg-yellow-500">{editingProduct ? 'Update Product' : 'Save Product'}</button>
            </form>
          </div>
        </div>
      )}

      {/* --- CATEGORIES TAB --- */}
      {activeTab === 'categories' && (
        <div className="max-w-2xl bg-surface border border-gray-800 rounded-lg p-6">
          <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Manage Categories</h3>
          <form onSubmit={handleAddCategory} className="flex gap-3 mb-6">
            <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="New category name..." className="flex-1 bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" required />
            <button type="submit" className="bg-accent text-dark font-bold px-6 py-2 rounded hover:bg-yellow-500">Add</button>
          </form>
          <div className="space-y-2">
            {categories.map(c => (
              <div key={c._id} className="flex justify-between items-center p-3 border border-gray-800 rounded bg-dark">
                <span className="font-bold">{c.name}</span>
                <button onClick={() => deleteCategory(c._id)} className="text-red-500 hover:text-red-400 text-sm font-semibold">Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
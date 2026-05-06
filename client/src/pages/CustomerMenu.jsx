import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.100.2:5002';
const socket = io(API_URL, { transports: ['websocket'], upgrade: false });

const playCustomerDing = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, ctx.currentTime); 
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.log('Audio blocked');
  }
};

export default function CustomerMenu() {
  // --- UI FLOW STATE MACHINE ---
  const [flowState, setFlowState] = useState('landing'); // 'landing' -> 'name_input' -> 'menu' -> 'status'
  
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]); // <-- THE FIX: Add this state
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);

  // --- SECURITY & SESSION STATE ---
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const [tableNum, setTableNum] = useState(null);
  const [successMessage, setSuccessMessage] = useState(false); 
  const [lockedOrder, setLockedOrder] = useState(null); 
  
  const [isVibrating, setIsVibrating] = useState(false);
  const vibrationInterval = useRef(null);
  const [isFinished, setIsFinished] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const wakeLockRef = useRef(null);

  const requestWakeLock = async () =>{
    try{
      if ('wakelock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
    } catch (err){ console.log('Wake Lock error:', err); }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current !== null) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };

  // --- 1. INITIALIZATION & PRELOAD ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    
    // If there is no secure session token in the URL, block them instantly.
    if (!session) {
      setIsAuthorized(false);
      setIsCheckingSession(false);
      return;
    }
    
    setSessionToken(session);

    // PRELOAD MENU DATA SILENTLY SO THERE IS NO LOADING SCREEN
    fetchProducts();

    const validateSessionAndCheckMemory = async () => {
      try {
        // 1. Verify with the backend that this link hasn't expired (10 min rule)
        const heartbeatRes = await fetch(`${API_URL}/api/sessions/${session}/heartbeat`, { method: 'POST' });
        const heartbeatData = await heartbeatRes.json();

        if (heartbeatData.success) {
          setIsAuthorized(true);
          setTableNum(heartbeatData.table);
          
          // 2. If valid, check if they already have an active order on their screen
          const savedOrderId = localStorage.getItem('semivra_active_order');
          if (savedOrderId) {
            const orderRes = await fetch(`${API_URL}/api/orders/${savedOrderId}`);
            if (orderRes.ok) {
              const orderData = await orderRes.json();
              if (orderData.status !== 'Cancelled' && orderData.status !== 'Voided' && !localStorage.getItem(`received_${savedOrderId}`)) {
                setLockedOrder(orderData);
                setFlowState('status');
              } else {
                localStorage.removeItem('semivra_active_order');
              }
            }
          }
        } else {
          setIsAuthorized(false); 
        }
      } catch (err) {
        setIsAuthorized(false);
      }
      setIsCheckingSession(false);
    };

    validateSessionAndCheckMemory();
  }, []);

  // --- 10-MINUTE INACTIVITY TRACKER ---
  useEffect(() => {
    if (!isAuthorized || !sessionToken) return;

    let inactivityTimer;
    let heartbeatInterval;

    const resetInactivity = () => {
      clearTimeout(inactivityTimer);
      // Auto-expire frontend after 10 mins of zero touches
      inactivityTimer = setTimeout(() => {
        setIsAuthorized(false);
      }, 10 * 60 * 1000); 
    };

    // Send a silent heartbeat to the server every 2 minutes while active
    heartbeatInterval = setInterval(async () => {
      await fetch(`${API_URL}/api/sessions/${sessionToken}/heartbeat`, { method: 'POST' });
    }, 2 * 60 * 1000);

    // Listen to user movements to keep session alive
    window.addEventListener('touchstart', resetInactivity);
    window.addEventListener('click', resetInactivity);
    window.addEventListener('scroll', resetInactivity);
    resetInactivity();

    return () => {
      clearTimeout(inactivityTimer);
      clearInterval(heartbeatInterval);
      window.removeEventListener('touchstart', resetInactivity);
      window.removeEventListener('click', resetInactivity);
      window.removeEventListener('scroll', resetInactivity);
    };
  }, [isAuthorized, sessionToken]);

  // --- 2. WEBSOCKET LISTENERS ---
  useEffect(() => {
    if (!tableNum) return;

    const handleOrderUpdated = (updatedOrder) => {
      if (updatedOrder.table === tableNum) {
        if (['Preparing', 'Ready', 'Completed'].includes(updatedOrder.status)) {
          if (!localStorage.getItem(`received_${updatedOrder._id}`)) {
            setLockedOrder(updatedOrder);
            setFlowState('status');
          }
        } else if (['Cancelled', 'Voided'].includes(updatedOrder.status)) {
          setLockedOrder(null);
          localStorage.removeItem('semivra_active_order');
          setFlowState('landing');
        }
      }
    };

    const handleArchive = () => {
      setLockedOrder(null);
      setCart([]);
      localStorage.removeItem('semivra_active_order');
      setFlowState('landing');
    };

    socket.on('menuUpdated', fetchProducts);
    socket.on('orderUpdated', handleOrderUpdated);
    socket.on('ordersArchived', handleArchive);

    return () => {
      socket.off('menuUpdated', fetchProducts);
      socket.off('orderUpdated', handleOrderUpdated);
      socket.off('ordersArchived', handleArchive);
    };
  }, [tableNum]);

  // --- 3. HARDWARE ALERTS ---
  useEffect(() => {
    if (lockedOrder?.status === 'Preparing') {
      playCustomerDing();
      setIsVibrating(false);
      if (vibrationInterval.current) clearInterval(vibrationInterval.current);
      requestWakeLock();
    } else if (lockedOrder?.status === 'Ready' || lockedOrder?.status === 'Completed') {
      playCustomerDing();
      
      if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function(registration) {
          registration.showNotification('Your Order is Ready! ☕', {
            body: 'Please collect your order at the counter.',
            icon: '/logo.png',
            vibrate: [1000, 500, 1000, 500, 2000],
            tag: 'order-ready',
            requireInteraction: true 
          });
        });
      }

      if (!isVibrating) {
        setIsVibrating(true);
        if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]); 
        vibrationInterval.current = setInterval(() => {
          if (navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
          playCustomerDing(); 
        }, 3000);
      }
    } else {
      setIsVibrating(false);
      if (vibrationInterval.current) clearInterval(vibrationInterval.current);
      releaseWakeLock(); 
    }

    return () => {
      if (vibrationInterval.current) clearInterval(vibrationInterval.current);
      releaseWakeLock();
    };
  }, [lockedOrder?.status]);

  // --- BURN AFTER RECEIVING ---
  const handleReceived = async () => {
    setIsVibrating(false);
    if (vibrationInterval.current) clearInterval(vibrationInterval.current);
    releaseWakeLock(); 
    
    if (lockedOrder) {
      localStorage.setItem(`received_${lockedOrder._id}`, 'true');
    }
    
    localStorage.removeItem('semivra_active_order');
    localStorage.removeItem('semivra_order_time');

    // 🔥 PERMANENTLY DESTROY THE LINK
    await fetch(`${API_URL}/api/sessions/${sessionToken}/close`, { method: 'POST' });
    
    setIsFinished(true); 
    setLockedOrder(null);
    setCart([]);
  };

  const fetchProducts = async () => {
    try {
      // Fetch Products
      const res = await fetch(`${API_URL}/api/products?t=${new Date().getTime()}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setProducts(data.products);
      
      // FIX: Fetch Categories so the dynamic Kitchen/Bar routing knows where to send items!
      const catRes = await fetch(`${API_URL}/api/categories?t=${new Date().getTime()}`, { cache: 'no-store' });
      const catData = await catRes.json();
      if (catData.success) setCategories(catData.categories);
      
    } catch (err) { 
      console.error("Failed to fetch menu data"); 
    }
  };

  const handleProductClick = (product) => {
    if (product.sizes && product.sizes.length > 0) {
      setSelectedProduct(product);
      setSelectedSize({ name: product.baseSize || 'Regular', price: Number(product.basePrice || 0) });
    } else {
      addToCart(product, null);
    }
  };

  const addToCart = (product, size) => {
    const price = size ? size.price : (product.basePrice || 0);
    const sizeName = size ? size.name : 'Regular';
    const cartItemId = `${product._id}-${sizeName}`;
    
    // --- SMART ROUTING ---
    // Look up the category and assign the department. Default to Kitchen if missing.
    const categoryObject = categories.find(c => c.name === product.category);
    const dept = categoryObject ? (categoryObject.department || 'Kitchen') : 'Kitchen'; 

    setCart(prev => {
      const existing = prev.find(item => item.cartItemId === cartItemId);
      if (existing) return prev.map(item => item.cartItemId === cartItemId ? { ...item, quantity: item.quantity + 1 } : item);
      
      // Inject department and itemStatus into the cart payload
      return [...prev, { cartItemId, productId: product._id, name: size ? `${product.name} (${sizeName})` : product.name, price, quantity: 1, department: dept, itemStatus: 'Received' }];
    });
    setSelectedProduct(null); setSelectedSize(null);
  };

  const updateQuantity = (cartItemId, delta) => {
    setCart(prev => prev.map(item => item.cartItemId === cartItemId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter(item => item.quantity > 0));
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted' && 'serviceWorker' in navigator) {
        await navigator.serviceWorker.register('/sw.js');
      }
      return permission === 'granted';
    } catch (error) { return false; }
  };

  const confirmOrder = async () => {
    if (isSubmitting) return; 
    setIsSubmitting(true);

    const idempotencyKey = `${sessionToken}-${Date.now()}`;
    try {
      const res = await fetch(`${API_URL}/api/orders`, {
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey // <-- FIX 1: Added header
        },
        body: JSON.stringify({ 
          items: cart, 
          discountPercent: 0, 
          isVatExempt: false, 
          table: tableNum, 
          customerName: customerName.trim(),
          sessionId: sessionToken // <-- FIX 2: Added session to body
        })
      });
      
      const data = await res.json();
      
      if (data.success) {
        setCart([]);
        setSuccessMessage(true);
        setTimeout(() => setSuccessMessage(false), 5000);

        localStorage.setItem('semivra_active_order', data.order._id);
        localStorage.setItem('semivra_order_time', Date.now().toString());
        setLockedOrder(data.order); 
        setFlowState('status');
        
        requestNotificationPermission();
      }
    } catch (error) { console.error("Order failed", error); }
  };

  const allCategories = ['All', ...new Set(products.map(p => p.category))];
  const displayedCategories = activeCategory === 'All' ? allCategories.filter(c => c !== 'All') : [activeCategory];

  const modalSizes = selectedProduct ? [{ name: selectedProduct.baseSize || 'Regular', price: Number(selectedProduct.basePrice || 0) }, ...(selectedProduct.sizes || [])] : [];
  const groupedSizes = modalSizes.reduce((acc, size) => {
    const lowerName = size.name.toLowerCase();
    if (lowerName.includes('hot')) {
      if (!acc.Hot) acc.Hot = []; acc.Hot.push({ ...size, displayName: size.name.replace(/hot\s*-?\s*/i, '').trim() });
    } else if (lowerName.includes('iced') || lowerName.includes('cold')) {
      if (!acc.Iced) acc.Iced = []; acc.Iced.push({ ...size, displayName: size.name.replace(/(iced|cold)\s*-?\s*/i, '').trim() });
    } else {
      if (!acc.Standard) acc.Standard = []; acc.Standard.push({ ...size, displayName: size.name }); 
    }
    return acc;
  }, {});

  // ==========================================
  //                RENDER VIEWS
  // ==========================================

  // --- ADD THIS BLOCK ---
  // SHOW THIS WHILE WAITING FOR THE SERVER TO VALIDATE THE QR CODE
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mb-6 shadow-lg shadow-accent/20"></div>
        <h2 className="text-white font-black tracking-[0.2em] uppercase text-lg mb-2">Kasa Lokal</h2>
        <p className="text-accent text-xs font-bold tracking-widest uppercase animate-pulse">Securing Table Session...</p>
      </div>
    );
  }
  // --- END NEW BLOCK ---

  if (!isAuthorized) {
      return (
        <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-4 text-center">
        <div className="bg-surface p-8 rounded-xl border border-red-900/50 shadow-2xl max-w-sm w-full animate-fade-in">
          <h1 className="text-2xl font-black text-white uppercase tracking-widest mb-2">Link Expired</h1>
          <p className="text-gray-400 text-sm">This ordering session is closed. Please ask the staff to generate a new QR code for your table.</p>
        </div>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="min-h-screen bg-dark flex flex-col items-center justify-center p-6">
        <div className="bg-surface p-8 rounded-xl border border-gray-800 shadow-2xl text-center max-w-sm w-full animate-fade-in">
          <h2 className="text-3xl font-black text-accent mb-4 uppercase tracking-widest">Thank You!</h2>
          <p className="text-gray-300 font-medium mb-8">We hope you enjoy your order.</p>
          <div className="border-t border-gray-800 pt-6 mt-2">
            <p className="text-gray-500 text-xs uppercase font-bold tracking-widest">You may now close this page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (lockedOrder || flowState === 'status') {
    return (
      <div className={`min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center transition-colors duration-500 ${
        lockedOrder?.status === 'Ready' || lockedOrder?.status === 'Completed' ? 'bg-green-600' : 'bg-dark'
      }`}>
        <div className="bg-surface p-8 rounded-3xl border border-gray-800 shadow-2xl max-w-sm w-full relative overflow-hidden animate-fade-in">
          {(lockedOrder?.status === 'Pending' || lockedOrder?.status === 'Preparing') && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-4 border-accent/20 rounded-full animate-ping pointer-events-none"></div>
          )}

          <div className="relative z-10">
            {lockedOrder?.status === 'Pending' && (
              <>
                <div className="text-6xl mb-6 animate-pulse">📡</div>
                <h1 className="text-2xl font-black text-white mb-2 uppercase tracking-widest">Sending to Kitchen...</h1>
                <p className="text-gray-400 text-sm">Please proceed to the cashier to confirm your payment of <span className="text-accent font-bold">P{lockedOrder.total.toFixed(2)}</span>.</p>
              </>
            )}

            {lockedOrder?.status === 'Preparing' && (
              <>
                <div className="text-6xl mb-6 animate-spin-slow inline-block">🍳</div>
                <h1 className="text-2xl font-black text-accent mb-2 uppercase tracking-widest">Now Preparing</h1>
                <p className="text-gray-400 text-sm">Our team is crafting your order. Hang tight!</p>
              </>
            )}

            {(lockedOrder?.status === 'Ready' || lockedOrder?.status === 'Completed') && (
              <>
                <div className="text-7xl mb-6 animate-bounce">✨</div>
                <h1 className="text-3xl font-black text-white mb-2 uppercase tracking-widest drop-shadow-md">Order is Ready!</h1>
                <p className="text-green-100 font-bold mb-8">Please proceed to the counter to collect your items.</p>
                <button 
                  onClick={handleReceived} 
                  className="w-full bg-dark text-white font-black py-4 rounded-xl hover:bg-black transition shadow-xl active:scale-95 uppercase tracking-widest"
                >
                  I Got My Order
                </button>
              </>
            )}

            <div className="mt-8 pt-6 border-t border-gray-800 flex justify-between items-center">
               <span className="text-gray-500 font-bold text-xs uppercase tracking-widest">Order ID</span>
               <span className="bg-dark px-3 py-1 rounded text-accent font-mono font-bold text-sm border border-gray-700">{lockedOrder?.orderNumber}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (flowState === 'landing') {
    return (
      <div className="min-h-[100dvh] bg-dark flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-accent/10 to-transparent pointer-events-none"></div>
        <div className="z-10 text-center w-full max-w-sm">
          <div className="w-24 h-24 bg-accent rounded-full mx-auto mb-6 shadow-[0_0_30px_rgba(255,193,7,0.3)] flex items-center justify-center">
             <span className="text-4xl">☕</span>
          </div>
          <h1 className="text-4xl font-black text-white tracking-tight mb-2">INFU COFFEE</h1>
          <p className="text-gray-400 font-bold uppercase tracking-widest text-sm mb-12">Table {tableNum}</p>
          
          <button 
            onClick={() => setFlowState('name_input')}
            className="w-full bg-accent text-dark font-black py-4 rounded-xl text-lg hover:bg-yellow-500 transition shadow-xl shadow-accent/20 active:scale-95 uppercase tracking-widest"
          >
            Start Order
          </button>
        </div>
      </div>
    );
  }

  if (flowState === 'name_input') {
    return (
      <div className="min-h-[100dvh] bg-dark flex flex-col items-center justify-center p-6 animate-fade-in">
        <div className="w-full max-w-sm bg-surface p-8 rounded-2xl border border-gray-800 shadow-2xl">
          <h2 className="text-2xl font-black text-white mb-2">Who is ordering?</h2>
          <p className="text-gray-400 text-sm mb-6">We'll use this to call your order when it's ready.</p>
          
          <input 
            type="text" 
            placeholder="Enter your nickname"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="w-full bg-dark border-2 border-gray-700 focus:border-accent text-center text-white py-4 rounded-xl outline-none mb-6 font-bold text-lg transition"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customerName.trim().length > 0) setFlowState('menu');
            }}
          />
          
          <button 
            onClick={() => setFlowState('menu')}
            disabled={customerName.trim().length === 0}
            className={`w-full font-black py-4 rounded-xl text-lg transition shadow-xl uppercase tracking-widest ${customerName.trim().length === 0 ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-accent text-dark hover:bg-yellow-500 shadow-accent/20 active:scale-95'}`}
          >
            View Menu
          </button>
        </div>
      </div>
    );
  }

  // --- 7. ORIGINAL MENU DESIGN RESTORED ---
  return (
    <div className="min-h-screen bg-dark text-white pb-48 animate-fade-in">
      
      {successMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-8 rounded-xl text-center shadow-[0_0_40px_rgba(234,179,8,0.2)] border border-accent max-w-sm w-full">
            <h2 className="text-3xl font-black text-accent mb-2 uppercase tracking-widest">Received!</h2>
            <p className="text-gray-300 font-medium">Your order has been sent to the kitchen.</p>
          </div>
        </div>
      )}

      {/* ORIGINAL HEADER PRESERVED */}
      <header className="bg-surface pt-6 px-4 pb-4 sticky top-0 z-30 border-b border-gray-800 text-center shadow-lg">
        <h1 className="text-2xl font-black tracking-widest text-accent uppercase mb-4">Digital Menu</h1>
        <div className="flex gap-3 overflow-x-auto scrollbar-none pb-2 max-w-5xl mx-auto">
          {allCategories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-5 py-2 rounded-full whitespace-nowrap text-sm font-bold transition ${activeCategory === cat ? 'bg-accent text-dark shadow-md shadow-accent/20' : 'bg-dark border border-gray-700 text-gray-400 hover:text-white'}`}>{cat}</button>
          ))}
        </div>
      </header>

      {/* ORIGINAL MAIN GRID PRESERVED */}
      <main className="p-4 max-w-5xl mx-auto space-y-10 mt-6">
        {displayedCategories.length === 0 ? (
          <p className="text-center text-gray-500 mt-10">No items available.</p>
        ) : (
          displayedCategories.map(category => {
            const categoryProducts = products.filter(p => p.category === category);
            if (categoryProducts.length === 0) return null; 
            return (
              <div key={category}>
                <h2 className="text-2xl font-bold mb-4 text-white border-b-2 border-gray-800 pb-2 inline-block">{category}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {categoryProducts.map(p => (
                    <div key={p._id} onClick={() => handleProductClick(p)} className="bg-surface rounded-xl flex flex-col transition hover:shadow-2xl hover:shadow-accent/10 cursor-pointer border border-gray-800 hover:border-accent/50 group relative h-full">
                      <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition duration-300 pointer-events-none z-0 rounded-xl"></div>
                      {p.image ? (
                        <div className="w-full h-40 relative z-20 shrink-0 flex items-center justify-center p-2 mt-2">
                          <img src={p.image} alt={p.name} className="w-full h-full object-contain transition-all duration-500 group-hover:scale-[1.15] group-hover:-translate-y-3 drop-shadow-2xl" />
                        </div>
                      ) : (
                        <div className="w-full h-40 relative z-10 shrink-0 flex items-center justify-center text-gray-600 text-xs font-bold uppercase tracking-widest mt-2">No Image</div>
                      )}
                      <div className="p-5 flex flex-col flex-1 relative z-10">
                        <h3 className="font-bold text-lg mb-1 text-white leading-tight">{p.name}</h3>
                        {p.description && <p className="text-gray-400 text-xs leading-relaxed line-clamp-2 mb-3">{p.description}</p>}
                        <div className="flex justify-between items-center mt-auto pt-4 border-t border-gray-800/50">
                          <p className="text-accent font-bold text-xl">P{(p.basePrice || 0).toFixed(2)}{p.sizes?.length > 0 && <span className="text-sm font-normal text-gray-500 ml-1">+</span>}</p>
                          <span className="bg-dark text-white px-4 py-2 rounded-md text-xs font-bold border border-gray-700 group-hover:border-accent group-hover:text-accent transition shadow-sm uppercase tracking-wider">{p.sizes?.length > 0 ? 'Select' : 'Add'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </main>

      {/* ORIGINAL SIZE MODAL PRESERVED */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-surface rounded-xl p-6 w-full max-w-md border border-gray-700 shadow-2xl">
            <h3 className="text-2xl font-bold mb-1 text-white">{selectedProduct.name}</h3>
            {selectedProduct.description && <p className="text-gray-400 text-sm mb-6 line-clamp-2">{selectedProduct.description}</p>}
            <p className="text-gray-300 text-sm font-semibold mb-3 uppercase tracking-wider">Choose a size:</p>
            <div className="space-y-6 mb-8 max-h-[50vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {groupedSizes.Hot && (
                <div>
                  <h4 className="text-red-400 font-bold text-sm uppercase tracking-wider mb-2 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400"></span> Hot Options</h4>
                  <div className="space-y-2">
                    {groupedSizes.Hot.map((size, idx) => (
                      <label key={`hot-${idx}`} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${selectedSize?.name === size.name ? 'border-accent bg-accent/10' : 'border-gray-700 hover:border-gray-500 bg-dark'}`}>
                        <div className="flex items-center gap-3"><input type="radio" name="size" className="accent-accent w-4 h-4" checked={selectedSize?.name === size.name} onChange={() => setSelectedSize(size)} /><span className="font-bold text-white capitalize">{size.displayName}</span></div>
                        <span className="text-accent font-bold">P{size.price.toFixed(2)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {groupedSizes.Iced && (
                <div>
                  <h4 className="text-blue-400 font-bold text-sm uppercase tracking-wider mb-2 mt-4 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400"></span> Iced Options</h4>
                  <div className="space-y-2">
                    {groupedSizes.Iced.map((size, idx) => (
                      <label key={`iced-${idx}`} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${selectedSize?.name === size.name ? 'border-accent bg-accent/10' : 'border-gray-700 hover:border-gray-500 bg-dark'}`}>
                        <div className="flex items-center gap-3"><input type="radio" name="size" className="accent-accent w-4 h-4" checked={selectedSize?.name === size.name} onChange={() => setSelectedSize(size)} /><span className="font-bold text-white capitalize">{size.displayName}</span></div>
                        <span className="text-accent font-bold">P{size.price.toFixed(2)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {groupedSizes.Standard && (
                <div>
                  {Object.keys(groupedSizes).length > 1 && <h4 className="text-gray-400 font-bold text-sm uppercase tracking-wider mb-2 mt-4">Other Options</h4>}
                  <div className="space-y-2">
                    {groupedSizes.Standard.map((size, idx) => (
                      <label key={`std-${idx}`} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${selectedSize?.name === size.name ? 'border-accent bg-accent/10' : 'border-gray-700 hover:border-gray-500 bg-dark'}`}>
                        <div className="flex items-center gap-3"><input type="radio" name="size" className="accent-accent w-4 h-4" checked={selectedSize?.name === size.name} onChange={() => setSelectedSize(size)} /><span className="font-bold text-white">{size.displayName}</span></div>
                        <span className="text-accent font-bold">P{size.price.toFixed(2)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setSelectedProduct(null)} className="flex-1 bg-dark text-white border border-gray-700 py-3 rounded-md font-semibold hover:bg-gray-800 transition">Cancel</button>
              <button onClick={() => addToCart(selectedProduct, selectedSize)} className="flex-1 bg-accent text-dark py-3 rounded-md font-bold hover:bg-yellow-500 transition shadow-lg shadow-accent/20">Add to Cart</button>
            </div>
          </div>
        </div>
      )}

      {/* ORIGINAL CART BOTTOM SHEET (Name Input Removed) */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-gray-800 p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.8)] z-40">
          <div className="max-w-4xl mx-auto">
            <div className="mb-4 max-h-40 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
              {cart.map(item => (
                <div key={item.cartItemId} className="flex justify-between items-center py-3 border-b border-gray-800/50">
                  <div className="flex-1"><span className="text-sm font-bold text-white block">{item.name}</span><span className="text-xs text-accent font-semibold">P{item.price.toFixed(2)}</span></div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => updateQuantity(item.cartItemId, -1)} className="w-8 h-8 rounded bg-dark border border-gray-700 text-white font-bold hover:bg-gray-800 flex items-center justify-center">-</button>
                    <span className="text-sm w-4 text-center font-bold">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.cartItemId, 1)} className="w-8 h-8 rounded bg-dark border border-gray-700 text-white font-bold hover:bg-gray-800 flex items-center justify-center">+</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-t border-gray-700 pt-4 mt-2">
              <div className="flex justify-between w-full md:w-auto md:flex-1 font-bold text-xl"><span className="text-gray-300">Total:</span><span className="text-accent text-2xl">P{total.toFixed(2)}</span></div>
              <button type="button" onClick={confirmOrder} className="w-full md:w-auto bg-accent text-dark px-10 py-4 rounded-md font-black text-lg hover:bg-yellow-500 transition shadow-lg shadow-accent/20 uppercase tracking-wide">Send to Kitchen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
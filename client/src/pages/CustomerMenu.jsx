import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

// Pointing to your Local Backend so it syncs perfectly with your Admin screen
//const API_URL = 'http://192.168.100.2:5002'; 
const API_URL = 'https://local-based-menu.onrender.com';
const socket = io(API_URL, {
  transports: ['websocket'], 
  upgrade: false             
});

// --- CUSTOMER NOTIFICATION SOUND ---
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
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');
  
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);

  // --- SECURITY & WORKFLOW STATE ---
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [tableNum, setTableNum] = useState(null);
  const [successMessage, setSuccessMessage] = useState(false); 
  const [lockedOrder, setLockedOrder] = useState(null); 
  const SECRET_TOKEN = 'cafe2026';

  // --- NEW: VIBRATION CONTROLS ---
  const [isVibrating, setIsVibrating] = useState(false);
  const vibrationInterval = useRef(null);
  const [isFinished, setIsFinished] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const wakeLockRef = useRef(null);

  const requestWakeLock = async () =>{
    try{
      if ('wakelock' in navigator){
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('Screen Wake Lock active');

        wakeLockRef.current.addEventListener('release', () => {
          console.log('Screnn Wake Lock released');
        });
      }
    } catch (err){
      console.log('Wake Lock error:', err);
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current !== null) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  };
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const table = params.get('table');
    const finalTable = table || 'Takeout';

    if (token === SECRET_TOKEN) {
      setIsAuthorized(true);
      setTableNum(finalTable);
    }

    const checkSavedSession = async () => {
      const savedOrderId = localStorage.getItem('semivra_active_order');
      const savedOrderTime = localStorage.getItem('semivra_order_time');

      if (savedOrderId) {
        const isExpired = savedOrderTime && (Date.now() - parseInt(savedOrderTime) > 600000);
        
        if (isExpired) {
          localStorage.removeItem('semivra_active_order');
          localStorage.removeItem('semivra_order_time');
          setIsCheckingSession(false); // Stop loading
          return;
        }

        try {
          const res = await fetch(`${API_URL}/api/orders/${savedOrderId}`);
          if (res.ok) {
            const orderData = await res.json();
            if (orderData.status !== 'Cancelled' && !localStorage.getItem(`received_${savedOrderId}`)) {
              setLockedOrder(orderData);
            }
          }
        } catch (err) {
          console.error("Failed to restore session");
        }
      }
      
      setIsCheckingSession(false); // Stop loading after check is done
    };

    checkSavedSession();
    fetchProducts();
  }, []);

  useEffect(() => {
    if (!tableNum) return;

    const handleOrderUpdated = (updatedOrder) => {
      if (updatedOrder.table === tableNum) {
        // ONLY lock the menu if the admin hits "Start Prep" or "Completed"
        if (updatedOrder.status === 'Preparing' || updatedOrder.status === 'Completed') {
          // Verify they haven't already dismissed this specific order
          if (!localStorage.getItem(`received_${updatedOrder._id}`)) {
            setLockedOrder(updatedOrder);
          }
        } else if (updatedOrder.status === 'Cancelled') {
          setLockedOrder(null);
        }
      }
    };

    const handleArchive = () => {
      setLockedOrder(null);
      setCart([]);
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

  // --- STATUS CHANGE TRIGGER (Vibrate, Sound, Wake Lock, & NOTIFICATIONS) ---
  useEffect(() => {
    if (lockedOrder?.status === 'Preparing') {
      playCustomerDing();
      setIsVibrating(false);
      if (vibrationInterval.current) clearInterval(vibrationInterval.current);
      requestWakeLock();
      
    } else if (lockedOrder?.status === 'Completed') {
      playCustomerDing();
      
      // 🔔 NEW: FIRE SYSTEM NOTIFICATION (For when app is minimized)
      if ('Notification' in window && Notification.permission === 'granted') {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(function(registration) {
            registration.showNotification('Your Order is Ready! ☕', {
              body: 'Please collect your order at the counter.',
              icon: '/logo.png',
              vibrate: [1000, 500, 1000, 500, 2000], // Strong vibration pattern
              tag: 'order-ready',
              requireInteraction: true // Forces the notification to stay on screen until dismissed
            });
          });
        }
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

  // --- NEW: HANDLE RECEIVED BUTTON ---
  const handleReceived = () => {
    setIsVibrating(false);
    if (vibrationInterval.current) clearInterval(vibrationInterval.current);
    releaseWakeLock(); 
    
    if (lockedOrder) {
      localStorage.setItem(`received_${lockedOrder._id}`, 'true');
    }
    
    // Clear device memory
    localStorage.removeItem('semivra_active_order');
    localStorage.removeItem('semivra_order_time');

    // --- NEW: Trigger the Thank You screen instead of the menu ---
    setIsFinished(true); 
    setLockedOrder(null);
    setCart([]);
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_URL}/api/products`);
      const data = await res.json();
      if (data.success) setProducts(data.products);
    } catch (err) { console.error("Failed to fetch menu"); }
  };

  const fetchTableActiveOrder = async (targetTable) => {
    try {
      const res = await fetch(`${API_URL}/api/orders`);
      const data = await res.json();
      if (data.success && data.orders) {
        // If they scan the QR, check if their food is already being made
        const active = data.orders.find(o => o.table === targetTable && (o.status === 'Preparing' || o.status === 'Completed'));
        if (active && !localStorage.getItem(`received_${active._id}`)) {
          setLockedOrder(active);
        }
      }
    } catch (e) { console.error("Failed to fetch active orders"); }
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

    setCart(prev => {
      const existing = prev.find(item => item.cartItemId === cartItemId);
      if (existing) return prev.map(item => item.cartItemId === cartItemId ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { cartItemId, productId: product._id, name: size ? `${product.name} (${sizeName})` : product.name, price, quantity: 1 }];
    });
    setSelectedProduct(null); setSelectedSize(null);
  };

  const updateQuantity = (cartItemId, delta) => {
    setCart(prev => prev.map(item => item.cartItemId === cartItemId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter(item => item.quantity > 0));
  };

  const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const requestNotificationPermission = async () => {
    console.log("--- NOTIFICATION CHECK START ---");
    
    if (!('Notification' in window)) {
      console.log("❌ This browser does not support notifications.");
      return;
    }

    console.log("Current permission status:", Notification.permission);
    
    if (Notification.permission === 'granted') {
      console.log("✅ Permission already granted.");
      return true;
    }

    if (Notification.permission === 'denied') {
      console.log("🚫 Permission was previously blocked by the user.");
      return false;
    }

    try {
      console.log("🔔 Requesting permission from user...");
      const permission = await Notification.requestPermission();
      console.log("User answered:", permission);

      if (permission === 'granted') {
        if ('serviceWorker' in navigator) {
          try {
            await navigator.serviceWorker.register('/sw.js');
            console.log('✅ Service Worker Registered for Push Notifications!');
          } catch (e) {
            console.error('❌ Service Worker Registration Failed:', e);
          }
        }
        return true;
      }
    } catch (error) {
      console.error("❌ Error requesting notification permission:", error);
    }
    return false;
  };

const confirmOrder = async () => {
    if (!customerName.trim()) {
      return alert("Please enter an Order Name (Nickname) so we know who to call!");
    }
    
    try {
      const res = await fetch(`${API_URL}/api/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart, discount: 0, isVatExempt: true, table: tableNum, customerName: customerName.trim() })
      });
      const data = await res.json();
      
      if (data.success) {
        setCart([]);
        
        // --- NEW: LOCK MENU IMMEDIATELY & SAVE TO DEVICE ---
        localStorage.setItem('semivra_active_order', data.order._id);
        localStorage.setItem('semivra_order_time', Date.now().toString());
        setLockedOrder(data.order); // Lock UI instantly
        // ---------------------------------------------------

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

  // --- NEW: WAITING SCREEN WHILE CHECKING LOCALSTORAGE ---
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // --- ACCESS DENIED SCREEN ---
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-dark flex flex-col items-center justify-center p-6">
        <div className="bg-surface p-8 rounded-xl border border-red-900/50 shadow-2xl text-center max-w-sm w-full">
          <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-widest">Access Denied</h2>
          <p className="text-gray-400 mb-6">Please scan the QR code located on your table to access the digital menu.</p>
        </div>
      </div>
    );
  }

  // --- NEW: LINK EXPIRED / READY SCREEN ---
  if (lockedOrder) {
    return (
      <div className="min-h-screen bg-dark flex flex-col items-center justify-center p-6">
        <div className="bg-surface p-8 rounded-xl border border-gray-800 shadow-2xl text-center max-w-sm w-full animate-fade-in">
          
          {lockedOrder.status === 'Completed' ? (
            <h2 className="text-3xl font-black text-green-400 mb-2 uppercase tracking-widest animate-pulse">Order Ready!</h2>
          ) : (
            <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-widest">Order Received</h2>
          )}

          <p className="text-gray-400 mb-6 text-sm">
            {lockedOrder.status === 'Completed' 
              ? "Your food is ready! Please collect your order or wait for your server." 
              : "This menu session is locked while your order is being prepared."}
          </p>
          
          <div className="bg-dark p-6 rounded-lg border border-gray-700 mb-6 relative overflow-hidden">
            {lockedOrder.status === 'Preparing' && <div className="absolute top-0 left-0 w-full h-1 bg-accent animate-pulse"></div>}
            {lockedOrder.status === 'Completed' && <div className="absolute top-0 left-0 w-full h-1 bg-green-500"></div>}
            
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Status</p>
            <p className={`text-2xl font-black uppercase ${lockedOrder.status === 'Completed' ? 'text-green-400' : 'text-accent'}`}>
              {lockedOrder.status}
            </p>
          </div>

          {/* NEW: RECEIVED BUTTON */}
          {lockedOrder.status === 'Completed' ? (
            <button onClick={handleReceived} className="w-full bg-green-500 text-dark font-black py-4 rounded-lg hover:bg-green-400 transition shadow-lg shadow-green-500/20 uppercase tracking-widest">
              I Received My Order
            </button>
          ) : (
            <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Thank you for dining with us!</p>
          )}

        </div>
      </div>
    );
  }
  // --- NEW: FINAL THANK YOU SCREEN ---
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

  return (
    <div className="min-h-screen bg-dark text-white pb-48">
      
      {/* 5-SECOND SUCCESS POPUP */}
      {successMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-surface p-8 rounded-xl text-center shadow-[0_0_40px_rgba(234,179,8,0.2)] border border-accent max-w-sm w-full">
            <h2 className="text-3xl font-black text-accent mb-2 uppercase tracking-widest">Received!</h2>
            <p className="text-gray-300 font-medium">Your order has been sent to the kitchen.</p>
          </div>
        </div>
      )}

      <header className="bg-surface pt-6 px-4 pb-4 sticky top-0 z-30 border-b border-gray-800 text-center shadow-lg">
        <h1 className="text-2xl font-black tracking-widest text-accent uppercase mb-4">Digital Menu</h1>
        <div className="flex gap-3 overflow-x-auto scrollbar-none pb-2 max-w-5xl mx-auto">
          {allCategories.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-5 py-2 rounded-full whitespace-nowrap text-sm font-bold transition ${activeCategory === cat ? 'bg-accent text-dark shadow-md shadow-accent/20' : 'bg-dark border border-gray-700 text-gray-400 hover:text-white'}`}>{cat}</button>
          ))}
        </div>
      </header>

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
            {/* --- CUSTOMER NAME INPUT --- */}
            <div className="mb-4">
              <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">
                Order Name (Nickname) <span className="text-red-500 text-sm">*</span>
              </label>
              <input 
                type="text" 
                placeholder="e.g. SB, John" 
                value={customerName} 
                onChange={(e) => setCustomerName(e.target.value)} 
                className="w-full bg-dark border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-accent font-bold"
                maxLength="15"
              />
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-t border-gray-700 pt-4 mt-2">
              <div className="flex justify-between w-full md:w-auto md:flex-1 font-bold text-xl"><span className="text-gray-300">Total:</span><span className="text-accent text-2xl">P{total.toFixed(2)}</span></div>
              <button onClick={confirmOrder} className="w-full md:w-auto bg-accent text-dark px-10 py-4 rounded-md font-black text-lg hover:bg-yellow-500 transition shadow-lg shadow-accent/20 uppercase tracking-wide">Send to Kitchen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
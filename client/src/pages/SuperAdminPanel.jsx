import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.100.2:5002';

export default function SuperAdminPanel() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [newUserForm, setNewUserForm] = useState({ name: '', password: '', role: 'Staff' });
  const [newRole, setNewRole] = useState('');
  const [loginForm, setLoginForm] = useState({ name: '', password: '' });
  
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('semivra_token'));
  const navigate = useNavigate();

  const apiFetch = async (endpoint, options = {}) => {
    if (!options.headers) options.headers = {};
    const token = localStorage.getItem('semivra_token');
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    
    if (options.body && typeof options.body === 'string' && !options.headers['Content-Type']) {
      options.headers['Content-Type'] = 'application/json';
    }
    
    const cleanEndpoint = endpoint.replace(API_URL, '');
    const response = await fetch(`${API_URL}${cleanEndpoint}`, options);
    
    if (response.status === 401 || response.status === 403) {
      if (cleanEndpoint !== '/api/users/login') { 
        handleLogout();
      }
    }
    return response;
  };

  const handleSystemLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/users/login', {
        method: 'POST', 
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      
      if (data.success) {
        if (data.user.name !== 'Super Admin') {
           alert("Access Denied: This panel is restricted to the Super Admin.");
           return;
        }
        localStorage.setItem('semivra_token', data.token);
        setIsAuthenticated(true);
      } else {
        alert("Access Denied: Invalid name or password.");
      }
    } catch (err) { console.error("Login failed", err); }
  };

  const handleLogout = () => {
    localStorage.removeItem('semivra_token');
    setIsAuthenticated(false);
    setLoginForm({name: '', password: ''});
    setUsers([]);
  };

  const fetchUsers = async () => {
    try {
      const res = await apiFetch('/api/users');
      if (res.ok) setUsers((await res.json()).users || []);
    } catch (err) { console.error("Failed to fetch users", err); }
  };

  const fetchRoles = async () => {
    try {
      const res = await apiFetch('/api/roles');
      if (res.ok) setRoles((await res.json()).roles || []);
    } catch (err) { console.error("Failed to fetch roles", err); }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchUsers();
      fetchRoles();
    }
  }, [isAuthenticated]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUserForm.name || !newUserForm.password) return alert("Name and password required.");

    try {
      const res = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(newUserForm) });
      const data = await res.json();
      
      if (data.success) {
        alert("User created successfully!");
        setNewUserForm({ name: '', password: '', role: 'Staff' });
        fetchUsers();
      } else {
        alert(`Failed to create user: ${data.error}`);
      }
    } catch (err) { console.error("Failed to add user", err); }
  };

  const handleDeleteUser = async (id, name) => {
    if (name === 'Super Admin') return alert("You cannot delete the master account.");
    if (!window.confirm(`Are you sure you want to permanently delete user: ${name}?`)) return;
    try {
      const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
      if (res.ok) fetchUsers();
    } catch (err) { console.error("Delete failed", err); }
  };

  // --- NEW: ROLE CRUD HANDLERS ---
  const handleAddRole = async (e) => {
    e.preventDefault();
    if(!newRole.trim()) return;
    try {
      await apiFetch('/api/roles', { method: 'POST', body: JSON.stringify({ name: newRole.trim() }) });
      setNewRole('');
      fetchRoles();
    } catch (err) { console.error(err); }
  };

  const handleDeleteRole = async (id) => {
    if(!window.confirm("Delete this custom role?")) return;
    try {
      await apiFetch(`/api/roles/${id}`, { method: 'DELETE' });
      fetchRoles();
    } catch (err) { console.error(err); }
  };

  // --- LOGIN UI ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-light flex flex-col items-center justify-center p-4">
        <form onSubmit={handleSystemLogin} className="bg-surface p-8 rounded-xl border border-surface-800 shadow-2xl max-w-sm w-full text-center">
          <h2 className="text-2xl font-black text-white tracking-widest mb-2 uppercase">System Config</h2>
          <p className="text-gray-400 text-sm mb-6">Enter master credentials.</p>
          <input type="text" placeholder="Admin Name" value={loginForm.name} onChange={(e) => setLoginForm({...loginForm, name: e.target.value})} className="w-full bg-surface border-2 border-gray-700 focus:border-accent text-center text-white py-3 rounded-lg outline-none mb-3 font-bold" required autoFocus />
          <input type="password" placeholder="Password" value={loginForm.password} onChange={(e) => setLoginForm({...loginForm, password: e.target.value})} className="w-full bg-surface border-2 border-gray-700 focus:border-accent text-center text-white py-3 rounded-lg outline-none mb-6 font-bold tracking-widest" required />
          <button type="submit" className="w-full bg-accent text-dark font-black py-4 rounded-lg hover:bg-yellow-500 transition shadow-lg shadow-accent/20 uppercase tracking-widest mb-4">AUTHENTICATE</button>
          <button type="button" onClick={() => navigate('/admin')} className="text-gray-500 text-xs hover:text-white uppercase tracking-widest transition font-bold">Return to POS</button>
        </form>
      </div>
    );
  }

  // --- DASHBOARD UI ---
  return (
    <div className="min-h-screen bg-dark text-white p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        
        {/* HEADER */}
        <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-4">
           <div>
             <h1 className="text-3xl font-black text-accent tracking-tight leading-none mb-1">SYSTEM CONFIG</h1>
             <p className="text-[11px] text-gray-500 font-bold uppercase tracking-[0.2em]">Super Admin Control Panel</p>
           </div>
           <div className="flex gap-4">
              <button onClick={() => navigate('/admin')} className="border border-gray-700 text-black px-4 py-2 rounded font-bold hover:bg-black hover:text-white transition uppercase text-xs tracking-wider">POS Dashboard</button>
              <button onClick={handleLogout} className="bg-red-900/30 text-red-500 border border-red-900 px-4 py-2 rounded font-bold hover:bg-red-600 hover:text-white transition uppercase text-xs tracking-wider">Lock Panel</button>
           </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           
           {/* LEFT COLUMN: FORMS */}
           <div className="lg:col-span-1 flex flex-col gap-6">
             
             {/* REGISTER USER */}
             <div className="bg-surface border border-gray-800 rounded-xl p-6 shadow-lg">
               <h3 className="text-xl font-bold mb-4 text-accent border-b border-gray-800 pb-2">Register User</h3>
               <form onSubmit={handleAddUser} className="space-y-4">
                 <div>
                   <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Employee Name</label>
                   <input type="text" value={newUserForm.name} onChange={e => setNewUserForm({...newUserForm, name: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-sm text-black outline-none focus:border-accent" required />
                 </div>
                 <div>
                   <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Account PIN / Password</label>
                   <input type="password" value={newUserForm.password} onChange={e => setNewUserForm({...newUserForm, password: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-sm text-black outline-none focus:border-accent" required />
                 </div>
                 <div>
                   <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Access Level</label>
                   <select value={newUserForm.role} onChange={e => setNewUserForm({...newUserForm, role: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-sm text-black outline-none focus:border-accent font-bold">
                     <option value="Staff">Staff (Standard)</option>
                     <option value="Admin">Admin (Manager)</option>
                     {roles.map(r => <option key={r._id} value={r.name}>{r.name}</option>)}
                   </select>
                 </div>
                 <button type="submit" className="w-full bg-accent text-dark font-black py-3 mt-2 rounded hover:bg-white shadow-lg hover:text-accent shadow-accent/20 transition uppercase tracking-wider text-xs">
                   Create User
                 </button>
               </form>
             </div>

             {/* CUSTOM ROLE MANAGER */}
             <div className="bg-surface border border-gray-800 rounded-xl p-6 shadow-lg">
                <h3 className="text-xl font-bold mb-4 text-white border-b border-gray-800 pb-2">Custom Roles</h3>
                <form onSubmit={handleAddRole} className="flex gap-2 mb-4">
                  <input type="text" placeholder="e.g. Kitchen, Barista" value={newRole} onChange={e => setNewRole(e.target.value)} className="flex-1 bg-dark border border-gray-700 rounded p-2 text-sm text-black outline-none focus:border-accent" required />
                  <button type="submit" className="bg-accent text-dark font-bold px-4 py-2 rounded text-xs hover:bg-white transition uppercase tracking-wider">Add</button>
                </form>
                <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                  {roles.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No custom roles created.</p>
                  ) : roles.map(r => (
                     <div key={r._id} className="flex justify-between items-center bg-dark px-3 py-2 rounded border border-gray-700">
                       <span className="text-sm font-bold text-black">{r.name}</span>
                       <button onClick={() => handleDeleteRole(r._id)} className="text-red-500 hover:text-red-400 font-bold text-xs uppercase tracking-wider">Del</button>
                     </div>
                  ))}
                </div>
              </div>

           </div>

           {/* RIGHT COLUMN: USER LIST */}
           <div className="lg:col-span-2 bg-surface border border-gray-800 rounded-xl p-6 shadow-lg flex flex-col h-[700px]">
             <h3 className="text-xl font-bold mb-4 text-white border-b border-gray-800 pb-2">Active Personnel</h3>
             
             <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-700">
               <div className="space-y-3">
                 {users.map(user => (
                   <div key={user._id} className="bg-dark p-4 rounded-lg border border-gray-700 flex justify-between items-center transition hover:border-gray-500">
                     <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded flex items-center justify-center font-black text-lg ${user.role === 'Admin' || user.role === 'admin' ? 'bg-accent/20 text-accent' : 'bg-gray-800 text-gray-400'}`}>
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-black text-md">{user.name}</p>
                          <div className="flex gap-2 items-center mt-1">
                             <span className="text-[10px] bg-black text-gray-400 px-2 py-0.5 rounded font-mono border border-gray-800">{user.userCode}</span>
                             <span className={`text-[9px] uppercase tracking-widest font-black ${user.role === 'Admin' || user.role === 'admin' ? 'text-accent' : 'text-gray-500'}`}>{user.role}</span>
                          </div>
                        </div>
                     </div>
                     
                     {user.name !== 'Super Admin' && (
                       <button onClick={() => handleDeleteUser(user._id, user.name)} className="text-red-500 hover:text-white font-bold px-3 py-1.5 bg-red-900/20 hover:bg-red-600 rounded transition text-xs uppercase tracking-wider">
                         Revoke
                       </button>
                     )}
                   </div>
                 ))}
               </div>
             </div>
           </div>

        </div>
      </div>
    </div>
  );
}
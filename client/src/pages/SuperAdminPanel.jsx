import React, { useState, useEffect } from 'react';

//const API_URL = 'http://192.168.100.2:5002'; // Use your local or render URL
const API_URL = 'https://local-based-menu.onrender.com';
export default function SuperAdminPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ name: '', password: '' });
  
  const [users, setUsers] = useState([]);
  const [formData, setFormData] = useState({ name: '', password: '' });
  const [editingId, setEditingId] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/users/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(true);
        fetchUsers();
      } else {
        alert("Invalid credentials.");
      }
    } catch (err) { console.error("Login failed"); }
  };

  const fetchUsers = async () => {
    const res = await fetch(`${API_URL}/api/users`);
    const data = await res.json();
    if (data.success) setUsers(data.users);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.password) return;

    const method = editingId ? 'PUT' : 'POST';
    const url = editingId ? `${API_URL}/api/users/${editingId}` : `${API_URL}/api/users`;

    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const data = await res.json();
    
    if (data.success) {
      setFormData({ name: '', password: '' });
      setEditingId(null);
      fetchUsers();
    } else {
      alert(data.error);
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm("Are you sure you want to delete this admin?")) return;
    await fetch(`${API_URL}/api/users/${id}`, { method: 'DELETE' });
    fetchUsers();
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center p-6">
        <form onSubmit={handleLogin} className="bg-surface p-8 rounded-xl border border-red-900/30 shadow-2xl w-full max-w-sm">
          <h2 className="text-2xl font-black text-red-500 mb-6 uppercase tracking-widest text-center">System Override</h2>
          <input type="text" placeholder="Admin Name" value={loginForm.name} onChange={e => setLoginForm({...loginForm, name: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-3 text-white mb-4 outline-none focus:border-red-500" required />
          <input type="password" placeholder="Password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-3 text-white mb-6 outline-none focus:border-red-500" required />
          <button type="submit" className="w-full bg-red-600 text-white font-black py-3 rounded hover:bg-red-500 transition shadow-lg shadow-red-500/20 uppercase tracking-widest">Authenticate</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8 border-b border-gray-800 pb-4">
          <h1 className="text-3xl font-black text-accent uppercase tracking-widest">Admin Control Panel</h1>
          <button onClick={() => setIsAuthenticated(false)} className="text-red-400 font-bold hover:text-red-300 transition">Logout</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Form */}
          <div className="col-span-1 bg-surface border border-gray-800 rounded-xl p-6 h-fit">
            <h3 className="text-lg font-bold mb-4">{editingId ? 'Edit Admin' : 'Add New Admin'}</h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 uppercase font-bold block mb-1">Name</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent" required />
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase font-bold block mb-1">
                  {editingId ? 'New Password (Leave blank to keep current)' : 'Password'}
                </label>
                <input 
                  type="text" 
                  value={formData.password} 
                  onChange={e => setFormData({...formData, password: e.target.value})} 
                  className="w-full bg-dark border border-gray-700 rounded p-2 text-white outline-none focus:border-accent placeholder-gray-600" 
                  placeholder={editingId ? "********" : "Enter password"}
                  required={!editingId} // Only required if creating a NEW user
                />
              </div>
              <div className="flex gap-2 pt-2">
                {editingId && <button type="button" onClick={() => { setEditingId(null); setFormData({name:'', password:''}); }} className="flex-1 bg-dark border border-gray-700 rounded py-2 font-bold text-gray-300">Cancel</button>}
                <button type="submit" className="flex-1 bg-accent text-dark font-black py-2 rounded hover:bg-yellow-500 transition">{editingId ? 'Update' : 'Generate Admin'}</button>
              </div>
            </form>
          </div>

          {/* List */}
          <div className="col-span-1 md:col-span-2 bg-surface border border-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-bold mb-4 border-b border-gray-800 pb-2">Active Administrators</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="pb-2">Admin Code</th>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Security</th>
                    <th className="pb-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user._id} className="border-b border-gray-800/50 hover:bg-dark/50">
                      <td className="py-3 font-mono font-bold text-accent">{user.userCode}</td>
                      <td className="py-3 font-bold text-white">{user.name}</td>
                      <td className="py-3 font-mono text-green-400 text-xs tracking-widest">ENCRYPTED</td>
                      <td className="py-3 text-right space-x-2">
                        <button onClick={() => { setEditingId(user._id); setFormData({ name: user.name, password: '' }); }} className="text-blue-400 hover:text-blue-300 font-bold px-2 py-1 bg-blue-900/20 rounded">Edit</button>
                        <button onClick={() => deleteUser(user._id)} className="text-red-400 hover:text-red-300 font-bold px-2 py-1 bg-red-900/20 rounded">Del</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
);}
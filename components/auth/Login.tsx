import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';

const Login: React.FC = () => {
    const [userId, setUserId] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
    const { loginWithCredentials } = useAuth(); const { users } = useData();
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); setError('');
        const result = await loginWithCredentials(userId.trim(), password, users);
        if (!result.ok) setError(result.error || 'Invalid User ID or Password.');
    };
    return <div className="flex items-center justify-center min-h-screen bg-gray-50"><div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-lg">
      <div className="text-center"><h2 className="text-3xl font-extrabold text-gray-900">Go Canteen Login</h2><p className="mt-2 text-sm text-gray-600">Sign in to your account</p></div>
      <form className="mt-8 space-y-6" onSubmit={handleSubmit}>{error&&<div className="p-3 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
        <input required className="relative block w-full px-3 py-3 text-gray-900 border border-gray-300 rounded-md" placeholder="SR Number or admin" value={userId} onChange={e=>setUserId(e.target.value)}/>
        <input required type="password" className="relative block w-full px-3 py-3 text-gray-900 border border-gray-300 rounded-md" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>
        <button className="relative flex justify-center w-full px-4 py-3 text-sm font-medium text-white rounded-md bg-primary-600 hover:bg-primary-700">Sign in</button>
      </form></div></div>;
}; export default Login;

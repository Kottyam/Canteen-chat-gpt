import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';

const Login: React.FC = () => {
    const [userId, setUserId] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const { loginWithCredentials } = useAuth();
    const { users } = useData();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const result = await loginWithCredentials(userId.trim(), password, users);
        if (!result.ok) setError(result.error || 'Invalid User ID or Password.');
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg sm:p-8">
          <div className="text-center">
            <img src="/logo.svg" alt="Go Canteen" className="mx-auto h-auto w-[min(62vw,230px)] object-contain" />
            <h2 className="mt-3 text-2xl font-extrabold text-gray-900 sm:text-3xl">Go Canteen</h2>
            <p className="mt-1 text-sm text-gray-600">Sign in to your account</p>
          </div>
          <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
            {error && <div className="rounded-md bg-red-100 p-3 text-sm text-red-700">{error}</div>}
            <input required className="relative block min-h-12 w-full rounded-lg border border-gray-300 px-3 py-3 text-gray-900" placeholder="SR Number or admin" value={userId} onChange={e => setUserId(e.target.value)} />
            <input required type="password" className="relative block min-h-12 w-full rounded-lg border border-gray-300 px-3 py-3 text-gray-900" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            <button className="relative flex min-h-12 w-full items-center justify-center rounded-lg bg-primary-600 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-700">Sign in</button>
          </form>
        </div>
      </div>
    );
};

export default Login;

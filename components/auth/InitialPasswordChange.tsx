
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';

const InitialPasswordChange: React.FC = () => {
    const { user, updateUser } = useAuth();
    const { users, setUsers } = useData();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!user) {
            setError('An unexpected error occurred. Please try logging in again.');
            return;
        }

        if (newPassword.length < 5) {
            setError('Password must be at least 5 characters long.');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        const updatedUsers = users.map(u =>
            u.id === user.id ? { ...u, password: newPassword, isFirstLogin: false } : u
        );
        setUsers(updatedUsers);

        const updatedCurrentUser = { ...user, password: newPassword, isFirstLogin: false };
        updateUser(updatedCurrentUser);

        setSuccess('Password updated successfully! You can now access your dashboard.');
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
            <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-lg">
                <div className="text-center">
                    <h2 className="text-3xl font-extrabold text-gray-900">Create New Password</h2>
                    <p className="mt-2 text-sm text-gray-600">For security, you must change your password on first login.</p>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && <div className="p-3 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
                    {success && <div className="p-3 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}
                    <div className="space-y-4 rounded-md shadow-sm">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">New Password</label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Confirm New Password</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                required
                            />
                        </div>
                    </div>
                    <div>
                        <button
                            type="submit"
                            disabled={!!success}
                            className="relative flex justify-center w-full px-4 py-3 text-sm font-medium text-white border border-transparent rounded-md group bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:bg-gray-400"
                        >
                            Set New Password
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default InitialPasswordChange;
   

import React, { useState } from 'react';
import Modal from '../shared/Modal';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';

interface ChangePasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose }) => {
    const { user, updateUser } = useAuth();
    const { users, setUsers } = useData();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!user) {
            setError('You are not logged in.');
            return;
        }

        if (user.password !== currentPassword) {
            setError('Incorrect current password.');
            return;
        }

        if (newPassword.length < 5) {
            setError('New password must be at least 5 characters long.');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('New passwords do not match.');
            return;
        }

        const updatedUsers = users.map(u => 
            u.id === user.id ? { ...u, password: newPassword, isFirstLogin: false } : u
        );
        setUsers(updatedUsers);

        const updatedCurrentUser = { ...user, password: newPassword, isFirstLogin: false };
        updateUser(updatedCurrentUser);
        
        setSuccess('Password updated successfully!');
        setTimeout(() => {
            onClose();
            setSuccess('');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        }, 1500);
    };
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Change Password">
            <form onSubmit={handleSubmit} className="space-y-4">
                {error && <div className="p-3 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
                {success && <div className="p-3 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}
                <div>
                    <label className="block text-sm font-medium text-gray-700">Current Password</label>
                    <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                        required
                    />
                </div>
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
                <div className="flex justify-end pt-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 mr-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md shadow-sm bg-primary-600 hover:bg-primary-700">Update Password</button>
                </div>
            </form>
        </Modal>
    );
};

export default ChangePasswordModal;
   
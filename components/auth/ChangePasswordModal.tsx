import React, { useState } from 'react';
import Modal from '../shared/Modal';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { supabase, supabaseEnabled, internalEmailForLogin } from '../../supabase';
import { updateEmployee } from '../../services/supabaseSync';

interface ChangePasswordModalProps { isOpen: boolean; onClose: () => void; }

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose }) => {
    const { user, updateUser } = useAuth();
    const { users, setUsers } = useData();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); setError(''); setSuccess('');
        if (!user) { setError('You are not logged in.'); return; }
        if (newPassword.length < 5) { setError('New password must be at least 5 characters long.'); return; }
        if (newPassword !== confirmPassword) { setError('New passwords do not match.'); return; }
        setSaving(true);
        try {
            if (supabaseEnabled && supabase) {
                // The profile intentionally does not store the password, so verify the
                // current password against Supabase Auth instead of user.password.
                const { error: verifyError } = await supabase.auth.signInWithPassword({
                    email: internalEmailForLogin(user.id), password: currentPassword
                });
                if (verifyError) throw new Error('Incorrect current password.');
                const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
                if (updateError) throw updateError;
                const updatedCurrentUser = { ...user, password: newPassword, isFirstLogin: false };
                await updateEmployee(updatedCurrentUser);
                setUsers(prev => prev.map(u => u.id === user.id ? updatedCurrentUser : u));
                updateUser(updatedCurrentUser);
            } else {
                if (user.password !== currentPassword) throw new Error('Incorrect current password.');
                const updatedCurrentUser = { ...user, password: newPassword, isFirstLogin: false };
                setUsers(prev => prev.map(u => u.id === user.id ? updatedCurrentUser : u));
                updateUser(updatedCurrentUser);
            }
            setSuccess('Password updated successfully!');
            setTimeout(() => { onClose(); setSuccess(''); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }, 1200);
        } catch (err: any) { setError(err?.message || 'Could not update password. Please try again.'); }
        finally { setSaving(false); }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Change Password">
            <form onSubmit={handleSubmit} className="space-y-4">
                {error && <div className="p-3 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
                {success && <div className="p-3 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}
                <div><label className="block text-sm font-medium text-gray-700">Current Password</label><input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" required /></div>
                <div><label className="block text-sm font-medium text-gray-700">New Password</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" required /></div>
                <div><label className="block text-sm font-medium text-gray-700">Confirm New Password</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" required /></div>
                <div className="flex justify-end pt-4"><button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 mr-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button><button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md shadow-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-60">{saving ? 'Updating...' : 'Update Password'}</button></div>
            </form>
        </Modal>
    );
};
export default ChangePasswordModal;

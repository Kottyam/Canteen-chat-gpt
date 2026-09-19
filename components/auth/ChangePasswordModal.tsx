import React, { useState } from 'react';
import Modal from '../shared/Modal';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { supabase, supabaseEnabled, internalEmailForLogin } from '../../supabase';
import AsyncActionButton from '../common/AsyncActionButton';

interface ChangePasswordModalProps { isOpen: boolean; onClose: () => void; }

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose }) => {
  const { user, updateUser, setPasswordChangeInProgress } = useAuth();
  const { setUsers } = useData();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    setSuccess('');

    if (!user) {
      setError('You are not logged in.');
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

    setSaving(true);
    setPasswordChangeInProgress(true);

    try {
      if (supabaseEnabled && supabase) {
        if (user.role === 'admin' && user.adminRole === 'super_admin') {
          // The Super Admin uses the real Supabase Auth identity represented by
          // the current session. Do not persist or mutate the password in profiles.
          const { data: sessionData } = await supabase.auth.getSession();
          const currentAuthUser = sessionData.session?.user;
          if (!currentAuthUser?.id || currentAuthUser.id !== user.identityId) {
            throw new Error('Super Admin authentication identity could not be verified. Please log in again.');
          }

          const credentialId = currentAuthUser.email || (user.id === '229132' ? '229132' : null);
          if (!credentialId) {
            throw new Error('Super Admin login identity could not be resolved. Please log in again.');
          }
          const credentialEmail = currentAuthUser.email || internalEmailForLogin(credentialId);
          const { data: authData, error: verifyError } = await supabase.auth.signInWithPassword({
            email: credentialEmail,
            password: currentPassword
          });
          if (verifyError || authData.user?.id !== currentAuthUser.id) {
            throw new Error('Incorrect current password.');
          }

          const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
          if (updateError) throw updateError;

          // Keep the authenticated session and refresh only the in-memory profile.
          updateUser({ ...user, password: '', isFirstLogin: false });
        } else {
          // Existing Member password flow.
          const credentialId = user.memberLoginMode === 'mobile' ? user.mobile : user.id;
          const normalizedCredentialId = credentialId?.trim();
          if (!normalizedCredentialId) {
            throw new Error('Member login identity could not be resolved. Please log in again.');
          }

          const credentialEmail = internalEmailForLogin(normalizedCredentialId);
          const { data: authData, error: verifyError } = await supabase.auth.signInWithPassword({
            email: credentialEmail,
            password: currentPassword
          });

          if (verifyError) {
            throw new Error('Incorrect current password.');
          }
          if (!authData.user?.id) {
            throw new Error('Member authentication identity could not be verified. Please log in again.');
          }
          if (authData.user.id !== user.identityId) {
            await supabase.auth.signOut();
            throw new Error('Member authentication identity does not match the current profile. Please log in again.');
          }

          const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
          if (updateError) throw updateError;

          const { data: stateData, error: stateError } = await supabase.rpc('complete_member_password_change');
          if (stateError) throw stateError;
          if (stateData !== true) {
            throw new Error('Member password state could not be completed. Please try again.');
          }

          // Do not persist the new password in the client-side User object.
          const updatedCurrentUser = { ...user, password: '', isFirstLogin: false };
          setUsers(prev => prev.map(u => u.id === user.id ? updatedCurrentUser : u));
          updateUser(updatedCurrentUser);
        }
      } else {
        if (user.password !== currentPassword) throw new Error('Incorrect current password.');
        const updatedCurrentUser = { ...user, password: '', isFirstLogin: false };
        setUsers(prev => prev.map(u => u.id === user.id ? updatedCurrentUser : u));
        updateUser(updatedCurrentUser);
      }

      setSuccess('Password updated successfully!');
      setTimeout(() => {
        onClose();
        setSuccess('');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }, 1200);
    } catch (err: any) {
      setError(err?.message || 'Could not update password. Please try again.');
    } finally {
      setPasswordChangeInProgress(false);
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Change Password">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-3 text-sm text-red-700 bg-red-100 rounded-md">{error}</div>}
        {success && <div className="p-3 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700">Current Password</label>
          <input disabled={saving} type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm disabled:bg-gray-50" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">New Password</label>
          <input disabled={saving} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm disabled:bg-gray-50" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Confirm New Password</label>
          <input disabled={saving} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="block w-full px-3 py-2 mt-1 border border-gray-300 rounded-md border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm disabled:bg-gray-50" required />
        </div>
        <div className="flex justify-end pt-4">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 mr-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50">Cancel</button>
          <AsyncActionButton type="submit" loading={saving} loadingLabel="Updating Password…" className="px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md shadow-sm bg-primary-600 hover:bg-primary-700">Update Password</AsyncActionButton>
        </div>
      </form>
    </Modal>
  );
};

export default ChangePasswordModal;

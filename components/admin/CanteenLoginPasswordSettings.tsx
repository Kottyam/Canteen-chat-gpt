import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { changeCanteenLoginPassword } from '../../services/canteenLogin';

const CanteenLoginPasswordSettings: React.FC = () => {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const loginLabel = user?.id && !String(user.id).startsWith('CANTEENLOGIN-') ? user.id : (user?.canteenName || 'this canteen');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    setSuccess('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await changeCanteenLoginPassword(currentPassword, newPassword);
      setSuccess('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err?.message || 'Could not update password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-white p-4">
      <h4 className="font-bold text-gray-900">Change password</h4>
      <p className="mt-1 text-sm text-gray-600">
        This password is for Canteen ID <span className="font-semibold text-gray-800">{loginLabel}</span>, not a personal account. Share it only with the current canteen admin.
      </p>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        {error && <div className="rounded-lg bg-red-100 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-lg bg-green-100 p-3 text-sm text-green-700">{success}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700">Current password</label>
          <input
            type="password"
            aria-label="Current password"
            disabled={saving}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="mt-1 block min-h-11 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-gray-900 disabled:bg-gray-100"
            placeholder="Current password"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">New password</label>
          <input
            type="password"
            aria-label="New password"
            disabled={saving}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 block min-h-11 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-gray-900 disabled:bg-gray-100"
            placeholder="New password"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Confirm new password</label>
          <input
            type="password"
            aria-label="Confirm new password"
            disabled={saving}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 block min-h-11 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-gray-900 disabled:bg-gray-100"
            placeholder="Confirm new password"
            required
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 w-full rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {saving ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </section>
  );
};

export default CanteenLoginPasswordSettings;

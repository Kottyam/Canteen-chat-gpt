import React, { useEffect, useState } from 'react';
import { resetCanteenLoginPassword, setCanteenLoginId } from '../../services/canteenLogin';

const SuperAdminCanteenLogin: React.FC<{
  canteenId: string;
  canteenName: string;
  loginId?: string | null;
  onChanged: () => void;
}> = ({ canteenId, loginId, onChanged }) => {
  const existing = Boolean(loginId);
  const [idValue, setIdValue] = useState(loginId || '');
  useEffect(() => { setIdValue(loginId || ''); }, [loginId]);
  const [initialPassword, setInitialPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const run = async (key: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError('');
    setMessage('');
    try {
      await work();
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Could not update Canteen ID login.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <h4 className="text-sm font-extrabold text-gray-900">Canteen login</h4>
      <p className="mt-0.5 text-xs text-gray-600">
        {existing
          ? 'Edit the ID, or reset the password when the admin person changes.'
          : 'Set a Canteen ID and an initial password for this canteen. This login belongs to the canteen, not a person.'}
      </p>
      {error && <div className="mt-3 rounded-lg bg-red-100 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="mt-3 rounded-lg bg-green-100 p-3 text-sm text-green-700">{message}</div>}
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run('save', async () => {
            await setCanteenLoginId(canteenId, idValue, existing ? undefined : initialPassword);
            setInitialPassword('');
            setMessage(existing ? 'Canteen ID saved.' : 'Canteen ID login created.');
          });
        }}
      >
        <div className="flex gap-2">
          <input
            aria-label="Canteen ID"
            value={idValue}
            onChange={(e) => setIdValue(e.target.value.toUpperCase())}
            disabled={Boolean(busy)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 font-semibold uppercase tracking-wide text-gray-900"
            placeholder="Canteen ID (e.g. KOCHI01)"
          />
          <button
            type="submit"
            disabled={Boolean(busy) || !idValue.trim() || (!existing && !initialPassword)}
            className="min-h-11 shrink-0 rounded-xl bg-primary-600 px-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {busy === 'save' ? 'Saving…' : existing ? 'Save ID' : 'Save'}
          </button>
        </div>
        {!existing && (
          <input
            aria-label="Initial password"
            type="password"
            value={initialPassword}
            onChange={(e) => setInitialPassword(e.target.value)}
            disabled={Boolean(busy)}
            className="min-h-11 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-gray-900"
            placeholder="Initial password"
          />
        )}
      </form>
      {existing && (
        <>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-500">Reset password</p>
          <form
            className="mt-1.5 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newPassword !== confirmPassword) {
                setError('New passwords do not match.');
                return;
              }
              void run('reset', async () => {
                await resetCanteenLoginPassword(canteenId, newPassword);
                setNewPassword('');
                setConfirmPassword('');
                setMessage('Password reset.');
              });
            }}
          >
            <input
              aria-label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={Boolean(busy)}
              className="min-h-11 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-gray-900"
              placeholder="New password"
            />
            <input
              aria-label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={Boolean(busy)}
              className="min-h-11 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-gray-900"
              placeholder="Confirm new password"
            />
            <button
              type="submit"
              disabled={Boolean(busy) || !newPassword || !confirmPassword}
              className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 shadow-sm disabled:opacity-60"
            >
              {busy === 'reset' ? 'Resetting…' : 'Reset password'}
            </button>
          </form>
        </>
      )}
    </div>
  );
};

export default SuperAdminCanteenLogin;

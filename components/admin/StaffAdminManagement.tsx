import React, { useEffect, useState } from 'react';
import { normalizeMobileNumber, supabase } from '../../supabase';
import { ADMIN_PERMISSIONS, useAuth } from '../../context/AuthContext';
import { AdminPermission, AdminRole } from '../../types';

type Staff = {
  id: string;
  full_name: string;
  mobile_number: string;
  status: string;
  admin_role: AdminRole;
  permissions: AdminPermission[];
};

const labels: Record<AdminPermission, string> = {
  dashboard: 'Dashboard / Overview',
  members: 'Members',
  orders: 'Orders / Place Order',
  guest_orders: 'Guest Orders',
  menu: 'Menu & Prices',
  daily_reports: 'Daily Reports / Summary',
  monthly_reports: 'Monthly Reports',
  revenue: 'Revenue',
  expenses: 'Expenses',
  bills: 'Bills',
  payments: 'Payment Verification',
  time_management: 'Time Management',
  holidays: 'Holiday Management',
};

const call = async (body: Record<string, unknown>) => {
  if (!supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.functions.invoke('manage-staff-admin', { body });
  if (error) {
    try {
      const context = (error as any)?.context;
      if (context?.json) {
        const payload = await context.json();
        if (payload?.error) throw new Error(String(payload.error));
      }
    } catch (parsed: any) {
      if (parsed?.message && !String(parsed.message).includes('body')) throw parsed;
    }
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return data as any;
};

const StaffAdminManagement: React.FC = () => {
  const { isOwner } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', mobile: '', password: '' });
  const [edit, setEdit] = useState<Staff | null>(null);
  const [editForm, setEditForm] = useState({ name: '', mobile: '' });
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [permissionsId, setPermissionsId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<AdminPermission[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    try {
      const result = await call({ action: 'list' });
      setStaff(result.staff || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load Admin Roles.');
    }
  };

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner]);

  if (!isOwner) return null;

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    const mobile = normalizeMobileNumber(form.mobile);
    if (!form.name.trim()) return setError('Name is required.');
    if (!/^[6-9][0-9]{9}$/.test(mobile)) return setError('Please enter a valid Mobile Number.');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await call({ action: 'create', name: form.name.trim(), mobile, password: form.password });
      setForm({ name: '', mobile: '', password: '' });
      setShowCreate(false);
      await load();
      setSuccess('Staff Admin created. No business permissions are granted until the Owner assigns them.');
    } catch (e: any) {
      setError(e?.message || 'Could not create Staff Admin.');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    setError('');
    setSuccess('');
    const mobile = normalizeMobileNumber(editForm.mobile);
    if (!editForm.name.trim()) return setError('Name is required.');
    if (!/^[6-9][0-9]{9}$/.test(mobile)) return setError('Please enter a valid Mobile Number.');
    setBusy(true);
    try {
      await call({ action: 'update', staff_id: edit.id, name: editForm.name.trim(), mobile });
      setEdit(null);
      await load();
      setSuccess('Admin details updated.');
    } catch (e: any) {
      setError(e?.message || 'Could not update Admin.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!resetId) return;
    setError('');
    setSuccess('');
    if (resetPassword.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await call({ action: 'reset_password', staff_id: resetId, password: resetPassword });
      setResetId(null);
      setResetPassword('');
      setSuccess('Admin password reset successfully.');
    } catch (e: any) {
      setError(e?.message || 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item: Staff) => {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await call({ action: item.status === 'active' ? 'deactivate' : 'activate', staff_id: item.id });
      await load();
      setSuccess(item.status === 'active' ? 'Admin deactivated.' : 'Admin reactivated.');
    } catch (e: any) {
      setError(e?.message || 'Could not update Admin status.');
    } finally {
      setBusy(false);
    }
  };

  const saveRole = async (item: Staff, role: AdminRole) => {
    if (role === item.admin_role) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await call({ action: 'set_role', staff_id: item.id, admin_role: role });
      await load();
      setSuccess(`${item.full_name} role changed to ${role === 'master_admin' ? 'Master Admin' : 'Staff Admin'}.`);
    } catch (e: any) {
      setError(e?.message || 'Could not change Admin role.');
    } finally {
      setBusy(false);
    }
  };

  const openPermissions = (item: Staff) => {
    setPermissionsId(item.id);
    setPermissions(item.permissions || []);
    setError('');
    setSuccess('');
  };

  const togglePermission = (permission: AdminPermission) => {
    setPermissions((current) =>
      current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission],
    );
  };

  const savePermissions = async () => {
    if (!permissionsId) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await call({ action: 'set_permissions', staff_id: permissionsId, permissions });
      await load();
      setPermissionsId(null);
      setSuccess('Admin business permissions updated.');
    } catch (e: any) {
      setError(e?.message || 'Could not update permissions.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-lg font-bold">MANAGE ADMIN ROLES</h4>
            <p className="mt-1 text-sm text-gray-500">Owner-only control of Staff Admin and Master Admin identities for this Canteen.</p>
          </div>
          <button type="button" onClick={() => { setShowCreate((v) => !v); setError(''); setSuccess(''); }} className="rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white">
            {showCreate ? 'Close' : '＋ Create New Admin Role'}
          </button>
        </div>
        {error && <div className="mt-4 whitespace-pre-line rounded-md bg-red-100 p-3 text-sm text-red-700">{error}</div>}
        {success && <div className="mt-4 rounded-md bg-green-100 p-3 text-sm text-green-700">{success}</div>}
        {showCreate && (
          <form onSubmit={create} className="mt-4 rounded-lg border bg-gray-50 p-4">
            <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm text-gray-700">
              <p className="font-bold text-primary-800">ADMIN ROLE LOGIN INFORMATION</p>
              <p className="mt-2"><strong>User ID:</strong> Admin's Mobile Number</p>
              <p><strong>Password:</strong> Password set by the Owner.</p>
              <p className="mt-2">Normal creation creates a <strong>Staff Admin</strong>. Master Admin is available only by Owner promotion.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border px-3 py-2.5" />
              <input required inputMode="tel" placeholder="Mobile Number" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className="rounded-md border px-3 py-2.5" />
              <input required type="password" minLength={8} placeholder="Initial Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-md border px-3 py-2.5" />
            </div>
            <button disabled={busy} className="mt-3 rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create Staff Admin'}</button>
          </form>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <h4 className="font-bold">ADMIN ACCOUNTS</h4>
        {staff.length === 0 ? <p className="mt-3 text-sm text-gray-500">No non-Owner Admin accounts yet.</p> : (
          <div className="mt-3 space-y-3">
            {staff.map((item) => (
              <div key={item.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.full_name}</p>
                    <p className="text-sm text-gray-500">Mobile: {item.mobile_number}</p>
                    <p className="text-sm text-gray-600">Role: {item.admin_role === 'master_admin' ? 'Master Admin' : 'Staff Admin'} · Status: <span className="capitalize">{item.status}</span></p>
                    <p className="text-xs text-gray-500">Permissions: {item.permissions?.length || 0} assigned</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => openPermissions(item)} className="rounded-md border px-3 py-2 text-sm">Permissions</button>
                    <button type="button" disabled={busy} onClick={() => { setEdit(item); setEditForm({ name: item.full_name, mobile: item.mobile_number }); setError(''); setSuccess(''); }} className="rounded-md border px-3 py-2 text-sm">Edit</button>
                    <button type="button" disabled={busy} onClick={() => { setResetId(item.id); setResetPassword(''); setError(''); setSuccess(''); }} className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white">Reset Password</button>
                    <button type="button" disabled={busy} onClick={() => void toggle(item)} className={`rounded-md px-3 py-2 text-sm text-white ${item.status === 'active' ? 'bg-red-600' : 'bg-green-600'}`}>{item.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Role:</span>
                  <select value={item.admin_role} disabled={busy} onChange={(e) => void saveRole(item, e.target.value as AdminRole)} className="rounded-md border px-3 py-2 text-sm">
                    <option value="staff_admin">Staff Admin</option>
                    <option value="master_admin">Master Admin</option>
                  </select>
                  <span className="text-xs text-gray-500">Only Owner can promote/demote.</span>
                </div>

                {edit?.id === item.id && (
                  <div className="mt-3 rounded-md bg-gray-50 p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Name" className="rounded-md border px-3 py-2.5" />
                      <input value={editForm.mobile} onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })} inputMode="tel" placeholder="Mobile Number" className="rounded-md border px-3 py-2.5" />
                    </div>
                    <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void saveEdit()} className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white">Save</button><button type="button" onClick={() => setEdit(null)} className="rounded-md border px-3 py-2 text-sm">Cancel</button></div>
                  </div>
                )}

                {permissionsId === item.id && (
                  <div className="mt-3 rounded-md border bg-gray-50 p-3">
                    <p className="font-semibold">Business Permissions</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {ADMIN_PERMISSIONS.map((permission) => (
                        <label key={permission} className="flex items-center gap-2 rounded-md border bg-white p-2 text-sm">
                          <input type="checkbox" checked={permissions.includes(permission)} onChange={() => togglePermission(permission)} />
                          {labels[permission]}
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => void savePermissions()} className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white">Save Permissions</button><button type="button" disabled={busy} onClick={() => setPermissionsId(null)} className="rounded-md border px-3 py-2 text-sm">Cancel</button></div>
                  </div>
                )}

                {resetId === item.id && (
                  <div className="mt-3 rounded-md bg-gray-50 p-3">
                    <input autoFocus type="password" minLength={8} placeholder="New Password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} className="w-full rounded-md border px-3 py-2.5" />
                    <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void reset()} className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white">Set New Password</button><button type="button" onClick={() => setResetId(null)} className="rounded-md border px-3 py-2 text-sm">Cancel</button></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffAdminManagement;

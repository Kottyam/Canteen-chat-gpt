import React, { useState } from 'react';
import { useData } from '../../context/DataContext';
import { User, Status } from '../../types';
import { DEFAULT_EMPLOYEE_PASSWORD } from '../../constants';

const EmployeeManagement: React.FC = () => {
  const { users, setUsers } = useData();
  const [form, setForm] = useState({ name: '', sr: '', mobile: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const employees = users.filter(u => u.role === 'employee');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.name.trim() || !/^\d{5}$/.test(form.sr)) {
      setError('Enter employee name and a 5-digit SR Number.');
      return;
    }

    if (users.some(u => u.id === form.sr)) {
      setError('SR Number already exists.');
      return;
    }

    const employee: User = {
      id: form.sr,
      name: form.name.trim(),
      mobile: form.mobile.trim(),
      password: DEFAULT_EMPLOYEE_PASSWORD,
      role: 'employee',
      status: 'active' as Status,
      isFirstLogin: true,
    };

    setUsers(prev => [...prev, employee]);
    setForm({ name: '', sr: '', mobile: '' });
    setSuccess(`Employee ${employee.name} added. Login ID: ${employee.id}`);
  };

  const toggleStatus = (id: string) => {
    setUsers(prev =>
      prev.map(u =>
        u.id === id
          ? { ...u, status: u.status === 'active' ? 'blocked' : 'active' }
          : u
      )
    );
  };

  const resetPassword = (id: string) => {
    setUsers(prev =>
      prev.map(u =>
        u.id === id
          ? { ...u, password: DEFAULT_EMPLOYEE_PASSWORD, isFirstLogin: true }
          : u
      )
    );
    setSuccess('Password reset successfully.');
    window.setTimeout(() => setSuccess(''), 2500);
  };

  const deleteEmployee = (id: string) => {
    const employee = employees.find(u => u.id === id);
    if (!employee) return;

    const confirmed = window.confirm(
      `Delete employee "${employee.name}" (SR ${employee.id})?\n\nThis removes the employee from the app user list.`
    );
    if (!confirmed) return;

    setUsers(prev => prev.filter(u => u.id !== id));
    setSuccess(`Employee ${employee.name} deleted.`);
    window.setTimeout(() => setSuccess(''), 3000);
  };

  return (
    <div className="w-full min-w-0">
      <h3 className="mb-5 text-xl font-bold text-gray-800 sm:text-2xl">
        Employee Management
      </h3>

      <form
        onSubmit={handleAdd}
        className="mb-6 w-full rounded-lg border bg-gray-50 p-3 sm:p-4"
      >
        <h4 className="mb-3 font-semibold text-gray-800">Add New Employee</h4>

        {error && (
          <div className="mb-3 rounded-md bg-red-100 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-3 rounded-md bg-green-100 p-3 text-sm text-green-700">
            {success}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            required
            placeholder="Employee Name"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-md border px-3 py-2.5"
          />

          <input
            required
            inputMode="numeric"
            maxLength={5}
            placeholder="5-digit SR Number"
            value={form.sr}
            onChange={e =>
              setForm({
                ...form,
                sr: e.target.value.replace(/\D/g, '').slice(0, 5),
              })
            }
            className="w-full rounded-md border px-3 py-2.5"
          />

          <input
            inputMode="tel"
            placeholder="Mobile Number"
            value={form.mobile}
            onChange={e => setForm({ ...form, mobile: e.target.value })}
            className="w-full rounded-md border px-3 py-2.5"
          />
        </div>

        <button
          type="submit"
          className="mt-3 w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 sm:w-auto"
        >
          Add Employee
        </button>
      </form>

      <div className="space-y-3 md:hidden">
        {employees.length === 0 ? (
          <div className="rounded-lg border bg-white p-4 text-sm text-gray-500">
            No employees found.
          </div>
        ) : (
          employees.map(emp => (
            <div key={emp.id} className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-3">
                <p className="font-semibold text-gray-800">{emp.name}</p>
                <p className="text-sm text-gray-500">SR: {emp.id}</p>
                <p className="text-sm text-gray-500">
                  Mobile: {emp.mobile || '—'}
                </p>
                <p className="mt-1 text-sm">
                  Status:{' '}
                  <span className="font-medium capitalize">{emp.status}</span>
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => toggleStatus(emp.id)}
                  className="rounded-md bg-yellow-500 px-3 py-2 text-xs font-medium text-white"
                >
                  {emp.status === 'active' ? 'Block' : 'Unblock'}
                </button>

                <button
                  type="button"
                  onClick={() => resetPassword(emp.id)}
                  className="rounded-md bg-primary-500 px-3 py-2 text-xs font-medium text-white"
                >
                  Reset Password
                </button>

                <button
                  type="button"
                  onClick={() => deleteEmployee(emp.id)}
                  className="rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white"
                >
                  Delete Employee
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="min-w-full bg-white">
          <thead className="bg-gray-50">
            <tr>
              {['Name', 'SR Number', 'Mobile', 'Status', 'Actions'].map(h => (
                <th
                  key={h}
                  className="whitespace-nowrap px-4 py-3 text-left text-xs uppercase text-gray-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {employees.map(emp => (
              <tr key={emp.id} className="border-t">
                <td className="px-4 py-3">{emp.name}</td>
                <td className="px-4 py-3">{emp.id}</td>
                <td className="px-4 py-3">{emp.mobile || '—'}</td>
                <td className="px-4 py-3 capitalize">{emp.status}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleStatus(emp.id)}
                      className="rounded bg-yellow-500 px-3 py-1 text-xs text-white"
                    >
                      {emp.status === 'active' ? 'Block' : 'Unblock'}
                    </button>

                    <button
                      type="button"
                      onClick={() => resetPassword(emp.id)}
                      className="rounded bg-primary-500 px-3 py-1 text-xs text-white"
                    >
                      Reset Password
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteEmployee(emp.id)}
                      className="rounded bg-red-600 px-3 py-1 text-xs text-white"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default EmployeeManagement;

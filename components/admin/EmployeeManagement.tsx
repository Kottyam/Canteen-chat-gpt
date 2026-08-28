import React, { useState } from 'react';
import { useData } from '../../context/DataContext';
import { User, Status } from '../../types';
import { DEFAULT_EMPLOYEE_PASSWORD } from '../../constants';

const EmployeeManagement: React.FC = () => {
    const { users, setUsers } = useData();
    const [form, setForm] = useState({ name: '', sr: '', mobile: '' });
    const [error, setError] = useState(''); const [success, setSuccess] = useState('');
    const employees = users.filter(u => u.role === 'employee');
    const handleAdd = (e: React.FormEvent) => { e.preventDefault(); setError(''); setSuccess('');
        if (!form.name.trim() || !/^\d{5}$/.test(form.sr)) { setError('Enter employee name and a 5-digit SR Number.'); return; }
        if (users.some(u => u.id === form.sr)) { setError('SR Number already exists.'); return; }
        const employee: User = { id: form.sr, name: form.name.trim(), mobile: form.mobile.trim(), password: DEFAULT_EMPLOYEE_PASSWORD, role: 'employee', status: 'active' as Status, isFirstLogin: true };
        setUsers([...users, employee]); setForm({ name:'', sr:'', mobile:'' }); setSuccess(`Employee ${employee.name} added. Login ID: ${employee.id}`);
    };
    const toggleStatus=(id:string)=>setUsers(users.map(u=>u.id===id?{...u,status:u.status==='active'?'blocked':'active'}:u));
    const resetPassword=(id:string)=>setUsers(users.map(u=>u.id===id?{...u,password:DEFAULT_EMPLOYEE_PASSWORD,isFirstLogin:true}:u));
    return <div><h3 className="mb-6 text-2xl font-bold text-gray-800">Employee Management</h3>
      <form onSubmit={handleAdd} className="p-4 mb-6 border rounded-lg bg-gray-50 space-y-3"><h4 className="font-semibold">Add New Employee</h4>
        {error&&<div className="p-2 text-sm text-red-700 bg-red-100 rounded">{error}</div>}{success&&<div className="p-2 text-sm text-green-700 bg-green-100 rounded">{success}</div>}
        <div className="grid gap-2 md:grid-cols-3"><input required placeholder="Employee Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="px-3 py-2 border rounded"/><input required inputMode="numeric" maxLength={5} placeholder="5-digit SR Number" value={form.sr} onChange={e=>setForm({...form,sr:e.target.value.replace(/\D/g,'')})} className="px-3 py-2 border rounded"/><input inputMode="tel" placeholder="Mobile Number" value={form.mobile} onChange={e=>setForm({...form,mobile:e.target.value})} className="px-3 py-2 border rounded"/></div>
        <button className="px-4 py-2 text-white rounded bg-primary-600">Add Employee</button>
      </form>
      <div className="overflow-x-auto"><table className="min-w-full bg-white"><thead className="bg-gray-50"><tr>{['Name','SR Number','Mobile','Status','Actions'].map(h=><th key={h} className="px-4 py-3 text-xs text-left uppercase text-gray-500">{h}</th>)}</tr></thead><tbody>{employees.map(emp=><tr key={emp.id} className="border-t"><td className="px-4 py-3">{emp.name}</td><td className="px-4 py-3">{emp.id}</td><td className="px-4 py-3">{emp.mobile||'—'}</td><td className="px-4 py-3">{emp.status}</td><td className="px-4 py-3 space-x-2"><button onClick={()=>toggleStatus(emp.id)} className="px-3 py-1 text-xs rounded bg-yellow-500 text-white">{emp.status==='active'?'Block':'Unblock'}</button><button onClick={()=>resetPassword(emp.id)} className="px-3 py-1 text-xs rounded bg-primary-500 text-white">Reset Password</button></td></tr>)}</tbody></table></div>
    </div>;
}; export default EmployeeManagement;

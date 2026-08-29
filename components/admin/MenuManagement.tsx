import React, { useEffect, useState } from 'react';
import { MenuItem } from '../../types';
import { loadSupabaseData, saveMenuItem, deleteMenuItem } from '../../services/supabaseSync';
import { useData } from '../../context/DataContext';

const MenuManagement: React.FC = () => {
  const { menuItems, setMenuItems } = useData();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const cloud = await loadSupabaseData();
      if (cloud) {
        setMenuItems(cloud.menuItems || []);
        setItems((cloud.menuItems || []).filter((item: MenuItem) => !item.archived));
      } else {
        setItems(menuItems.filter(item => !item.archived));
      }
    } catch (error) {
      console.error(error);
      setItems(menuItems.filter(item => !item.archived));
    }
  };

  useEffect(() => { setItems(menuItems.filter(item => !item.archived)); }, [menuItems]);
  useEffect(() => { void refresh(); }, []);

  const patch = (itemCode: string, next: Partial<MenuItem>) => {
    setItems(prev => prev.map(item => item.itemCode === itemCode ? { ...item, ...next } : item));
  };

  const save = async (item: MenuItem) => {
    const clean: MenuItem = {
      ...item,
      itemName: item.itemName.trim(),
      unitPrice: Number(item.unitPrice),
      active: true,
      archived: false,
    };
    if (!clean.itemName || !Number.isFinite(clean.unitPrice) || clean.unitPrice < 0) {
      setMessage('Enter a valid menu item name and price.');
      return;
    }
    setBusy(item.itemCode);
    setMessage('');
    try {
      await saveMenuItem(clean);
      setItems(prev => prev.map(i => i.itemCode === clean.itemCode ? clean : i));
      setMenuItems(prev => prev.map(i => i.itemCode === clean.itemCode ? clean : i));
      setMessage(`${clean.itemName} and its price saved. Employees will see the updated menu.`);
    } catch (error: any) {
      console.error(error);
      setMessage(`Save failed: ${error?.message || 'Please try again.'}`);
    } finally { setBusy(null); }
  };

  const remove = async (item: MenuItem) => {
    if (!window.confirm(`Delete “${item.itemName}” from today's menu? Existing order history will be preserved.`)) return;
    setBusy(item.itemCode);
    setMessage('');
    try {
      await deleteMenuItem(item.itemCode);
      setItems(prev => prev.filter(i => i.itemCode !== item.itemCode));
      setMenuItems(prev => prev.map(i => i.itemCode === item.itemCode ? { ...i, active: false, archived: true } : i));
      setMessage(`${item.itemName} deleted from the current menu. Old order history is preserved.`);
    } catch (error: any) {
      console.error(error);
      setMessage(`Delete failed: ${error?.message || 'Please try again.'}`);
    } finally { setBusy(null); }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    const price = Number(newPrice);
    if (!name || !Number.isFinite(price) || price < 0) {
      setMessage('Enter a valid menu item name and price.');
      return;
    }
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
    let itemCode = base;
    let n = 2;
    while (menuItems.some(item => item.itemCode === itemCode)) itemCode = `${base}_${n++}`;
    const item: MenuItem = { itemCode, itemName: name, unitPrice: price, active: true, archived: false };
    setBusy('new');
    setMessage('');
    try {
      await saveMenuItem(item);
      setItems(prev => [...prev, item]);
      setMenuItems(prev => [...prev, item]);
      setNewName('');
      setNewPrice('');
      setMessage(`${name} added to today's menu.`);
    } catch (error: any) {
      console.error(error);
      setMessage(`Add failed: ${error?.message || 'Please try again.'}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="w-full min-w-0">
      <h3 className="text-2xl font-bold text-gray-800">Menu & Prices</h3>
      <p className="mb-5 mt-1 text-sm text-gray-500">Manage today's employee menu. Add, edit and save an item and its price together. Deleted items disappear from the employee menu while old orders keep their original details.</p>

      {message && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.itemCode} className="rounded-xl border bg-white p-3 shadow-sm sm:p-4">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Item</label>
                <input value={item.itemName} onChange={e => patch(item.itemCode, { itemName: e.target.value })} className="min-h-12 w-full rounded-lg border px-3 text-base outline-none focus:border-primary-500" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Price</label>
                <div className="flex min-w-0">
                  <span className="flex min-h-12 shrink-0 items-center rounded-l-lg border border-r-0 bg-gray-50 px-4 text-gray-500">₹</span>
                  <input type="number" min="0" step="0.5" inputMode="decimal" value={item.unitPrice} onChange={e => patch(item.itemCode, { unitPrice: Number(e.target.value) })} className="min-h-12 w-full min-w-0 rounded-r-lg border px-3 text-lg outline-none focus:border-primary-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy === item.itemCode} onClick={() => save(item)} className="min-h-11 rounded-lg bg-primary-600 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy === item.itemCode ? 'Saving…' : 'Save / Edit'}</button>
                <button type="button" disabled={busy === item.itemCode} onClick={() => remove(item)} className="min-h-11 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-50">Delete</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="mt-5 rounded-xl border bg-gray-50 p-3 sm:p-4">
        <h4 className="mb-3 text-lg font-bold text-gray-800">Add Menu Item</h4>
        <div className="space-y-3">
          <input required value={newName} onChange={e => setNewName(e.target.value)} placeholder="Item name" className="min-h-12 w-full rounded-lg border px-3 text-base" />
          <input required type="number" min="0" step="0.5" inputMode="decimal" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Price" className="min-h-12 w-full rounded-lg border px-3 text-base" />
          <button type="submit" disabled={busy === 'new'} className="min-h-12 w-full rounded-lg bg-primary-600 px-4 font-semibold text-white disabled:opacity-50">{busy === 'new' ? 'Adding…' : 'Add Menu Item'}</button>
        </div>
      </form>
    </div>
  );
};

export default MenuManagement;

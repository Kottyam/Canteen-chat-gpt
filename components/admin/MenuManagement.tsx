import React, { useEffect, useState } from 'react';
import { MenuItem } from '../../types';
import { loadSupabaseData, saveMenuItem, activateMenuItem, deactivateMenuItem, deleteMenuItem } from '../../services/supabaseSync';
import { useData } from '../../context/DataContext';

const fallbackItems: MenuItem[] = [
  { itemCode: 'morningTea', itemName: 'Morning Tea', unitPrice: 8, active: true },
  { itemCode: 'lunchMeals', itemName: 'Lunch: Meals', unitPrice: 40, active: true },
  { itemCode: 'lunchEgg', itemName: 'Lunch: Egg (add-on)', unitPrice: 10, active: true },
  { itemCode: 'lunchFishMeat', itemName: 'Lunch: Fish/Meat (add-on)', unitPrice: 25, active: true },
  { itemCode: 'eveningTea', itemName: 'Evening Tea', unitPrice: 8, active: true },
];

const MenuManagement: React.FC = () => {
  const { menuItems, setMenuItems } = useData();
  const [items, setItems] = useState<MenuItem[]>(menuItems.length ? menuItems : fallbackItems);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadItems = async () => {
    try {
      const cloud = await loadSupabaseData();
      if (cloud) {
        setItems(cloud.menuItems || []);
        setMenuItems(cloud.menuItems || []);
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    setItems(menuItems);
  }, [menuItems]);

  useEffect(() => { loadItems(); }, []);

  const patch = (itemCode: string, next: Partial<MenuItem>) => {
    setItems(prev => prev.map(item => item.itemCode === itemCode ? { ...item, ...next } : item));
  };

  const save = async (item: MenuItem) => {
    const clean = { ...item, itemName: item.itemName.trim(), unitPrice: Number(item.unitPrice) };
    if (!clean.itemName || !Number.isFinite(clean.unitPrice) || clean.unitPrice < 0) {
      setMessage('Enter a valid menu name and price.');
      return;
    }
    setBusy(item.itemCode);
    try {
      await saveMenuItem(clean);
      setItems(prev => prev.map(i => i.itemCode === clean.itemCode ? clean : i));
      setMenuItems(prev => prev.map(i => i.itemCode === clean.itemCode ? clean : i));
      setMessage('Menu item saved permanently.');
    } catch (error: any) {
      console.error(error);
      setMessage(`Save failed: ${error?.message || 'Please check admin access.'}`);
    } finally { setBusy(null); }
  };

  const toggle = async (item: MenuItem) => {
    setBusy(item.itemCode);
    try {
      if (item.active) await deactivateMenuItem(item.itemCode);
      else await activateMenuItem(item.itemCode);
      const nextActive = !item.active;
      setItems(prev => prev.map(i => i.itemCode === item.itemCode ? { ...i, active: nextActive } : i));
      setMenuItems(prev => prev.map(i => i.itemCode === item.itemCode ? { ...i, active: nextActive } : i));
      setMessage(item.active ? 'Menu item deactivated.' : 'Menu item activated.');
    } catch (error: any) {
      console.error(error);
      setMessage(`Status update failed: ${error?.message || 'Unknown error'}`);
    } finally { setBusy(null); }
  };

  const remove = async (item: MenuItem) => {
    if (!window.confirm(`Remove “${item.itemName}” from the active menu?`)) return;
    setBusy(item.itemCode);
    try {
      const result = await deleteMenuItem(item.itemCode);
      // Historical order references may force an archive instead of a physical delete.
      // Either way, remove it from the employee-visible menu immediately.
      setItems(prev => prev.filter(i => i.itemCode !== item.itemCode));
      setMenuItems(prev => prev.filter(i => i.itemCode !== item.itemCode));
      setMessage(result === 'deactivated'
        ? 'Item archived because it is used in order history.'
        : 'Menu item deleted permanently.');
    } catch (error: any) {
      console.error(error);
      setMessage(`Delete failed: ${error?.message || 'Unknown error'}`);
    } finally { setBusy(null); }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    const price = Number(newPrice);
    if (!name || !Number.isFinite(price) || price < 0) {
      setMessage('Enter a valid menu name and price.');
      return;
    }
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
    let itemCode = base;
    let n = 2;
    while (items.some(item => item.itemCode === itemCode)) itemCode = `${base}_${n++}`;
    const item: MenuItem = { itemCode, itemName: name, unitPrice: price, active: true };

    setBusy('new');
    try {
      await saveMenuItem(item);
      setItems(prev => [...prev, item]);
      setMenuItems(prev => [...prev, item]);
      setNewName('');
      setNewPrice('');
      setMessage('New menu item added permanently.');
    } catch (error: any) {
      console.error(error);
      setMessage(`Add failed: ${error?.message || 'Unknown error'}`);
    } finally { setBusy(null); }
  };

  return (
    <div className="w-full min-w-0">
      <h3 className="text-2xl font-bold text-gray-800">Menu Management</h3>
      <p className="mb-5 mt-1 text-sm text-gray-500">
        Edit complete menu details and save them permanently to Supabase.
      </p>

      {message && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.itemCode} className="rounded-xl border bg-white p-3 shadow-sm sm:p-4">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Item name</label>
                <input
                  value={item.itemName}
                  onChange={e => patch(item.itemCode, { itemName: e.target.value })}
                  className="min-h-12 w-full rounded-lg border px-3 text-base outline-none focus:border-primary-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Price</label>
                <div className="flex min-w-0">
                  <span className="flex min-h-12 shrink-0 items-center rounded-l-lg border border-r-0 bg-gray-50 px-4 text-gray-500">₹</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    inputMode="decimal"
                    value={item.unitPrice}
                    onChange={e => patch(item.itemCode, { unitPrice: Number(e.target.value) })}
                    className="min-h-12 w-full min-w-0 rounded-r-lg border px-3 text-lg outline-none focus:border-primary-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <button type="button" disabled={busy === item.itemCode} onClick={() => save(item)} className="min-h-11 rounded-lg bg-primary-600 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy === item.itemCode ? 'Saving…' : 'Save / Edit'}</button>
                <button type="button" disabled={busy === item.itemCode} onClick={() => toggle(item)} className="min-h-11 rounded-lg bg-yellow-500 px-3 text-sm font-semibold text-white disabled:opacity-50">{item.active ? 'Deactivate' : 'Activate'}</button>
                <button type="button" disabled={busy === item.itemCode} onClick={() => remove(item)} className="col-span-2 min-h-11 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-1">Delete</button>
              </div>

              <div className="text-xs text-gray-500">Code: {item.itemCode} · {item.active ? 'Active' : 'Inactive'}</div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="mt-5 rounded-xl border bg-gray-50 p-3 sm:p-4">
        <h4 className="mb-3 text-lg font-bold text-gray-800">Add New Menu Item</h4>
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

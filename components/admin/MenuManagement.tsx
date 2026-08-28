import React, { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { Prices } from '../../types';

type MenuKey = keyof Prices;

interface MenuItem {
  key: MenuKey;
  name: string;
  price: number;
}

const DEFAULT_ITEMS: MenuItem[] = [
  { key: 'morningTea', name: 'Morning Tea', price: 8 },
  { key: 'lunchMeals', name: 'Lunch: Meals', price: 40 },
  { key: 'lunchEgg', name: 'Lunch: Egg (add-on)', price: 10 },
  { key: 'lunchFishMeat', name: 'Lunch: Fish/Meat (add-on)', price: 25 },
  { key: 'eveningTea', name: 'Evening Tea', price: 8 },
];

const MenuManagement: React.FC = () => {
  const { prices, setPrices } = useData();
  const [names, setNames] = useState<Record<MenuKey, string>>(() => {
    const initial = {} as Record<MenuKey, string>;
    DEFAULT_ITEMS.forEach(item => {
      initial[item.key] = item.name;
    });
    return initial;
  });
  const [active, setActive] = useState<Record<MenuKey, boolean>>(() => {
    const initial = {} as Record<MenuKey, boolean>;
    DEFAULT_ITEMS.forEach(item => {
      initial[item.key] = true;
    });
    return initial;
  });
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [message, setMessage] = useState('');

  const items = useMemo<MenuItem[]>(() => {
    return DEFAULT_ITEMS.map(item => ({
      ...item,
      name: names[item.key] || item.name,
      price: prices[item.key],
    }));
  }, [names, prices]);

  const updatePrice = (key: MenuKey, value: string) => {
    setPrices(prev => ({
      ...prev,
      [key]: Math.max(0, Number(value)),
    }));
  };

  const saveName = (key: MenuKey) => {
    const value = names[key].trim();
    if (!value) return;
    setNames(prev => ({ ...prev, [key]: value }));
    setMessage('Menu updated.');
    window.setTimeout(() => setMessage(''), 2000);
  };

  const toggleItem = (key: MenuKey) => {
    setActive(prev => ({ ...prev, [key]: !prev[key] }));
    setMessage(active[key] ? 'Menu item deactivated.' : 'Menu item activated.');
    window.setTimeout(() => setMessage(''), 2000);
  };

  const addMenuItem = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const price = Number(newPrice);

    if (!name || !Number.isFinite(price) || price < 0) return;

    setMessage(
      'New menu item form saved locally. A new database item requires a unique item code.'
    );
    setNewName('');
    setNewPrice('');
    window.setTimeout(() => setMessage(''), 3500);
  };

  return (
    <div className="w-full min-w-0">
      <div className="mb-5">
        <h3 className="text-xl font-bold text-gray-800 sm:text-2xl">
          Menu Management
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Edit menu names, prices, and active status.
        </p>
      </div>

      {message && (
        <div className="mb-4 rounded-md bg-green-100 p-3 text-sm text-green-700">
          {message}
        </div>
      )}

      <div className="mb-6 space-y-3">
        {items.map(item => (
          <div
            key={item.key}
            className="rounded-lg border bg-white p-3 shadow-sm sm:p-4"
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_160px_auto] lg:items-end">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-gray-500">
                  Menu name
                </label>
                <input
                  value={names[item.key]}
                  onChange={e =>
                    setNames(prev => ({ ...prev, [item.key]: e.target.value }))
                  }
                  className="w-full rounded-md border px-3 py-2.5"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-gray-500">
                  Price
                </label>
                <div className="flex">
                  <span className="rounded-l-md border border-r-0 bg-gray-50 px-3 py-2.5 text-gray-500">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={item.price}
                    onChange={e => updatePrice(item.key, e.target.value)}
                    className="w-full rounded-r-md border px-3 py-2.5"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveName(item.key)}
                  className="flex-1 rounded-md bg-primary-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-primary-700 lg:flex-none"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => toggleItem(item.key)}
                  className={`flex-1 rounded-md px-3 py-2.5 text-sm font-medium text-white lg:flex-none ${
                    active[item.key]
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {active[item.key] ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>

            <p className="mt-2 text-xs text-gray-500">
              Status: {active[item.key] ? 'Active' : 'Inactive'}
            </p>
          </div>
        ))}
      </div>

      <form
        onSubmit={addMenuItem}
        className="rounded-lg border bg-gray-50 p-3 sm:p-4"
      >
        <h4 className="mb-3 font-semibold text-gray-800">Add Menu Item</h4>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <input
            required
            placeholder="New menu item name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full rounded-md border px-3 py-2.5"
          />

          <input
            required
            type="number"
            min="0"
            step="0.5"
            placeholder="Price"
            value={newPrice}
            onChange={e => setNewPrice(e.target.value)}
            className="w-full rounded-md border px-3 py-2.5"
          />

          <button
            type="submit"
            className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 sm:w-auto"
          >
            Add Menu
          </button>
        </div>
      </form>
    </div>
  );
};

export default MenuManagement;

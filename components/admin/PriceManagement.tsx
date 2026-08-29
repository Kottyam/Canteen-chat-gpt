import React, { useEffect, useState } from 'react';
import { useData } from '../../context/DataContext';
import { Prices } from '../../types';

type MenuRow = {
  key: keyof Prices;
  label: string;
};

const MENU: MenuRow[] = [
  { key: 'morningTea', label: 'Morning Tea' },
  { key: 'lunchMeals', label: 'Lunch: Meals' },
  { key: 'lunchEgg', label: 'Lunch: Egg (add-on)' },
  { key: 'lunchFishMeat', label: 'Lunch: Fish/Meat (add-on)' },
  { key: 'eveningTea', label: 'Evening Tea' },
];

const PriceManagement: React.FC = () => {
  const { prices, setPrices, menuItems, setMenuItems } = useData();
  const [currentPrices, setCurrentPrices] = useState<Prices>(prices);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setCurrentPrices(prices);
  }, [prices]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const key = name as keyof Prices;
    setCurrentPrices(prev => ({ ...prev, [key]: Math.max(0, Number(value)) }));
  };

  const savePrices = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Update both sources used by the app: Prices and menuItems. This makes the
    // new amount visible immediately on employee screens instead of waiting for
    // the next Supabase refresh.
    setPrices(currentPrices);
    setMenuItems(prev => prev.map(item => {
      if (!(item.itemCode in currentPrices)) return item;
      const key = item.itemCode as keyof Prices;
      return { ...item, unitPrice: currentPrices[key] };
    }));

    setSuccess('Prices updated successfully.');
    window.setTimeout(() => setSuccess(''), 3000);
  };

  const resetPrices = () => {
    setCurrentPrices(prices);
    setError('');
    setSuccess('Changes reset.');
    window.setTimeout(() => setSuccess(''), 2000);
  };

  return (
    <div className="w-full min-w-0">
      <div className="mb-5">
        <h3 className="text-xl font-bold text-gray-800 sm:text-2xl">Price Setup</h3>
        <p className="mt-1 text-sm text-gray-500">
          Edit the current prices. Use Menu Management for adding, renaming or deactivating menu items.
        </p>
      </div>

      {success && (
        <div className="mb-4 rounded-md bg-green-100 p-3 text-sm text-green-700">
          {success}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={savePrices} className="w-full max-w-2xl space-y-3">
        {MENU.map(({ key, label }) => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-lg border bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4"
          >
            <label htmlFor={`price-${key}`} className="text-sm font-medium text-gray-700 sm:text-base">
              {label}
            </label>

            <div className="flex w-full items-center sm:w-40">
              <span className="rounded-l-md border border-r-0 bg-gray-50 px-3 py-2 text-gray-500">₹</span>
              <input
                id={`price-${key}`}
                type="number"
                name={key}
                value={currentPrices[key]}
                onChange={handleChange}
                min="0"
                step="0.5"
                inputMode="decimal"
                className="w-full rounded-r-md border border-gray-300 px-3 py-2 text-right focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2 pt-2 sm:flex-row">
          <button
            type="submit"
            className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 sm:w-auto"
          >
            Save Prices
          </button>
          <button
            type="button"
            onClick={resetPrices}
            className="w-full rounded-md bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 sm:w-auto"
          >
            Reset
          </button>
        </div>
      </form>
    </div>
  );
};

export default PriceManagement;

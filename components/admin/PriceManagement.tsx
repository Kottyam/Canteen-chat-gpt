
import React, { useState } from 'react';
import { useData } from '../../context/DataContext';
import { Prices } from '../../types';

const PriceManagement: React.FC = () => {
    const { prices, setPrices } = useData();
    const [currentPrices, setCurrentPrices] = useState<Prices>(prices);
    const [success, setSuccess] = useState('');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setCurrentPrices(prev => ({ ...prev, [name]: Number(value) }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setPrices(currentPrices);
        setSuccess('Prices updated successfully!');
        setTimeout(() => setSuccess(''), 3000);
    };
    
    const PriceInput: React.FC<{name: keyof Prices; label: string}> = ({name, label}) => (
         <div>
            <label htmlFor={name} className="block text-sm font-medium text-gray-700">{label}</label>
            <div className="relative mt-1 rounded-md shadow-sm">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <span className="text-gray-500 sm:text-sm">₹</span>
                </div>
                <input
                    type="number"
                    name={name}
                    id={name}
                    value={currentPrices[name]}
                    onChange={handleChange}
                    className="block w-full py-2 pl-7 pr-12 border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    placeholder="0.00"
                    min="0"
                    step="0.5"
                />
            </div>
        </div>
    );

    return (
        <div>
            <h3 className="mb-6 text-2xl font-bold text-gray-800">Price Setup</h3>
             {success && <div className="p-3 mb-4 text-sm text-green-700 bg-green-100 rounded-md">{success}</div>}
            <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
                <PriceInput name="morningTea" label="Morning Tea" />
                <PriceInput name="lunchMeals" label="Lunch: Meals" />
                <PriceInput name="lunchEgg" label="Lunch: Egg (add-on)" />
                <PriceInput name="lunchFishMeat" label="Lunch: Fish/Meat (add-on)" />
                <PriceInput name="eveningTea" label="Evening Tea" />
                
                <div className="pt-2">
                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md shadow-sm bg-primary-600 hover:bg-primary-700">Save Prices</button>
                </div>
            </form>
        </div>
    );
};

export default PriceManagement;
   
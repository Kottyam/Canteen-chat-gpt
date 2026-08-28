
import React, { useState } from 'react';
import Header from '../shared/Header';
import OrderForm from './OrderForm';
import OrderCalendar from './OrderCalendar';
import ChangePasswordModal from '../auth/ChangePasswordModal';

const EmployeeDashboard: React.FC = () => {
    const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);

    return (
        <div className="min-h-screen bg-gray-100">
            <Header onChangePassword={() => setPasswordModalOpen(true)} />
            <main className="container p-4 mx-auto sm:p-6 lg:p-8">
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    <div className="lg:col-span-1">
                         <h2 className="mb-4 text-2xl font-bold text-gray-800">Place Your Order</h2>
                        <OrderForm />
                    </div>
                    <div className="lg:col-span-2">
                         <h2 className="mb-4 text-2xl font-bold text-gray-800">Your Order History</h2>
                        <OrderCalendar />
                    </div>
                </div>
            </main>
            <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setPasswordModalOpen(false)} />
        </div>
    );
};

export default EmployeeDashboard;
   
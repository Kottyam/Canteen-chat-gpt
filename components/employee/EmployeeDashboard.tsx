import React, { useState } from 'react';
import Header from '../shared/Header';
import OrderForm from './OrderForm';
import OrderCalendar from './OrderCalendar';
import ChangePasswordModal from '../auth/ChangePasswordModal';

const EmployeeDashboard: React.FC = () => {
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-gray-100 pb-14">
      <Header onChangePassword={() => setPasswordModalOpen(true)} />

      <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
          <section className="min-w-0">
            <h2 className="mb-3 text-xl font-bold text-gray-800 sm:text-2xl">Place Your Order</h2>
            <OrderForm />
          </section>
          <section className="min-w-0">
            <h2 className="mb-3 text-xl font-bold text-gray-800 sm:text-2xl">Your Order History</h2>
            <OrderCalendar />
          </section>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-3 py-2 text-center text-xs text-gray-500 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden">
        Go Canteen • Employee Panel
      </div>

      <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setPasswordModalOpen(false)} />
    </div>
  );
};

export default EmployeeDashboard;

import React, { useState } from 'react';
import Header from '../shared/Header';
import ChangePasswordModal from '../auth/ChangePasswordModal';
import EmployeeManagement from './EmployeeManagement';
import PriceManagement from './PriceManagement';
import MenuManagement from './MenuManagement';
import MonthlyReport from './MonthlyReport';
import AllOrdersCalendar from './AllOrdersCalendar';
import DailySummary from './DailySummary';

type Tab = 'employees' | 'menu' | 'prices' | 'calendar' | 'summary' | 'reports';

const AdminDashboard: React.FC = () => {
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('employees');

  const tabs: { tabName: Tab; label: string }[] = [
    { tabName: 'employees', label: 'Employee' },
    { tabName: 'menu', label: 'Menu' },
    { tabName: 'prices', label: 'Prices' },
    { tabName: 'calendar', label: 'Orders / Calendar' },
    { tabName: 'summary', label: 'Daily Summary' },
    { tabName: 'reports', label: 'Monthly Reports' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'employees': return <EmployeeManagement />;
      case 'menu': return <MenuManagement />;
      case 'prices': return <PriceManagement />;
      case 'calendar': return <AllOrdersCalendar />;
      case 'summary': return <DailySummary />;
      case 'reports': return <MonthlyReport />;
    }
  };

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-gray-100">
      <Header onChangePassword={() => setPasswordModalOpen(true)} />
      <main className="mx-auto w-full max-w-7xl px-2 py-3 sm:px-5 sm:py-5">
        <nav className="mb-3 grid w-full grid-cols-2 gap-2 rounded-xl bg-gray-200 p-2 sm:grid-cols-3 lg:grid-cols-6">
          {tabs.map(({ tabName, label }) => (
            <button key={tabName} type="button" onClick={() => setActiveTab(tabName)}
              className={`min-h-12 w-full rounded-lg px-2 py-2 text-center text-sm font-semibold leading-tight sm:text-base ${
                activeTab === tabName ? 'bg-primary-600 text-white shadow' : 'text-gray-700 hover:bg-gray-300'
              }`}>
              {label}
            </button>
          ))}
        </nav>
        <section className="w-full min-w-0 rounded-xl bg-white p-3 shadow-md sm:p-6">{renderContent()}</section>
      </main>
      <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setPasswordModalOpen(false)} />
    </div>
  );
};
export default AdminDashboard;

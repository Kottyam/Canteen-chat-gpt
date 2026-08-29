import React, { useState } from 'react';
import Header from '../shared/Header';
import ChangePasswordModal from '../auth/ChangePasswordModal';
import EmployeeManagement from './EmployeeManagement';
import MenuManagement from './MenuManagement';
import WeeklyMenuManagement from './WeeklyMenuManagement';
import MonthlyReport from './MonthlyReport';
import AllOrdersCalendar from './AllOrdersCalendar';
import DailySummary from './DailySummary';

type Tab = 'employees' | 'weeklyMenu' | 'menu' | 'calendar' | 'summary' | 'reports';

const AdminDashboard: React.FC = () => {
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('employees');
  const tabs: { tabName: Tab; label: string }[] = [
    { tabName: 'employees', label: 'Employees' },
    { tabName: 'weeklyMenu', label: '7-Day Menu' },
    { tabName: 'menu', label: 'Menu & Prices' },
    { tabName: 'calendar', label: 'Orders / Calendar' },
    { tabName: 'summary', label: 'Daily Summary' },
    { tabName: 'reports', label: 'Monthly Reports' },
  ];
  const renderContent = () => {
    switch (activeTab) {
      case 'employees': return <EmployeeManagement />;
      case 'weeklyMenu': return <WeeklyMenuManagement />;
      case 'menu': return <MenuManagement />;
      case 'calendar': return <AllOrdersCalendar />;
      case 'summary': return <DailySummary />;
      case 'reports': return <MonthlyReport />;
    }
  };
  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-gray-100 pb-14">
      <Header onChangePassword={() => setPasswordModalOpen(true)} />
      <main className="mx-auto w-full max-w-7xl px-2 py-3 sm:px-5 sm:py-5">
        <nav className="mb-3 w-full rounded-xl bg-gray-200 p-2 shadow-sm">
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {tabs.map(({ tabName, label }) => (
              <button key={tabName} type="button" onClick={() => setActiveTab(tabName)}
                className={`min-h-12 w-full rounded-lg px-2 py-2 text-center text-sm font-semibold leading-tight sm:text-base ${activeTab === tabName ? 'bg-primary-600 text-white shadow' : 'text-gray-700 hover:bg-gray-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </nav>
        <section className="w-full min-w-0 rounded-xl bg-white p-3 shadow-md sm:p-6">{renderContent()}</section>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-3 py-2 text-center text-xs text-gray-500 shadow-[0_-2px_8px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden">Go Canteen • Admin Panel</div>
      <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setPasswordModalOpen(false)} />
    </div>
  );
};
export default AdminDashboard;

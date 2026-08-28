
import React, { useState } from 'react';
import Header from '../shared/Header';
import ChangePasswordModal from '../auth/ChangePasswordModal';
import EmployeeManagement from './EmployeeManagement';
import PriceManagement from './PriceManagement';
import MonthlyReport from './MonthlyReport';
import AllOrdersCalendar from './AllOrdersCalendar';
import DailySummary from './DailySummary';

type Tab = 'employees' | 'prices' | 'reports' | 'calendar' | 'summary';

const AdminDashboard: React.FC = () => {
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('employees');

  const renderContent = () => {
    switch (activeTab) {
      case 'employees':
        return <EmployeeManagement />;
      case 'prices':
        return <PriceManagement />;
      case 'calendar':
        return <AllOrdersCalendar />;
      case 'summary':
        return <DailySummary />;
      case 'reports':
        return <MonthlyReport />;
      default:
        return null;
    }
  };

  const TabButton: React.FC<{ tabName: Tab; label: string }> = ({
    tabName,
    label,
  }) => (
    <button
      type="button"
      onClick={() => setActiveTab(tabName)}
      className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
        activeTab === tabName
          ? 'bg-primary-600 text-white shadow'
          : 'text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-gray-100">
      <Header onChangePassword={() => setPasswordModalOpen(true)} />

      <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="mb-4 w-full">
          <div className="flex w-full max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-200 p-1 pb-2 sm:flex-wrap sm:overflow-visible">
            <TabButton tabName="employees" label="Employee Management" />
            <TabButton tabName="prices" label="Price Setup" />
            <TabButton tabName="calendar" label="All Orders Calendar" />
            <TabButton tabName="summary" label="Daily Summary" />
            <TabButton tabName="reports" label="Monthly Reports" />
          </div>
        </div>

        <div className="w-full min-w-0 rounded-lg bg-white p-3 shadow-md sm:p-6">
          {renderContent()}
        </div>
      </main>

      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
      />
    </div>
  );
};

export default AdminDashboard;
   

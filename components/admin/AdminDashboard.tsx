
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
            case 'reports':
                return <MonthlyReport />;
            case 'calendar':
                return <AllOrdersCalendar />;
            case 'summary':
                return <DailySummary />;
            default:
                return null;
        }
    };

    const TabButton: React.FC<{tabName: Tab; label: string}> = ({ tabName, label }) => (
        <button
            onClick={() => setActiveTab(tabName)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === tabName
                    ? 'bg-primary-600 text-white shadow'
                    : 'text-gray-600 hover:bg-gray-200'
            }`}
        >
            {label}
        </button>
    );

    return (
        <div className="min-h-screen bg-gray-100">
            <Header onChangePassword={() => setPasswordModalOpen(true)} />
            <main className="container p-4 mx-auto sm:p-6 lg:p-8">
                <div className="mb-6">
                    <div className="flex p-1 space-x-1 bg-gray-100 rounded-lg">
                        <TabButton tabName="employees" label="Employee Management" />
                        <TabButton tabName="prices" label="Price Setup" />
                        <TabButton tabName="calendar" label="All Orders Calendar" />
                        <TabButton tabName="summary" label="Daily Summary" />
                        <TabButton tabName="reports" label="Monthly Reports" />
                    </div>
                </div>
                <div className="p-6 bg-white rounded-lg shadow-md">
                    {renderContent()}
                </div>
            </main>
            <ChangePasswordModal isOpen={isPasswordModalOpen} onClose={() => setPasswordModalOpen(false)} />
        </div>
    );
};

export default AdminDashboard;
   
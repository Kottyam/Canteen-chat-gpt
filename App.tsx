import React, { useEffect, useState } from 'react';
import { DataProvider } from './context/DataContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/auth/Login';
import EmployeeDashboard from './components/employee/EmployeeDashboard';
import AdminDashboard from './components/admin/AdminDashboard';
import InitialPasswordChange from './components/auth/InitialPasswordChange';

const AppContent: React.FC = () => {
    const { user, loading } = useAuth();

    if (loading) return <div className="flex min-h-screen items-center justify-center bg-white"><span className="text-4xl font-extrabold text-primary-700">Go Canteen</span></div>;
    if (!user) return <Login />;
    if (user.role === 'employee' && user.isFirstLogin) return <InitialPasswordChange />;
    if (user.role === 'employee') return <EmployeeDashboard />;
    if (user.role === 'admin') return <AdminDashboard />;
    return <Login />;
};

const App: React.FC = () => {
    const [splash, setSplash] = useState(true);
    useEffect(() => {
        const timer = window.setTimeout(() => setSplash(false), 1000);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <DataProvider>
            <AuthProvider>
                {splash ? <div className="flex min-h-screen items-center justify-center bg-white"><span className="text-4xl font-extrabold text-primary-700">Go Canteen</span></div> : <AppContent />}
            </AuthProvider>
        </DataProvider>
    );
};

export default App;

import React, { useCallback, useState } from 'react';
import { DataProvider } from './context/DataContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/auth/Login';
import EmployeeDashboard from './components/employee/EmployeeDashboard';
import AdminDashboard from './components/admin/AdminDashboard';
import InitialPasswordChange from './components/auth/InitialPasswordChange';
import SplashScreen from './components/shared/SplashScreen';

const AppContent: React.FC = () => {
    const { user, loading } = useAuth();

    if (loading) {
        return <div className="flex min-h-screen items-center justify-center bg-white" />;
    }

    if (!user) return <Login />;
    if (user.role === 'employee' && user.isFirstLogin) return <InitialPasswordChange />;
    if (user.role === 'employee') return <EmployeeDashboard />;
    if (user.role === 'admin') return <AdminDashboard />;
    return <Login />;
};

const App: React.FC = () => {
    const [showSplash, setShowSplash] = useState(true);
    const finishSplash = useCallback(() => setShowSplash(false), []);

    return (
        <DataProvider>
            <AuthProvider>
                {showSplash && <SplashScreen onDone={finishSplash} />}
                <AppContent />
            </AuthProvider>
        </DataProvider>
    );
};

export default App;

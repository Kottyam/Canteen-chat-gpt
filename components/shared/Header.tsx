
import React from 'react';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
    onChangePassword: () => void;
}

const Header: React.FC<HeaderProps> = ({ onChangePassword }) => {
    const { user, logout } = useAuth();

    return (
        <header className="bg-white shadow-md">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center">
                        <svg className="w-8 h-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h18v2H3V3zm0 8h18v2H3v-2zm0 8h18v2H3v-2zM9 1h6v2H9V1zm0 8h6v2H9V9zm0 8h6v2H9v-2z" />
                        </svg>
                        <h1 className="ml-3 text-2xl font-bold text-primary-700">Go Canteen</h1>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="text-right">
                           <p className="text-sm font-medium text-gray-700">Welcome, {user?.id}</p>
                           <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
                        </div>
                        <button
                            onClick={onChangePassword}
                            className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                        >
                            Change Password
                        </button>
                        <button
                            onClick={logout}
                            className="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;
   
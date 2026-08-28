import React from 'react';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  onChangePassword: () => void;
}

const Header: React.FC<HeaderProps> = ({ onChangePassword }) => {
  const { user, logout } = useAuth();

  return (
    <header className="w-full overflow-hidden bg-white shadow-sm">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-5 lg:px-8">
        <div className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
              <span className="text-xl font-bold leading-none">☰</span>
            </div>
            <h1 className="truncate text-2xl font-bold leading-tight text-primary-700 sm:text-3xl">
              Go Canteen
            </h1>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_auto_auto] sm:items-center">
            <div className="min-w-0 text-left sm:text-right">
              <p className="truncate text-base font-semibold text-gray-700">
                Welcome, {user?.id}
              </p>
              <p className="text-sm capitalize text-gray-500">{user?.role}</p>
            </div>

            <button
              type="button"
              onClick={onChangePassword}
              className="min-h-11 w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 sm:w-auto"
            >
              Change Password
            </button>

            <button
              type="button"
              onClick={logout}
              className="min-h-11 w-full rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 sm:w-auto"
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

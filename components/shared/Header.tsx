import React from 'react';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  onChangePassword: () => void;
}

const Header: React.FC<HeaderProps> = ({ onChangePassword }) => {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full overflow-hidden border-b border-gray-200 bg-white shadow-sm">
      <div className="mx-auto w-full max-w-7xl px-4 pt-[max(10px,env(safe-area-inset-top))] pb-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-50 p-1.5">
              <img src="/logo.svg" alt="Go Canteen" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-extrabold leading-tight text-primary-700 sm:text-3xl">Go Canteen</h1>
              <p className="text-xs font-medium text-gray-500 sm:text-sm">Canteen Management</p>
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-[auto_auto_auto] sm:items-center">
            <div className="min-w-0 text-left sm:text-right">
              <p className="truncate text-base font-semibold text-gray-700">Welcome, {user?.id}</p>
              <p className="text-sm capitalize text-gray-500">{user?.role}</p>
            </div>
            <button type="button" onClick={onChangePassword} className="min-h-11 w-full rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 sm:w-auto">Change Password</button>
            <button type="button" onClick={logout} className="min-h-11 w-full rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 sm:w-auto">Logout</button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;

import React from 'react';
import { useAuth } from '../../context/AuthContext';

interface HeaderProps {
  onChangePassword: () => void;
}

const Header: React.FC<HeaderProps> = ({ onChangePassword }) => {
  const { user, logout } = useAuth();

  return (
    <header className="w-full overflow-hidden bg-white shadow-md">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4">
          <div className="flex min-w-0 items-center">
            <svg
              className="h-8 w-8 shrink-0 text-primary-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M3 3h18v2H3V3zm0 8h18v2H3v-2zm0 8h18v2H3v-2z"
              />
            </svg>
            <h1 className="ml-2 truncate text-2xl font-bold text-primary-700 sm:text-3xl">
              Go Canteen
            </h1>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <div className="min-w-0 flex-1 text-left sm:flex-none sm:text-right">
              <p className="truncate text-sm font-medium text-gray-700">
                Welcome, {user?.id}
              </p>
              <p className="text-xs capitalize text-gray-500">
                {user?.role}
              </p>
            </div>

            <button
              type="button"
              onClick={onChangePassword}
              className="whitespace-nowrap rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200"
            >
              Change Password
            </button>

            <button
              type="button"
              onClick={logout}
              className="whitespace-nowrap rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
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

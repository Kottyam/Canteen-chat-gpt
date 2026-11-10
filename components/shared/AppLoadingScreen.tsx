import React from 'react';

/** Shared branded loading view for auth restore, logout, and OAuth callback gaps. No timer, no extra tagline. */
const AppLoadingScreen: React.FC = () => (
  <div
    data-testid="app-loading"
    role="status"
    aria-busy="true"
    aria-label="Go Canteen"
    className="flex min-h-screen flex-col items-center justify-center bg-white px-8"
    style={{ backgroundColor: '#ffffff' }}
  >
    <img src="/gocanteen-icon.png" alt="Go Canteen" className="h-24 w-24 object-contain" />
    <p className="mt-4 text-2xl font-extrabold tracking-tight text-primary-700">Go Canteen</p>
  </div>
);

export default AppLoadingScreen;

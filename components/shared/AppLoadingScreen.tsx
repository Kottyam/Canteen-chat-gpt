import React from 'react';

export type AppLoadingVariant = 'icon' | 'wordmark';

/** Shown only while a real auth/subscription gap lasts. Green wordmark, no icon, no delay or fade. */
const AppLoadingScreen: React.FC<{ variant?: AppLoadingVariant }> = () => {
  return (
    <div
      data-testid="app-loading"
      data-variant="wordmark"
      role="status"
      aria-busy="true"
      aria-label="Go Canteen"
      className="flex min-h-screen flex-col items-center justify-center bg-white px-8"
      style={{ backgroundColor: '#ffffff' }}
    >
      <p className="text-2xl font-extrabold tracking-tight text-primary-800">Go Canteen</p>
    </div>
  );
};

export default AppLoadingScreen;

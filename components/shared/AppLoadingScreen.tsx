import React from 'react';
import { hasAppPresented } from '../../utils/appSession';

export type AppLoadingVariant = 'icon' | 'wordmark';

/** First cold-start paint: crisp icon only. Later gaps: green wordmark only. No fade or pulse. */
const AppLoadingScreen: React.FC<{ variant?: AppLoadingVariant }> = ({ variant }) => {
  const mode: AppLoadingVariant = variant ?? (hasAppPresented() ? 'wordmark' : 'icon');
  return (
    <div
      data-testid="app-loading"
      data-variant={mode}
      role="status"
      aria-busy="true"
      aria-label="Go Canteen"
      className="flex min-h-screen flex-col items-center justify-center bg-white px-8"
      style={{ backgroundColor: '#ffffff' }}
    >
      {mode === 'icon' ? (
        <img
          src="/gocanteen-icon.png"
          alt="Go Canteen"
          className="h-24 w-24 object-contain"
          style={{ opacity: 1 }}
        />
      ) : (
        <p className="text-2xl font-extrabold tracking-tight text-primary-800">Go Canteen</p>
      )}
    </div>
  );
};

export default AppLoadingScreen;

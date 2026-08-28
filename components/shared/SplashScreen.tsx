import React, { useEffect } from 'react';

interface SplashScreenProps {
  onDone: () => void;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ onDone }) => {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 1400);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-white px-8">
      <div className="flex w-full max-w-xs flex-col items-center justify-center text-center">
        <img src="/logo.svg" alt="Go Canteen" className="h-auto w-[min(72vw,280px)] object-contain" />
        <div className="mt-5 h-1 w-20 overflow-hidden rounded-full bg-primary-100">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary-600" />
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;

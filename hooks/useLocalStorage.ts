import { useEffect, useState } from 'react';

export function useLocalStorage<T,>(key: string, initialValue: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const jsonValue = window.localStorage.getItem(key);
      if (jsonValue !== null) return JSON.parse(jsonValue) as T;
    } catch {
      // Fall back to the supplied default.
    }

    return typeof initialValue === 'function'
      ? (initialValue as () => T)()
      : initialValue;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage quota/private-mode failures.
    }
  }, [key, value]);

  return [value, setValue] as [T, React.Dispatch<React.SetStateAction<T>>];
}

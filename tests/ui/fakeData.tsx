import React from 'react';
export const state: any = { menuItems: [], prices: {}, orders: [], users: [] };
export const DataProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => <>{children}</>;
export const useData = () => ({ ...state, refreshOrders: async () => {}, refreshAdjustments: async () => {} } as any);

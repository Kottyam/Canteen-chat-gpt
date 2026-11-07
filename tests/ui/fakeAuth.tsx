import React from 'react';
export const state: { user: any; perms: string[] } = { user: { id: 'M001', name: 'Member', role: 'employee' }, perms: [] };
export const ADMIN_PERMISSIONS: any[] = [];
export const AuthProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => <>{children}</>;
export const useAuth = () => ({ user: state.user, hasPermission: (p: string) => state.perms.includes(p), isOwner: false, logout() {}, login() {} } as any);

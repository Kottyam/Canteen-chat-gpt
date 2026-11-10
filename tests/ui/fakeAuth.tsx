import React from 'react';
export const state: { user: any; perms: string[]; loading: boolean; googleOAuthInProgress: boolean } = { user: { id: 'M001', name: 'Member', role: 'employee' }, perms: [], loading: false, googleOAuthInProgress: false };
export const ADMIN_PERMISSIONS: any[] = [];
export const AuthProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => <>{children}</>;
export const useAuth = () => ({ user: state.user, loading: state.loading, googleOAuthInProgress: state.googleOAuthInProgress, googleOAuthError: null, hasPermission: (p: string) => state.perms.includes(p), isOwner: false, logout() {}, login() {}, loginWithGoogle: async () => ({ ok: true }), loginWithCredentials: async () => ({ ok: true }) } as any);

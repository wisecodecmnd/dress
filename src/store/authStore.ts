import { create } from 'zustand';
import { api } from '../services/api';
import type { User } from '../types';
import { useUIStore } from './uiStore';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  /** True until the initial /auth/me probe resolves, so guards don't flash. */
  isLoading: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (body: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  init: async () => {
    try {
      const { user } = await api.me();
      set({ user, isAuthenticated: true });
    } catch {
      // Not signed in — expected for guests, no toast.
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    try {
      const { user } = await api.login(email, password);
      set({ user, isAuthenticated: true });
      useUIStore.getState().showToast(`Welcome back, ${user.firstName ?? 'friend'}`, 'success');
      return true;
    } catch (err) {
      useUIStore
        .getState()
        .showToast(err instanceof Error ? err.message : 'Sign in failed', 'error');
      return false;
    }
  },

  register: async (body) => {
    try {
      const { user } = await api.register(body);
      set({ user, isAuthenticated: true });
      useUIStore.getState().showToast('Account created', 'success');
      return true;
    } catch (err) {
      useUIStore
        .getState()
        .showToast(err instanceof Error ? err.message : 'Registration failed', 'error');
      return false;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null, isAuthenticated: false });
    }
  },
}));

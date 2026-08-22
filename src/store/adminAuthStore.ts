import { create } from 'zustand';
import { adminApi } from '../services/adminApi';
import type { AdminUser } from '../types/admin';

/**
 * Admin session state.
 *
 * Nothing is persisted client-side — the session lives entirely in the
 * httpOnly cookie the API sets, and `init()` re-validates it against
 * /api/admin/me on every load. That means the role check is always the
 * server's answer, never a value the browser could have edited.
 */
interface AdminAuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  /** True until the first /me probe resolves, so the guard doesn't flash. */
  isLoading: boolean;
  error: string | null;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAdminAuthStore = create<AdminAuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  init: async () => {
    try {
      const { user } = await adminApi.me();
      set({ user, isAuthenticated: true, error: null });
    } catch {
      // Not signed in, or signed in as a customer — either way, no admin access.
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const { user } = await adminApi.login(email, password);
      set({ user, isAuthenticated: true, isLoading: false, error: null });
      return true;
    } catch (err) {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Sign in failed',
      });
      return false;
    }
  },

  logout: async () => {
    try {
      await adminApi.logout();
    } finally {
      set({ user: null, isAuthenticated: false, error: null });
    }
  },
}));

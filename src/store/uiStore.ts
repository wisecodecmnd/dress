import { create } from 'zustand';
import type { ToastKind } from '../types';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface UIState {
  isCartOpen: boolean;
  isMenuOpen: boolean;
  isSearchOpen: boolean;
  toasts: Toast[];
  openCart: () => void;
  closeCart: () => void;
  toggleMenu: () => void;
  closeMenu: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  showToast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useUIStore = create<UIState>((set) => ({
  isCartOpen: false,
  isMenuOpen: false,
  isSearchOpen: false,
  toasts: [],

  openCart: () => set({ isCartOpen: true, isMenuOpen: false }),
  closeCart: () => set({ isCartOpen: false }),
  toggleMenu: () => set((s) => ({ isMenuOpen: !s.isMenuOpen, isCartOpen: false })),
  closeMenu: () => set({ isMenuOpen: false }),
  openSearch: () => set({ isSearchOpen: true, isMenuOpen: false }),
  closeSearch: () => set({ isSearchOpen: false }),

  showToast: (message, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    // Auto-dismiss; Toast also renders a manual close for a11y.
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3200);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

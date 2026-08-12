import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../services/api';
import type { Product, WishlistItem } from '../types';
import { useAuthStore } from './authStore';

interface WishlistState {
  items: WishlistItem[];
  addItem: (productId: string, product: Product) => void;
  removeItem: (itemId: string) => void;
  has: (productId: string) => boolean;
  fetchWishlist: () => Promise<void>;
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (productId, product) => {
        if (get().items.some((i) => i.productId === productId)) return;
        set({ items: [...get().items, { id: productId, productId, product }] });

        if (useAuthStore.getState().isAuthenticated) {
          void api.addToWishlist(productId).catch(() => {});
        }
      },

      removeItem: (itemId) => {
        set({ items: get().items.filter((i) => i.id !== itemId) });

        if (useAuthStore.getState().isAuthenticated) {
          void api.removeWishlistItem(itemId).catch(() => {});
        }
      },

      has: (productId) => get().items.some((i) => i.productId === productId),

      fetchWishlist: async () => {
        if (!useAuthStore.getState().isAuthenticated) return;
        try {
          const { items } = await api.getWishlist();
          set({ items });
        } catch {
          // Keep the local list if the API is unreachable.
        }
      },
    }),
    { name: 'denimque.wishlist' },
  ),
);

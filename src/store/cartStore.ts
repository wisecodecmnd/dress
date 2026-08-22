import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../services/api';
import type { CartItem, Product } from '../types';
import { useAuthStore } from './authStore';

const money = (v: string | number) => Number(v) || 0;

const totals = (items: CartItem[]) => ({
  subtotal: items.reduce((sum, i) => sum + money(i.product.price) * i.quantity, 0),
  count: items.reduce((sum, i) => sum + i.quantity, 0),
});

interface CartState {
  items: CartItem[];
  subtotal: number;
  count: number;
  /**
   * `product` is required for guest carts because the cart is rendered straight
   * from localStorage with no network round-trip. Signed-in carts are
   * reconciled against the server by `sync()`.
   */
  addItem: (productId: string, size: string, quantity: number, product: Product) => void;
  updateItem: (itemId: string, quantity: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  sync: () => Promise<void>;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      subtotal: 0,
      count: 0,

      addItem: (productId, size, quantity, product) => {
        const items = [...get().items];
        const existing = items.find((i) => i.productId === productId && i.size === size);
        // Provisional id for guests and for the moment before the server
        // answers; replaced below with the real CartItem id once it does.
        const localId = `${productId}:${size}`;

        if (existing) {
          existing.quantity += quantity;
        } else {
          items.push({ id: localId, productId, product, size, quantity });
        }

        set({ items, ...totals(items) });

        if (useAuthStore.getState().isAuthenticated) {
          // Mirror to the server cart, then adopt the row id it assigned.
          // Without this, later PATCH/DELETE calls address `productId:size`,
          // which the API doesn't know — so the server cart (and the admin's
          // view of it) would silently stop tracking the customer's changes.
          void api
            .addToCart({ productId, size, quantity })
            .then(({ item }) => {
              const current = get().items.map((i) =>
                i.productId === productId && i.size === size ? { ...i, id: item.id } : i,
              );
              set({ items: current, ...totals(current) });
            })
            .catch(() => {});
        }
      },

      updateItem: (itemId, quantity) => {
        if (quantity < 1) return get().removeItem(itemId);
        const items = get().items.map((i) => (i.id === itemId ? { ...i, quantity } : i));
        set({ items, ...totals(items) });

        if (useAuthStore.getState().isAuthenticated) {
          // A rejected write means local state has drifted from the server
          // (e.g. an id left over from a guest session) — reconcile rather than
          // carry on showing a quantity the server never received.
          void api.updateCartItem(itemId, quantity).catch(() => void get().sync());
        }
      },

      removeItem: (itemId) => {
        const items = get().items.filter((i) => i.id !== itemId);
        set({ items, ...totals(items) });

        if (useAuthStore.getState().isAuthenticated) {
          void api.removeCartItem(itemId).catch(() => void get().sync());
        }
      },

      clearCart: () => set({ items: [], subtotal: 0, count: 0 }),

      sync: async () => {
        if (!useAuthStore.getState().isAuthenticated) return;
        try {
          const { items } = await api.getCart();
          if (items.length) set({ items, ...totals(items) });
        } catch {
          // Offline or API down — keep the persisted local cart.
        }
      },
    }),
    {
      name: 'denimque.cart',
      // Recompute derived totals on rehydrate so a stale persisted total can't leak.
      onRehydrateStorage: () => (state) => {
        if (state) {
          const t = totals(state.items);
          state.subtotal = t.subtotal;
          state.count = t.count;
        }
      },
    },
  ),
);

import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { authLimiter, writeLimiter } from '../middleware/rateLimit.js';

import * as products from '../controllers/productController.js';
import * as auth from '../controllers/authController.js';
import * as cart from '../controllers/cartController.js';
import * as wishlist from '../controllers/wishlistController.js';
import * as orders from '../controllers/orderController.js';
import * as payments from '../controllers/paymentController.js';
import * as users from '../controllers/userController.js';
import * as contact from '../controllers/contactController.js';
import * as customization from '../controllers/customizationController.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Catalogue (public) ──────────────────────────────────────────────────────
router.get('/products', validate(products.listQuerySchema, 'query'), products.listProducts);
router.get('/products/:slug', products.getProduct);
router.get('/categories', products.listCategories);
router.get('/search', validate(products.searchQuerySchema, 'query'), products.searchProducts);

// ── Auth ────────────────────────────────────────────────────────────────────
router.post('/auth/register', authLimiter, validate(auth.registerSchema), auth.register);
router.post('/auth/login', authLimiter, validate(auth.loginSchema), auth.login);
router.post('/auth/logout', auth.logout);
router.get('/auth/me', requireAuth, auth.me);

// ── Account ─────────────────────────────────────────────────────────────────
router.get('/users/addresses', requireAuth, users.listAddresses);
router.post('/users/addresses', requireAuth, validate(users.addressSchema), users.createAddress);
router.delete('/users/addresses/:id', requireAuth, users.deleteAddress);
router.patch('/users/me', requireAuth, validate(users.profileSchema), users.updateProfile);

// ── Cart (signed in; guests keep their cart in localStorage) ─────────────────
router.get('/cart', requireAuth, cart.getCart);
router.post('/cart', requireAuth, validate(cart.addItemSchema), cart.addItem);
router.patch('/cart/:itemId', requireAuth, validate(cart.updateItemSchema), cart.updateItem);
router.delete('/cart/:itemId', requireAuth, cart.removeItem);

// ── Wishlist ────────────────────────────────────────────────────────────────
router.get('/wishlist', requireAuth, wishlist.getWishlist);
router.post('/wishlist', requireAuth, validate(wishlist.addSchema), wishlist.addItem);
router.delete('/wishlist/:itemId', requireAuth, wishlist.removeItem);

// ── Orders (guest checkout allowed) ─────────────────────────────────────────
router.post(
  '/orders',
  writeLimiter,
  optionalAuth,
  validate(orders.createOrderSchema),
  orders.createOrder,
);
router.get('/orders', requireAuth, orders.listOrders);
router.get('/orders/:id', optionalAuth, orders.getOrder);

// ── Payments ────────────────────────────────────────────────────────────────
router.post(
  '/payments/intent',
  writeLimiter,
  optionalAuth,
  validate(payments.intentSchema),
  payments.createIntent,
);
router.post('/payments/confirm', validate(payments.confirmSchema), payments.confirmPayment);

// ── Contact ─────────────────────────────────────────────────────────────────
router.post('/contact', writeLimiter, validate(contact.contactSchema), contact.submitContact);

// ── Customization ───────────────────────────────────────────────────────────
router.get('/customization/options', customization.getOptions);
router.post(
  '/customization',
  writeLimiter,
  optionalAuth,
  validate(customization.saveSchema),
  customization.saveCustomization,
);

export default router;

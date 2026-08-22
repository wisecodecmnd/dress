import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { verifyOrigin } from '../middleware/csrf.js';
import { authLimiter } from '../middleware/rateLimit.js';

import * as adminAuth from '../controllers/admin/authController.js';
import * as dashboard from '../controllers/admin/dashboardController.js';
import * as categories from '../controllers/admin/categoryController.js';
import * as products from '../controllers/admin/productController.js';
import * as processes from '../controllers/admin/processController.js';
import * as customers from '../controllers/admin/customerController.js';
import * as carts from '../controllers/admin/cartController.js';
import * as orders from '../controllers/admin/orderController.js';
import * as paymentsAdmin from '../controllers/admin/paymentController.js';
import * as production from '../controllers/admin/productionController.js';
import * as ops from '../controllers/admin/activityController.js';
import * as exports from '../controllers/admin/exportController.js';

/**
 * Every route below /api/admin except `login` requires a valid session *and*
 * the ADMIN role, enforced server-side. Frontend route guards are cosmetic;
 * this is the boundary that matters.
 */
const router = Router();

// ── Public: admin sign-in ───────────────────────────────────────────────────
router.post('/login', authLimiter, validate(adminAuth.loginSchema), adminAuth.login);

// ── Everything past here is admin-only ──────────────────────────────────────
router.use(verifyOrigin, requireAuth, requireAdmin);

router.get('/me', adminAuth.me);
router.post('/logout', adminAuth.logout);

router.get('/dashboard', dashboard.getDashboard);

// Categories
router.get('/categories', validate(categories.listQuerySchema, 'query'), categories.listCategories);
router.post('/categories', validate(categories.createSchema), categories.createCategory);
router.post('/categories/reorder', validate(categories.reorderSchema), categories.reorderCategories);
router.get('/categories/:id', categories.getCategory);
router.patch('/categories/:id', validate(categories.updateSchema), categories.updateCategory);
router.delete('/categories/:id', categories.deleteCategory);
router.post('/categories/:id/restore', categories.restoreCategory);

// Products
router.get('/products', validate(products.listQuerySchema, 'query'), products.listProducts);
router.post('/products', validate(products.createSchema), products.createProduct);
router.get('/products/:id', products.getProduct);
router.patch('/products/:id', validate(products.updateSchema), products.updateProduct);
router.delete('/products/:id', products.deleteProduct);
router.post('/products/:id/restore', products.restoreProduct);

// Per-product process configuration
router.get('/products/:id/processes', processes.getProductProcesses);
router.post('/products/:id/processes', validate(processes.attachSchema), processes.attachProcess);
router.post(
  '/products/:id/processes/reorder',
  validate(processes.reorderProcessesSchema),
  processes.reorderProcesses,
);
router.post('/products/:id/processes/apply-defaults', processes.applyDefaults);
router.patch(
  '/products/:id/processes/:processId',
  validate(processes.updateProcessSchema),
  processes.updateProcess,
);
router.delete('/products/:id/processes/:processId', processes.detachProcess);

// Process stage library
router.get('/processes', validate(processes.listQuerySchema, 'query'), processes.listStages);
router.post('/processes', validate(processes.createStageSchema), processes.createStage);
router.post('/processes/reorder', validate(processes.reorderStagesSchema), processes.reorderStages);
router.patch('/processes/:id', validate(processes.updateStageSchema), processes.updateStage);
router.delete('/processes/:id', processes.deleteStage);

// Customers
router.get('/customers', validate(customers.listQuerySchema, 'query'), customers.listCustomers);
router.get('/customers/:id', customers.getCustomer);
router.patch('/customers/:id', validate(customers.updateSchema), customers.updateCustomer);

// Live cart activity
router.get('/carts', validate(carts.listQuerySchema, 'query'), carts.listCarts);
router.get('/carts/summary', carts.cartSummary);

// Orders
router.get('/orders', validate(orders.listQuerySchema, 'query'), orders.listOrders);
router.get('/orders/summary', orders.orderSummary);
router.get('/orders/:id', orders.getOrder);
router.patch('/orders/:id', validate(orders.updateSchema), orders.updateOrder);
router.post('/orders/:id/refund', validate(orders.refundSchema), orders.refundOrder);

// Payment configuration — read-only, and secret-free by construction.
router.get('/payments/config', paymentsAdmin.getPaymentConfig);

// Production
router.get('/production', validate(production.listQuerySchema, 'query'), production.listProduction);
router.get('/production/summary', production.productionSummary);
router.get('/production/:id', production.getPlan);
router.patch('/production/:id', validate(production.planUpdateSchema), production.updatePlan);
router.post('/production/:id/start', production.startProduction);
router.post('/production/:id/rebuild', production.rebuildPlan);
router.patch(
  '/production/:id/stages/:stageId',
  validate(production.stageUpdateSchema),
  production.updateStage,
);

// Activity + settings
router.get('/activity', validate(ops.listQuerySchema, 'query'), ops.listActivity);
router.get('/settings', ops.readSettings);
router.patch('/settings', validate(ops.patchSettingsSchema), ops.writeSettings);

// Export
router.get('/export', validate(exports.querySchema, 'query'), exports.exportCsv);

export default router;

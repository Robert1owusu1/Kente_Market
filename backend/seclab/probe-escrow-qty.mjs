// RED-TEAM PROBE (read-mostly): proves whether escrow allocations are computed
// from the order line quantity. Creates a throwaway vendor + product + order,
// inspects the allocation rows, then deletes everything it created.
import pool from '../config/db.js';
import bcrypt from 'bcryptjs';
import { createEscrowAllocations, getOrderAllocations } from '../Services/escrowService.js';

const RUN = `rt-${Date.now()}`;
let vendorId = null;
let orderId = null;
let productId = null;
let userId = null;

try {
  const [u] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('RedTeam','Probe', ?, ?, 'vendor', 1, 1)`,
    [`${RUN}@redteam.local`, await bcrypt.hash('x-not-a-real-password-1!', 4)]
  );
  vendorId = u.insertId;
  await pool.execute(
    `INSERT INTO vendors (userId, businessName, status) VALUES (?, ?, 'approved')`,
    [vendorId, `Probe ${RUN}`]
  );
  const [cu] = await pool.execute(
    `INSERT INTO users (firstName, lastName, email, password, role, isActive, is_email_verified)
     VALUES ('RedTeam','Buyer', ?, ?, 'customer', 1, 1)`,
    [`buyer-${RUN}@redteam.local`, await bcrypt.hash('x-not-a-real-password-1!', 4)]
  );
  userId = cu.insertId;

  const [p] = await pool.execute(
    `INSERT INTO product (title, price, img, stock, madeToOrder, approvalStatus, vendorId, category)
     VALUES (?, 100, '/uploads/x.png', 50, FALSE, 'approved', ?, 'Kente')`,
    [`Probe product ${RUN}`, vendorId]
  );
  productId = p.insertId;

  // EXACT line shape produced by orderController.addOrderItems (note: `qty`, no `quantity`)
  const items = [
    { product: productId, name: 'Probe', qty: 3, price: 100, vendorId, reserved: 3 },
  ];

  const [o] = await pool.execute(
    `INSERT INTO orders (userId, orderNumber, items, totalAmount, paymentStatus, orderStatus, shippingCost, tax, discount)
     VALUES (?, ?, ?, 360, 'pending', 'pending', 15, 45, 0)`,
    [userId, `RT-${RUN}`, JSON.stringify(items)]
  );
  orderId = o.insertId;

  await createEscrowAllocations(orderId, items, { discount: 0 });
  const allocs = await getOrderAllocations(orderId);

  const sum = allocs.reduce((s, a) => s + parseFloat(a.amount), 0);
  console.log(JSON.stringify({
    orderLine: items[0],
    orderTotalAmount: 360,
    expectedVendorAllocation: 300,   // qty 3 * price 100
    actualAllocationSum: sum,
    allocations: allocs.map(a => ({ amount: a.amount, payoutAmount: a.payoutAmount, status: a.status })),
    underpaidBy: 300 - sum,
    exploitable: sum < 300,
  }, null, 2));
} catch (e) {
  console.error('PROBE ERROR:', e.message);
} finally {
  try { if (orderId) await pool.execute(`DELETE FROM escrow_allocations WHERE orderId = ?`, [orderId]); } catch {}
  try { if (orderId) await pool.execute(`DELETE FROM orders WHERE id = ?`, [orderId]); } catch {}
  try { if (productId) await pool.execute(`DELETE FROM product WHERE id = ?`, [productId]); } catch {}
  try { if (vendorId) { await pool.execute(`DELETE FROM vendors WHERE userId = ?`, [vendorId]); } } catch {}
  try { if (vendorId) await pool.execute(`DELETE FROM vendor_wallets WHERE vendorId = ?`, [vendorId]); } catch {}
  try { if (vendorId) await pool.execute(`DELETE FROM users WHERE id IN (?, ?)`, [vendorId, userId]); } catch {}
  await pool.end();
}

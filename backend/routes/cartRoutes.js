// FILE LOCATION: routes/cartRoutes.js
// DESCRIPTION: Server-side cart API. Works for both signed-in users (JWT cookie)
//   and anonymous visitors (a persisted cart_guest cookie). The client keeps
//   localStorage as its instant source of truth; this API gives it cross-device
//   continuity and feeds the abandoned-cart recovery emails.
//     GET    /api/cart        → current stored items
//     POST   /api/cart        → overwrite stored items with the client's cart
//     POST   /api/cart/merge  → merge stored + client items, return combined
//     DELETE /api/cart        → clear stored items
//   All endpoints are anonymous-friendly and safe to call on every page load.

import express from 'express';
import crypto from 'crypto';
import Cart from '../models/cartModel.js';
import { optionalAuth } from '../middleware/authMiddleware.js';
import { apiLimiter } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

const GUEST_COOKIE = 'cart_guest';

// Resolve which cart this request belongs to, minting a guest cookie the first
// time an anonymous visitor lands. Logged-in users always use their userId cart
// so the same cart follows them across devices.
const resolveOwner = (req, res) => {
  if (req.user && req.user.id) {
    return { userId: parseInt(req.user.id, 10), guestId: null };
  }
  let guestId = req.cookies?.[GUEST_COOKIE] || null;
  if (!guestId) {
    guestId = crypto.randomUUID();
    res.cookie(GUEST_COOKIE, guestId, {
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  return { userId: null, guestId };
};

// Sanitize incoming items to the fields a cart should store, dropping anything
// that isn't a plain product line (avoids junk shapes polluting the table).
const sanitizeItems = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (item === null || typeof item !== 'object') return null;
      const productId = parseInt(item.product ?? item.productId ?? item.id, 10);
      if (!productId) return null;
      return {
        product: productId,
        name: typeof item.name === 'string' ? item.name.slice(0, 255) : (item.title || ''),
        qty: Math.max(1, parseInt(item.qty ?? item.quantity ?? 1, 10) || 1),
        price: Number(item.price ?? 0) || 0,
        image: typeof item.image === 'string' ? item.image.slice(0, 500) : null,
        selectedColor: typeof item.selectedColor === 'string' ? item.selectedColor : (item.color || null),
        selectedSize: typeof item.selectedSize === 'string' ? item.selectedSize : (item.size || null),
        yards: item.yards ?? item.selectedSize ?? null,
      };
    })
    .filter(Boolean)
    .slice(0, 50);
};

// GET /api/cart — fetch the stored cart (used to restore across devices).
router.get('/', optionalAuth, apiLimiter, async (req, res) => {
  try {
    const owner = resolveOwner(req, res);
    if (!owner.userId && !owner.guestId) {
      return res.json({ items: [], itemCount: 0 });
    }
    const cart = await Cart.findByOwner(owner);
    res.json({ items: cart?.items || [], itemCount: cart?.items?.length || 0 });
  } catch (error) {
    console.error('Error reading cart:', error.message);
    res.status(500).json({ message: 'Failed to load cart' });
  }
});

// POST /api/cart — overwrite the stored cart with the client's current items.
// The client is the source of truth for the session; the server persists a copy.
router.post('/', optionalAuth, apiLimiter, async (req, res) => {
  try {
    const owner = resolveOwner(req, res);
    const items = sanitizeItems(req.body?.items);
    const saved = await Cart.save({ ...owner, items });
    res.json({ items: saved.items, itemCount: saved.items.length });
  } catch (error) {
    console.error('Error saving cart:', error.message);
    res.status(500).json({ message: 'Failed to save cart' });
  }
});

// POST /api/cart/merge — combine the stored cart with the client's items
// (dedup by product+color+yards, quantities summed). Returns the merged list
// for the client to adopt, so both sides converge on one cart.
router.post('/merge', optionalAuth, apiLimiter, async (req, res) => {
  try {
    const owner = resolveOwner(req, res);
    if (!owner.userId && !owner.guestId) {
      return res.json({ items: sanitizeItems(req.body?.items), itemCount: 0 });
    }
    const stored = await Cart.findByOwner(owner);
    const incoming = sanitizeItems(req.body?.items);
    const merged = Cart.merge(stored?.items || [], incoming);
    const saved = await Cart.save({ ...owner, items: merged });
    res.json({ items: saved.items, itemCount: saved.items.length });
  } catch (error) {
    console.error('Error merging cart:', error.message);
    res.status(500).json({ message: 'Failed to merge cart' });
  }
});

// DELETE /api/cart — clear the stored cart (after checkout / completed order).
router.delete('/', optionalAuth, apiLimiter, async (req, res) => {
  try {
    const owner = resolveOwner(req, res);
    await Cart.clear(owner);
    res.json({ items: [], itemCount: 0 });
  } catch (error) {
    console.error('Error clearing cart:', error.message);
    res.status(500).json({ message: 'Failed to clear cart' });
  }
});

export default router;
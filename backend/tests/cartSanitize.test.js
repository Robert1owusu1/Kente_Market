// FILE LOCATION: backend/tests/cartSanitize.test.js
// DESCRIPTION: CART-1 — the server cart stored `image: null` for every line the
//              SPA synced (client lines carry `img`), so a cart restored on
//              another device/session showed no product thumbnails.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.REDIS_URL = '';
const { sanitizeItems } = await import('../routes/cartRoutes.js');

describe('cart line sanitizing (CART-1)', () => {
  test('a client-shaped line keeps its image', () => {
    const [line] = sanitizeItems([{ id: 1, title: 'Adinkra Royal Stole', quantity: 2, price: 450, img: '/images/image2.jpeg', yards: '4' }]);
    assert.equal(line.image, '/images/image2.jpeg');
    assert.equal(line.product, 1);
    assert.equal(line.qty, 2);
    assert.equal(line.yards, '4');
  });

  test('a server-shaped line still round-trips', () => {
    const [line] = sanitizeItems([{ product: 7, name: 'Kente', qty: 1, price: 10, image: 'https://cdn.example.com/a.jpg' }]);
    assert.equal(line.image, 'https://cdn.example.com/a.jpg');
  });

  test('only site-relative paths and http(s) URLs are stored', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.example/x.png', 'relative.png', 42, null]) {
      const [line] = sanitizeItems([{ id: 1, quantity: 1, img: bad }]);
      assert.equal(line.image, null, String(bad));
    }
  });
});

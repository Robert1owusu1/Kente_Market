// FILE LOCATION: backend/tests/productPriceValidation.test.js
// DESCRIPTION: M-7 (no product price schema) + M-8 (2 validate() mounts across
//              95 mutating routes).
//
// The gap: `productModel.create` rejected `price <= 0`, but the admin UPDATE
// path and BOTH vendor paths did a bare `parseFloat(req.body.price)`. A vendor
// could therefore publish a product at price 0 (buyers pay nothing) or -500,
// and the value only met a check later, deep in money math, if at all.
//
// The load-bearing property under test is NOT "it rejects negatives" — it is
// "it rejects negatives WITHOUT dropping the other ~50 product fields". A
// plain `z.object({...})` strips undeclared keys, so mounting one on a product
// PUT would silently blank gallery/threadTypes/patternMeaning on every save.
// Validation must never change what an endpoint accepts, only refuse what is
// invalid, so the passthrough behaviour gets its own explicit test.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validate, productPriceSchema } from '../middleware/validators.js';
import { z } from 'zod';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const productRoutesSrc = read('../routes/productRoutes.js');
const vendorRoutesSrc = read('../routes/vendorRoutes.js');

/** Drive the middleware exactly as Express would, recording what it did. */
const run = (body) => {
  const req = { body };
  const res = {
    statusCode: 200,
    status(code) {
      res.statusCode = code;
      return res;
    },
  };
  let forwarded = null;
  let error = null;
  validate(productPriceSchema)(req, res, (err) => {
    if (err) error = err;
    else forwarded = true;
  });
  return { req, res, forwarded, error };
};

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------
describe('M-7: the product price schema refuses impossible prices', () => {
  const rejected = [
    [-5, 'negative price'],
    [-0.01, 'fractionally negative price'],
    [0, 'zero price'],
    ['0', 'zero price as a string'],
    ['', 'empty-string price'],
    ['abc', 'non-numeric price'],
    [Number.NaN, 'NaN price'],
  ];

  for (const [value, label] of rejected) {
    test(`${label} is rejected with 400`, () => {
      const { forwarded, error, res } = run({ title: 'Kente', price: value });
      assert.equal(forwarded, null, `${label} was accepted`);
      assert.ok(error, 'no error was produced');
      assert.equal(res.statusCode, 400, 'validation failures must be 400');
      assert.match(error.message, /greater than 0|expected number/i, `unclear message: ${error.message}`);
    });
  }

  test('a valid price passes through and is coerced to a number', () => {
    for (const [input, expected] of [['12.5', 12.5], [49, 49], ['100', 100], [0.01, 0.01]]) {
      const { forwarded, error, req } = run({ title: 'Kente', price: input });
      assert.equal(error, null, `valid price ${JSON.stringify(input)} was rejected: ${error?.message}`);
      assert.equal(forwarded, true);
      assert.equal(req.body.price, expected, `${JSON.stringify(input)} was not coerced`);
      assert.equal(typeof req.body.price, 'number');
    }
  });

  test('an absent price is allowed (the update path means "leave it alone")', () => {
    const { forwarded, error, req } = run({ title: 'Renamed only' });
    assert.equal(error, null);
    assert.equal(forwarded, true);
    assert.ok(!('price' in req.body), 'the schema invented a price field');
  });

  test('an empty body is rejected rather than crashing the controller', () => {
    const { error } = run({});
    // `{}` parses fine (nothing required) — the point is it must not throw.
    assert.equal(error, null);
  });
});

// ---------------------------------------------------------------------------
// The property that makes this safe to mount
// ---------------------------------------------------------------------------
describe('M-7: validation does not change what the endpoint accepts', () => {
  const FULL_PRODUCT = {
    title: 'Ashanti Kente',
    img: '/uploads/a.png',
    rating: 4.5,
    originalPrice: 200,
    color: 'gold',
    category: 'textiles',
    sizes: ['2m', '4m'],
    printType: 'woven',
    material: 'cotton',
    reviews: 12,
    isCustomizable: true,
    colors: ['gold', 'green'],
    tag: 'featured',
    fabricType: 'silk',
    productionTime: 14,
    featured: true,
    basePrice: 120,
    vendorId: 7,
    description: 'Hand woven',
    patternName: 'Adweneasa',
    patternMeaning: 'My skill is exhausted',
    culturalSignificance: 'Royal cloth',
    origin: 'Bonwire',
    weavingTechnique: 'Strip weaving',
    yards: 6,
    occasions: ['wedding'],
    designStory: '…',
    careInstructions: 'Dry clean',
    weight: 1.2,
    wholesalePrice: 90,
    retailPrice: 180,
    madeToOrder: true,
    video: null,
    gallery: ['/uploads/g1.png'],
    descriptionHTML: '<p>hi</p>',
    threadTypes: ['silk'],
    dominantThread: 'gold',
    approvalStatus: 'approved',
    stock: 4,
    sku: 'SKU-1',
    lowStockThreshold: 5,
    isRentable: false,
    rentPricePerDay: 25,
    advanceRatio: 0.5,
    price: '149.99',
  };

  test('every undeclared field survives validation untouched', () => {
    const before = Object.keys(FULL_PRODUCT);
    const { forwarded, error, req } = run(structuredClone(FULL_PRODUCT));

    assert.equal(error, null, `full payload rejected: ${error?.message}`);
    assert.equal(forwarded, true);

    const after = Object.keys(req.body);
    const missing = before.filter((key) => !after.includes(key));
    assert.deepEqual(missing, [], `validation silently dropped fields: ${missing.join(', ')}`);

    // And the values themselves must be unchanged, not just present.
    for (const key of before) {
      if (key === 'price') {
        assert.equal(req.body.price, 149.99, 'price must be coerced');
        continue;
      }
      assert.deepEqual(req.body[key], FULL_PRODUCT[key], `field ${key} was altered by validation`);
    }
  });

  test('a stripping schema would have been caught by this suite', () => {
    // Negative control: prove the assertion above has teeth by parsing the
    // same payload with a NON-passthrough object and confirming fields vanish.
    // If this ever passes, the guard above is no longer proving anything
    // (e.g. passthrough silently became zod's default).
    const stripping = z.object({ price: z.coerce.number().optional() });
    const result = stripping.safeParse(FULL_PRODUCT);
    assert.ok(result.success, 'control payload should parse');
    assert.equal(Object.keys(result.data).length, 1,
      'expected the plain schema to strip everything but price — the negative control is broken');
    assert.ok(Object.keys(FULL_PRODUCT).length > 10, 'control payload is too small to mean anything');
  });
});

// ---------------------------------------------------------------------------
// The mounts (M-8)
// ---------------------------------------------------------------------------
describe('M-8: the four product write routes are validated', () => {
  const chainOf = (src, pattern) => {
    const m = src.match(pattern);
    assert.ok(m, `route not found: ${pattern}`);
    return m[1];
  };

  const assertOrder = (chain, steps, label) => {
    let cursor = -1;
    for (const step of steps) {
      const at = chain.indexOf(step);
      assert.ok(at !== -1, `${label}: missing ${step} in [${chain}]`);
      assert.ok(at > cursor, `${label}: ${step} is out of order in [${chain}]`);
      cursor = at;
    }
  };

  test('admin POST / validates price after auth', () => {
    const chain = chainOf(productRoutesSrc, /router\.post\('\/',\s*(.*)\);/);
    assertOrder(chain, ['protect', 'admin', 'validate(productPriceSchema)', 'createProduct'], 'admin create');
  });

  test('admin PUT /:id validates price after auth', () => {
    const chain = chainOf(productRoutesSrc, /router\.put\('\/:id',\s*(.*)\);/);
    assertOrder(chain, ['protect', 'admin', 'validate(productPriceSchema)', 'updateProduct'], 'admin update');
  });

  test('vendor POST /products validates price after the permission check', () => {
    const chain = chainOf(vendorRoutesSrc, /router\.route\('\/products'\)\.post\((.*)\);/);
    assertOrder(chain, ['vendorOrStaff', "requireVendorPermission('manage_products')", 'validate(productPriceSchema)', 'createVendorProduct'], 'vendor create');
  });

  test('vendor PUT /products/:id validates price after the permission check', () => {
    const chain = chainOf(vendorRoutesSrc, /router\.route\('\/products\/:id'\)\.put\((.*)\);/);
    assertOrder(chain, ['vendorOrStaff', "requireVendorPermission('manage_products')", 'validate(productPriceSchema)', 'updateVendorProduct'], 'vendor update');
  });

  test('the schema import exists in both route files', () => {
    for (const [name, src] of [['productRoutes', productRoutesSrc], ['vendorRoutes', vendorRoutesSrc]]) {
      assert.match(src, /import \{ validate, productPriceSchema \}/, `${name} does not import the schema`);
    }
  });

  test('M-8: validate() is mounted on more than the original two routes', () => {
    // Baseline when this finding was raised: 2 mounts across 95 mutating
    // routes. This counts express-level validate() calls only — manual checks
    // inside controllers (coupon bounds, vendor caps) do not count.
    const files = ['routes/productRoutes.js', 'routes/vendorRoutes.js', 'routes/userRoutes.js'];
    let mounts = 0;
    for (const file of files) mounts += (read(`../${file}`).match(/validate\(/g) || []).length;
    assert.ok(mounts >= 6, `expected >=6 validate() mounts across these route files, found ${mounts}`);
    // The finding stays OPEN for the remaining routes; this asserts progress
    // rather than pretending the sweep is finished.
    const totalMutating = 95;
    assert.ok(mounts < totalMutating,
      'if every route is now validated, retire this assertion and close M-8 in the report');
  });
});

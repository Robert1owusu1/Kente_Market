// FILE LOCATION: backend/tests/pricingConfig.test.js
// DESCRIPTION: Money settings come from the admin, not from code
//              (Services/pricingConfig.js, controllers/settingController.js).
//              The settings query is faked IN THIS PROCESS only — changing
//              the real tax_rate would move totals under suites running in
//              parallel. No database needed.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const pool = (await import('../config/db.js')).default;
const cfg = await import('../Services/pricingConfig.js');
const { updateSettings, deleteSetting, getPublicPricing } = await import('../controllers/settingController.js');

let stored;
let queries;
beforeEach(() => {
  stored = { tax_rate: '15', 'referral.minWithdrawal': '10' };
  queries = 0;
  cfg.clearPricingConfigCache();
  mock.method(pool, 'execute', async (sql) => {
    if (/FROM settings WHERE settingKey IN/.test(sql)) {
      queries += 1;
      return [Object.entries(stored).filter(([, v]) => v !== undefined).map(([settingKey, settingValue]) => ({ settingKey, settingValue }))];
    }
    throw new Error(`unexpected SQL in test: ${sql}`);
  });
});
afterEach(() => mock.restoreAll());

const call = async (handler, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
};

describe('VAT rate is the admin setting', () => {
  test('percent in the setting, fraction to the pricing code', async () => {
    assert.equal(await cfg.getVatRate(), 0.15);
    cfg.clearPricingConfigCache();
    stored.tax_rate = '12.5';
    assert.equal(await cfg.getVatRate(), 0.125);
    cfg.clearPricingConfigCache();
    stored.tax_rate = '0';
    assert.equal(await cfg.getVatRate(), 0, 'a zero rate is a real rate, not "missing"');
  });

  test('missing or invalid VAT stops pricing instead of guessing', async () => {
    for (const bad of [undefined, '', 'abc', '-1', '51']) {
      cfg.clearPricingConfigCache();
      stored.tax_rate = bad;
      await assert.rejects(cfg.getVatRate(), (err) => err instanceof cfg.PricingConfigError && err.status === 503);
    }
  });

  test('cached briefly, refreshed when the admin saves', async () => {
    await cfg.getVatRate();
    await cfg.getVatRate();
    assert.equal(queries, 1, 'second read served from cache');
    cfg.clearPricingConfigCache();
    await cfg.getVatRate();
    assert.equal(queries, 2);
  });

  test('the storefront reads the same rate from the public endpoint', async () => {
    const r = await call(getPublicPricing, {});
    assert.deepEqual(r.body, { vatRate: 0.15, currency: 'GHS' });
    cfg.clearPricingConfigCache();
    stored.tax_rate = undefined;
    const missing = await call(getPublicPricing, {});
    assert.equal(missing.code, 503);
  });
});

describe('admin settings guard the money values', () => {
  test('VAT must be a percentage between 0 and 50', async () => {
    for (const taxRate of [null, '', 'abc', -1, 60]) {
      const r = await call(updateSettings, { body: { taxRate }, user: { id: 1, role: 'admin' } });
      assert.equal(r.code, 400, `taxRate=${JSON.stringify(taxRate)}`);
      assert.match(r.body.message, /VAT rate/);
    }
  });

  test('settings that pricing depends on cannot be deleted', async () => {
    for (const key of ['tax_rate', 'referral.minWithdrawal']) {
      const r = await call(deleteSetting, { params: { key }, user: { id: 1, role: 'admin' } });
      assert.equal(r.code, 400, key);
    }
  });
});

describe('referral minimum withdrawal is the admin setting', () => {
  test('read from settings; missing stops withdrawals instead of guessing', async () => {
    assert.equal(await cfg.getReferralMinWithdrawal(), 10);
    cfg.clearPricingConfigCache();
    stored['referral.minWithdrawal'] = '25.5';
    assert.equal(await cfg.getReferralMinWithdrawal(), 25.5);
    cfg.clearPricingConfigCache();
    stored['referral.minWithdrawal'] = undefined;
    await assert.rejects(cfg.getReferralMinWithdrawal(), cfg.PricingConfigError);
  });
});

// FILE LOCATION: backend/tests/exchangeRates.test.js
// DESCRIPTION: Automatic exchange rates (Services/exchangeRateService.js) with
//              a fake rate source — no network. DB-backed for the stored
//              rows; skips itself without a database.
//
// Proves: a good answer stores today's GHS->X rows that shipping then uses;
// a rate that jumps more than the daily limit is refused and the previous
// rate stays in force; a malformed or failed answer changes nothing; only an
// https source is accepted; the job never runs under NODE_ENV=test unless
// forced (so no test ever calls the real service).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMAIL_DISABLED = '1';

let pool = null;
let dbAvailable = true;
try {
  pool = (await import('../config/db.js')).default;
  await pool.query('SELECT 1 FROM exchange_rates LIMIT 1');
} catch {
  dbAvailable = false;
}

const { refreshExchangeRates, getExchangeRateStatus, isFxAutoUpdateEnabled, FX_SOURCE } = await import('../Services/exchangeRateService.js');
const { getExchangeRate } = await import('../Services/shippingService.js');

// Rows are written for a far-future day so suites pricing at TODAY's rates in
// parallel never see them.
const DAY = new Date('2099-06-15T12:00:00Z');
const today = '2099-06-15';
const fakeSource = (body, status = 200) => async (url, opts) => {
  fakeSource.calls.push({ url, opts });
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};
fakeSource.calls = [];

describe(`automatic exchange rates${dbAvailable ? '' : ' — SKIPPED: no database'}`, { skip: !dbAvailable }, () => {
  const savedEnv = { NODE_ENV: process.env.NODE_ENV, FX_RATES_URL: process.env.FX_RATES_URL, FX_AUTO_UPDATE: process.env.FX_AUTO_UPDATE };

  before(async () => {
    delete process.env.FX_RATES_URL;
  });

  after(async () => {
    await pool.execute(`DELETE FROM exchange_rates WHERE baseCurrency = 'GHS' AND effectiveDate = ?`, [today]);
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool.end();
  });

  test('never runs automatically in tests or when switched off', async () => {
    process.env.NODE_ENV = 'test';
    assert.equal(isFxAutoUpdateEnabled(), false);
    const r = await refreshExchangeRates({ fetchImpl: () => assert.fail('no request expected') });
    assert.equal(r.skipped, 'disabled');
    process.env.NODE_ENV = 'production';
    process.env.FX_AUTO_UPDATE = 'false';
    assert.equal(isFxAutoUpdateEnabled(), false);
    delete process.env.FX_AUTO_UPDATE;
    assert.equal(isFxAutoUpdateEnabled(), true);
    process.env.NODE_ENV = 'test';
  });

  test('a good answer stores today\'s rates, which shipping then uses', async () => {
    // Seed a baseline close to the fake answer so the daily-change guard passes.
    for (const [c, rate] of [['GBP', 0.05], ['USD', 0.065], ['CAD', 0.09], ['EUR', 0.06]]) {
      await pool.execute(
        `INSERT INTO exchange_rates (baseCurrency, targetCurrency, rate, source, effectiveDate) VALUES ('GHS', ?, ?, 'manual', ?)
         ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source)`,
        [c, rate, today],
      );
    }
    fakeSource.calls = [];
    const r = await refreshExchangeRates({
      force: true, date: DAY,
      fetchImpl: fakeSource({ result: 'success', base_code: 'GHS', rates: { GHS: 1, GBP: 0.051, USD: 0.066, CAD: 0.091, EUR: 0.061 } }),
    });
    assert.deepEqual(r.updated, ['GBP', 'USD', 'CAD', 'EUR']);
    assert.deepEqual(r.rejected, []);
    assert.equal(fakeSource.calls[0].url, 'https://open.er-api.com/v6/latest/GHS');
    assert.equal(fakeSource.calls[0].opts.redirect, 'error');
    assert.equal(await getExchangeRate('GHS', 'GBP', DAY), 0.051);
    const status = await getExchangeRateStatus(DAY);
    const gbp = status.find((s) => s.currency === 'GBP');
    assert.equal(gbp.source, FX_SOURCE);
    assert.equal(gbp.perUnitGHS, Math.round((1 / 0.051) * 100) / 100);
    assert.equal(gbp.effectiveDate, '2099-06-15', 'a plain calendar date, not a Date string');
    assert.equal(gbp.ageDays, 0);
  });

  test('a rate that jumps more than the daily limit is refused; the previous rate stays', async () => {
    const r = await refreshExchangeRates({
      force: true, date: DAY,
      fetchImpl: fakeSource({ result: 'success', base_code: 'GHS', rates: { GBP: 0.2, USD: 0.0662, CAD: 0.0911, EUR: 0.0611 } }),
    });
    assert.deepEqual(r.rejected.map((x) => x.currency), ['GBP']);
    assert.match(r.rejected[0].reason, /moved/);
    assert.equal(await getExchangeRate('GHS', 'GBP', DAY), 0.051, 'GBP kept');
    assert.equal(await getExchangeRate('GHS', 'USD', DAY), 0.0662, 'others updated');
  });

  test('malformed or failed answers change nothing', async () => {
    const before = await getExchangeRate('GHS', 'USD', DAY);
    for (const body of [
      { result: 'error', 'error-type': 'unsupported-code' },
      { result: 'success', base_code: 'USD', rates: { USD: 1 } },
      { result: 'success', base_code: 'GHS' },
    ]) {
      await assert.rejects(refreshExchangeRates({ force: true, date: DAY, fetchImpl: fakeSource(body) }), /unexpected payload/);
    }
    await assert.rejects(refreshExchangeRates({ force: true, date: DAY, fetchImpl: fakeSource({}, 429) }), /HTTP 429/);
    const partial = await refreshExchangeRates({
      force: true, date: DAY,
      fetchImpl: fakeSource({ result: 'success', base_code: 'GHS', rates: { USD: -1, GBP: 'x' } }),
    });
    assert.deepEqual(partial.updated, []);
    assert.equal(partial.rejected.length, 4);
    assert.equal(await getExchangeRate('GHS', 'USD', DAY), before);
  });

  test('only an https source is accepted', async () => {
    process.env.FX_RATES_URL = 'http://rates.example.test/latest/GHS';
    await assert.rejects(refreshExchangeRates({ force: true, date: DAY, fetchImpl: () => assert.fail('no request') }), /https/);
    delete process.env.FX_RATES_URL;
  });
});

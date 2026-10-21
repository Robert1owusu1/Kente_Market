// FILE LOCATION: backend/tests/deadlockRetry.test.js
// DESCRIPTION: retryOnDeadlock re-runs an idempotent statement MySQL chose as
//              a deadlock victim (escrow allocation at checkout), and never
//              retries or hides any other error. Pure: no database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { retryOnDeadlock } = await import('../Services/escrowService.js');

const deadlock = () => Object.assign(new Error('Deadlock found when trying to get lock; try restarting transaction'), { code: 'ER_LOCK_DEADLOCK' });

describe('retryOnDeadlock', () => {
  test('a deadlock victim is run again and its result returned', async () => {
    let calls = 0;
    const result = await retryOnDeadlock(async () => {
      calls += 1;
      if (calls === 1) throw deadlock();
      return 'inserted';
    }, { delayMs: 1 });
    assert.equal(result, 'inserted');
    assert.equal(calls, 2);
  });

  test('gives up after the attempt limit and surfaces the deadlock', async () => {
    let calls = 0;
    await assert.rejects(
      retryOnDeadlock(async () => { calls += 1; throw deadlock(); }, { attempts: 3, delayMs: 1 }),
      { code: 'ER_LOCK_DEADLOCK' }
    );
    assert.equal(calls, 3);
  });

  test('any other error is thrown at once, never retried', async () => {
    let calls = 0;
    await assert.rejects(
      retryOnDeadlock(async () => { calls += 1; throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }); }, { delayMs: 1 }),
      { code: 'ER_DUP_ENTRY' }
    );
    assert.equal(calls, 1);
  });
});

// Checkout payable math: what Paystack gets initialized with.
import { describe, test, expect } from 'vitest';
import { toPesewas, resolvePayableTotal } from '../payments';

describe('toPesewas', () => {
  test('converts GHS to pesewas with float-error-safe rounding', () => {
    expect(toPesewas(19.99)).toBe(1999);
    expect(toPesewas(0.1 + 0.2)).toBe(30); // 0.30000000000000004 -> 30
    expect(toPesewas('250')).toBe(25000);
  });

  test('garbage in -> 0 (downstream validation blocks, never a 0-charge)', () => {
    expect(toPesewas(NaN)).toBe(0);
    expect(toPesewas(0)).toBe(0);
    expect(toPesewas(-5)).toBe(0);
    expect(toPesewas('abc')).toBe(0);
  });
});

describe('resolvePayableTotal', () => {
  test('usable server total wins (server is authoritative)', () => {
    expect(resolvePayableTotal(276, 210.5)).toBe(276);
  });

  test('unusable server total falls back to local computation', () => {
    expect(resolvePayableTotal(NaN, 210.5)).toBe(210.5);
    expect(resolvePayableTotal(0, 210.5)).toBe(210.5);
    expect(resolvePayableTotal(-10, 210.5)).toBe(210.5);
  });
});

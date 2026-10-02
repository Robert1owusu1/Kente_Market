// Cart shape migration: server lines {product,name,qty,image} must become
// client lines {id,title,quantity,img} or every count/total renders NaN.
import { describe, test, expect } from 'vitest';
import { remapServerLine, migrateCartItem, normalizeColors } from '../../utils/cartMapping';
import type { CartItem } from '../../Context/CartContext';

const serverLine = {
  product: 7,
  name: 'Kente Cloth',
  qty: 2,
  price: '100.00',
  image: '/uploads/x.png',
  selectedColor: 'red',
} as unknown as CartItem;

describe('remapServerLine', () => {
  test('server shape -> client shape with coercion', () => {
    const r = remapServerLine(serverLine);
    expect(r.id).toBe(7);
    expect(r.title).toBe('Kente Cloth');
    expect(r.quantity).toBe(2);
    expect(r.img).toBe('/uploads/x.png');
    expect(r.price).toBe(100);
    expect(r.selectedColor).toBe('red');
  });

  test('client-shaped and empty lines pass through untouched', () => {
    const client = { id: 1, quantity: 3, price: 10 } as CartItem;
    expect(remapServerLine(client)).toBe(client);
    const empty = { price: 5 } as unknown as CartItem;
    expect(remapServerLine(empty)).toBe(empty);
  });

  test('quantity floors at 1, price NaN-safe', () => {
    const r = remapServerLine({ product: 9, qty: 0, price: 'abc' } as unknown as CartItem);
    expect(r.quantity).toBe(1);
    expect(r.price).toBe(0);
  });
});

describe('migrateCartItem', () => {
  test('size backfills yards; default color never surfaces', () => {
    const r = migrateCartItem({
      id: 3, quantity: 1, price: 50, selectedSize: '4',
      selectedColor: 'default', colorsAvailable: ['blue'],
    } as unknown as CartItem);
    expect(r.yards).toBe('4');
    expect(r.colors).toEqual(['blue']);
  });
});

describe('normalizeColors', () => {
  test('keeps existing colors; prefers confirmed selection', () => {
    const kept = { colors: ['red'] } as CartItem;
    expect(normalizeColors(kept).colors).toEqual(['red']);
    const picked = normalizeColors({ selectedColor: 'green' } as CartItem);
    expect(picked.colors).toEqual(['green']);
  });
});

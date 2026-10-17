// One cart-line shape for every add-to-cart entry point. The homepage trending
// strip used to write `image` but not `img` (the field the cart renders), and
// the listing wrote invented "Cotton"/"Standard"/"3-5" values into the line.
import { describe, it, expect } from 'vitest';
import { toCartItem } from '../cartItem';
import type { Product } from '../../types/domain';

describe('toCartItem', () => {
  const product = { id: 7, title: 'Sika Futuro Wrap', price: '900.00', img: '/images/b.jpg', yardsAvailable: ['6', '8'] } as unknown as Product;

  it('keeps the product image under the field the cart renders', () => {
    expect(toCartItem(product, '6', 1).img).toBe('/images/b.jpg');
  });

  it('carries the chosen yards, quantity and the same product id', () => {
    const line = toCartItem(product, '8', 2);
    expect(line).toMatchObject({ id: 7, title: 'Sika Futuro Wrap', yards: '8', quantity: 2, yardsAvailable: ['6', '8'] });
  });

  it('does not invent material, print type or production time', () => {
    const line = toCartItem(product, '6', 1) as unknown as Record<string, unknown>;
    expect(line.material).toBeUndefined();
    expect(line.printType).toBeUndefined();
    expect(line.productionTime).toBeUndefined();
  });
});

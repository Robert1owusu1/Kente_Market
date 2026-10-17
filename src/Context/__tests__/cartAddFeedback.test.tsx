// Adding to the cart must tell the customer (and screen readers) it worked.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const success = vi.fn();
vi.mock('react-toastify', () => ({ toast: { success: (...a: unknown[]) => success(...a), error: vi.fn() } }));
vi.mock('../../store', () => ({ useAppSelector: () => null }));

const { CartProvider, useCart } = await import('../CartContext');

const Adder = () => {
  const { addToCart, cartCount } = useCart();
  return (
    <>
      <button onClick={() => addToCart({ id: 7, title: 'Sika Futuro Wrap', price: 900, quantity: 1, yards: '6' })}>add</button>
      <span data-testid="count">{cartCount}</span>
    </>
  );
};

describe('add-to-cart feedback', () => {
  it('adds the line and announces it', () => {
    const { getByText, getByTestId } = render(<CartProvider><Adder /></CartProvider>);
    fireEvent.click(getByText('add'));
    expect(getByTestId('count')).toHaveTextContent('1');
    expect(success).toHaveBeenCalledWith('Sika Futuro Wrap added to your cart', { toastId: 'cart-add-7' });
  });
});

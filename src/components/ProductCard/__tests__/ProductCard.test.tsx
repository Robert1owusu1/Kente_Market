// Shared product card: replaces three copies that hid the product link behind
// hover, let sold-out items be added, showed invented details and computed
// "Save ₵X" by comparing price strings.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import ProductCard from '../ProductCard';
import { saleInfo, stockOnHand } from '../../../utils/productDisplay';

const base = { id: 11, title: 'Adinkra Royal Stole', price: '450.00', img: '/images/a.jpg', stock: 6 };
const renderCard = (product: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const onAddToCart = vi.fn();
  const onToggleWishlist = vi.fn();
  render(
    <MemoryRouter>
      <ProductCard product={{ ...base, ...product } as never} onAddToCart={onAddToCart} onToggleWishlist={onToggleWishlist} {...extra} />
    </MemoryRouter>,
  );
  return { onAddToCart, onToggleWishlist };
};

describe('ProductCard', () => {
  it('the title is a visible link to the product page (no hover needed)', () => {
    renderCard({});
    expect(screen.getByRole('link', { name: 'Adinkra Royal Stole' })).toHaveAttribute('href', '/product/11');
  });

  it('every control has an accessible name', () => {
    const { onAddToCart, onToggleWishlist } = renderCard({});
    fireEvent.click(screen.getByRole('button', { name: 'Add Adinkra Royal Stole to cart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Adinkra Royal Stole to wishlist' }));
    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart.mock.calls[0][0].id).toBe(11);
    expect(onToggleWishlist).toHaveBeenCalledWith(11);
  });

  it('a sold-out product cannot be added to the cart', () => {
    const { onAddToCart } = renderCard({ stock: 0 });
    const btn = screen.getByRole('button', { name: 'Adinkra Royal Stole is sold out' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Sold out');
    fireEvent.click(btn);
    expect(onAddToCart).not.toHaveBeenCalled();
    expect(screen.getAllByText('Sold out').length).toBeGreaterThan(0);
  });

  it('shows low stock as text, not colour alone', () => {
    renderCard({ stock: 2 });
    expect(screen.getByText('Only 2 left')).toBeInTheDocument();
  });

  it('never invents material, production time, ratings or rankings', () => {
    renderCard({ rating: 0, reviews: 0 });
    for (const invented of [/Cotton/, /days/, /Best Seller/i, /review/i, /custom printing/i]) {
      expect(screen.queryByText(invented)).not.toBeInTheDocument();
    }
  });

  it('shows a real rating with its review count', () => {
    renderCard({ rating: '4.5', reviews: 3 });
    expect(screen.getByText('(3 reviews)')).toBeInTheDocument();
  });

  it('shows the sale only when the original price is numerically higher', () => {
    renderCard({ price: '1200.00', originalPrice: '1500.00' });
    expect(screen.getByText('20% off')).toBeInTheDocument();
    expect(screen.getByText(/1500\.00/)).toBeInTheDocument();
  });

  it('only shows a section badge it is given', () => {
    renderCard({}, { badge: 'Featured' });
    expect(screen.getByText('Featured')).toBeInTheDocument();
  });
});

describe('product display helpers', () => {
  it('saleInfo compares numbers, not strings', () => {
    // "900.00" > "1500.00" as STRINGS — the old badge got this wrong.
    expect(saleInfo({ id: 1, price: '1500.00', originalPrice: '900.00' })).toBeNull();
    expect(saleInfo({ id: 1, price: '900.00', originalPrice: '1500.00' })).toEqual({ original: 1500, percentOff: 40 });
    expect(saleInfo({ id: 1, price: '100', originalPrice: '100' })).toBeNull();
    expect(saleInfo({ id: 1, price: '100', originalPrice: null })).toBeNull();
    expect(saleInfo({ id: 1, price: '100', original_price: 'abc' })).toBeNull();
  });

  it('stockOnHand distinguishes unknown from zero', () => {
    expect(stockOnHand({ id: 1, price: 1 })).toBeNull();
    expect(stockOnHand({ id: 1, price: 1, stock: 0 })).toBe(0);
    expect(stockOnHand({ id: 1, price: 1, in_stock: '3', stock: 0 })).toBe(3);
  });
});

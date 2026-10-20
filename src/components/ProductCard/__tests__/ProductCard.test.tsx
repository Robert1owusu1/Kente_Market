// Shared product card: replaces three copies that hid the product link behind
// hover, let sold-out items be added, showed invented details and computed
// "Save ₵X" by comparing price strings.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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

  it('shows what one price buys: the piece length the seller set, nothing when unset', () => {
    renderCard({ yards: '6.00' });
    expect(screen.getByText('per piece · 6 yards')).toBeInTheDocument();
    cleanup();
    renderCard({});
    expect(screen.queryByText(/per piece/)).not.toBeInTheDocument();
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

  it('the heart shows saved state and offers removal', () => {
    const { onToggleWishlist } = renderCard({}, { isSaved: true });
    const heart = screen.getByRole('button', { name: 'Remove Adinkra Royal Stole from wishlist' });
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(heart);
    expect(onToggleWishlist).toHaveBeenCalledWith(11);
  });

  it('offers Try on only when try-on is available and the piece is in stock', () => {
    renderCard({}, { tryOnAvailable: true });
    expect(screen.getByRole('link', { name: 'Try on Adinkra Royal Stole with AI' })).toHaveAttribute('href', '/ai-tryon?product=11');
    cleanup();
    renderCard({});
    expect(screen.queryByRole('link', { name: /Try on/ })).not.toBeInTheDocument();
    cleanup();
    renderCard({ stock: 0 }, { tryOnAvailable: true });
    expect(screen.queryByRole('link', { name: /Try on/ })).not.toBeInTheDocument();
  });

  it('on a touch screen the first tap on the image reveals the actions, the second opens the product', () => {
    // jsdom has no matchMedia, which the card treats as a device that cannot hover.
    render(
      <MemoryRouter initialEntries={['/products']}>
        <Routes>
          <Route path="/products" element={<ProductCard product={base as never} onAddToCart={vi.fn()} />} />
          <Route path="/product/:id" element={<p>product page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const actions = screen.getByTestId('card-actions');
    expect(actions).toHaveAttribute('data-open', 'false');
    const imageLink = actions.parentElement!.querySelector('a[aria-hidden="true"]')!;
    fireEvent.click(imageLink);
    expect(actions).toHaveAttribute('data-open', 'true');
    expect(screen.getByRole('link', { name: 'View details of Adinkra Royal Stole' })).toHaveAttribute('href', '/product/11');
    fireEvent.click(imageLink);
    expect(screen.getByText('product page')).toBeInTheDocument();
  });

  it('a tap elsewhere or Escape hides the revealed actions', () => {
    renderCard({});
    const actions = screen.getByTestId('card-actions');
    fireEvent.click(actions.parentElement!.querySelector('a[aria-hidden="true"]')!);
    expect(actions).toHaveAttribute('data-open', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(actions).toHaveAttribute('data-open', 'false');
    fireEvent.click(actions.parentElement!.querySelector('a[aria-hidden="true"]')!);
    fireEvent.pointerDown(document.body);
    expect(actions).toHaveAttribute('data-open', 'false');
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

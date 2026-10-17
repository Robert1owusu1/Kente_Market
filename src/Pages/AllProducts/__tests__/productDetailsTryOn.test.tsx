// The "Try It On" button on a product page starts a try-on for THAT product,
// and only when the server says the product supports it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const product = { id: 11, title: 'Adinkra Royal Stole', price: 450, img: '/uploads/products/a.jpg', vendorId: 1, yardsAvailable: ['4', '6'], in_stock: 5 };
const getProductEligibility = vi.fn();

vi.mock('../../../ai-tryon/api/tryOnService', () => ({
  default: { getProductEligibility: (...a: unknown[]) => getProductEligibility(...a) },
}));
vi.mock('../../../slices/productsApiSlice', () => ({
  useGetProductsDetailsQuery: () => ({ data: product, isLoading: false, error: undefined }),
}));
vi.mock('../../../Context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('react-redux', () => ({ useSelector: () => null }));
vi.mock('../../../components/reviews/ProductReviews', () => ({ default: () => null }));
vi.mock('../../../components/SocialShare/SocialShare', () => ({ default: () => null }));
vi.mock('../../../components/Seo/Seo', () => ({ default: () => null }));
vi.mock('../../../components/Messages/AskModal', () => ({ default: () => null }));

const { default: ProductDetails } = await import('../productDetails');

const Where = () => {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
};
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/product/11']}>
      <Routes>
        <Route path="/product/:id" element={<ProductDetails />} />
        <Route path="/ai-tryon" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => getProductEligibility.mockReset());

describe('product page Try It On', () => {
  it('shows an accessible checking state until the server answers', async () => {
    let answer: (v: unknown) => void = () => {};
    getProductEligibility.mockReturnValue(new Promise((r) => { answer = r; }));
    renderPage();
    const checking = screen.getByRole('button', { name: /Checking AI try-on/ });
    expect(checking).toBeDisabled();
    expect(checking).toHaveAttribute('aria-busy', 'true');
    answer({ productId: 11, enabled: true, eligible: true, reason: null });
    expect(await screen.findByRole('button', { name: 'Try It On' })).toBeEnabled();
    expect(screen.getByText(/see an AI preview of this exact piece on you/)).toBeInTheDocument();
  });

  it('starts a try-on for this product, carrying the chosen yards', async () => {
    getProductEligibility.mockResolvedValue({ productId: 11, enabled: true, eligible: true, reason: null });
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Try It On' });
    expect(getProductEligibility).toHaveBeenCalledWith(11);
    fireEvent.click(screen.getByRole('button', { name: '6 yards' }));
    fireEvent.click(btn);
    expect(screen.getByTestId('where')).toHaveTextContent('/ai-tryon?product=11&yards=6');
  });

  it('is disabled with the reason for an unsupported product', async () => {
    getProductEligibility.mockResolvedValue({ productId: 11, enabled: true, eligible: false, reason: 'AI try-on is only available for Kente you wear.' });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Try It On' })).toBeDisabled();
    expect(screen.getByText('AI try-on is only available for Kente you wear.')).toBeInTheDocument();
  });

  it('is hidden when the feature is switched off', async () => {
    getProductEligibility.mockResolvedValue({ productId: 11, enabled: false, eligible: true, reason: null });
    renderPage();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Checking AI try-on/ })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Try It On' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add to Cart/ })).toBeEnabled();
  });
});

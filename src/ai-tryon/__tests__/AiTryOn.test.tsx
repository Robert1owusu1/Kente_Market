// The try-on journey is bound to ONE catalog product: started from that
// product's page, sent to the server as that product's id only, and every
// action on the result refers back to it. The AI never picks the garment.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

const PRODUCTS: Record<number, Record<string, unknown>> = {
  11: { id: 11, title: 'Adinkra Royal Stole', price: 450, img: '/uploads/products/a.jpg', vendorId: 1, yards: 6, in_stock: 5 },
  12: { id: 12, title: 'Sika Futuro Wrap', price: 900, img: '/uploads/products/b.jpg', vendorId: 2, yards: 12, in_stock: 2 },
  13: { id: 13, title: 'Sold Out Stole', price: 300, img: '/uploads/products/c.jpg', vendorId: 1, yards: 6, in_stock: 0 },
};

const createJob = vi.fn();
const waitForJob = vi.fn();
const getResultObjectUrl = vi.fn();
const getProductEligibility = vi.fn();
const addToCart = vi.fn();
let keySeq = 0;

vi.mock('../api/tryOnService', async () => {
  const actual = await vi.importActual<typeof import('../api/tryOnService')>('../api/tryOnService');
  return {
    ...actual,
    newIdempotencyKey: () => `key-${++keySeq}-abcdef`,
    default: {
      createJob: (...a: unknown[]) => createJob(...a),
      waitForJob: (...a: unknown[]) => waitForJob(...a),
      getResultObjectUrl: (...a: unknown[]) => getResultObjectUrl(...a),
      getProductEligibility: (...a: unknown[]) => getProductEligibility(...a),
    },
  };
});
const listArgs = vi.fn();
vi.mock('../../slices/productsApiSlice', () => ({
  useGetProductsDetailsQuery: (id: number) => ({
    data: PRODUCTS[id],
    isLoading: false,
    error: PRODUCTS[id] ? undefined : { status: 404 },
  }),
  useGetProductsQuery: (args: unknown, opts: { skip?: boolean }) => {
    listArgs(args, opts);
    return opts?.skip ? { data: undefined, isLoading: false, isError: false } : { data: Object.values(PRODUCTS), isLoading: false, isError: false }; // the API's real shape: a plain array
  },
}));
const tryOnStatus = { enabled: true };
vi.mock('../../slices/tryOnApiSlice', () => ({
  useGetTryOnStatusQuery: () => ({ data: { enabled: tryOnStatus.enabled }, isLoading: false }),
}));
vi.mock('../../Context/CartContext', () => ({ useCart: () => ({ addToCart }) }));
// Photo capture is covered by its own suites; here it just yields a photo.
vi.mock('../ImageUpload', () => ({
  default: ({ onImageSelected }: { onImageSelected: (d: string) => void }) => (
    <button type="button" onClick={() => onImageSelected('data:image/jpeg;base64,UEhPVE8=')}>pick photo</button>
  ),
}));
vi.mock('../CameraCapture', () => ({ default: () => null }));

const { default: AiTryOn } = await import('../AiTryOn');
const { TryOnRequestError } = await import('../api/tryOnService');

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/ai-tryon" element={<AiTryOn />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

const eligible = (productId: number) => ({ productId, enabled: true, eligible: true, reason: null });
const job = (productId: number, over: Record<string, unknown> = {}) => ({
  jobId: `job-${productId}`, productId, status: 'processing', resultAvailable: false, expiresAt: null, error: null, ...over,
});

/** Happy path: job created, finishes, private result loads. */
const succeedFor = (productId: number) => {
  createJob.mockResolvedValue(job(productId, { status: 'queued' }));
  waitForJob.mockImplementation(async (_j, _p, onUpdate) => {
    onUpdate(job(productId, { status: 'processing' }));
    return job(productId, { status: 'succeeded', resultAvailable: true });
  });
  getResultObjectUrl.mockResolvedValue(`blob:local/${productId}`);
};

const pickPhotoAndConsent = async () => {
  fireEvent.click(await screen.findByText('pick photo'));
  fireEvent.click(screen.getByRole('checkbox'));
};

beforeEach(() => {
  for (const f of [createJob, waitForJob, getResultObjectUrl, getProductEligibility, addToCart, listArgs]) f.mockReset();
  tryOnStatus.enabled = true;
  getProductEligibility.mockImplementation(async (id: number) => eligible(id));
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});

describe('AI try-on is bound to the selected product', () => {
  it('shows the selected product and no garment gallery or picker', async () => {
    renderAt('/ai-tryon?product=11');
    expect(await screen.findByText("You're trying on")).toBeInTheDocument();
    expect(screen.getByText('Adinkra Royal Stole')).toBeInTheDocument();
    expect(screen.queryByText('Sika Futuro Wrap')).not.toBeInTheDocument();
    expect(screen.queryByText(/Select a Kente Cloth/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Decorate/i)).not.toBeInTheDocument();
  });

  it('requires a photo AND consent before anything is sent', async () => {
    renderAt('/ai-tryon?product=11');
    const go = await screen.findByRole('button', { name: /Try On Adinkra Royal Stole/ });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByText('pick photo'));
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(go).toBeEnabled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('sends ONLY the photo and the selected product id (with a per-attempt key)', async () => {
    succeedFor(11);
    renderAt('/ai-tryon?product=11');
    await pickPhotoAndConsent();
    fireEvent.click(screen.getByRole('button', { name: /Try On Adinkra Royal Stole/ }));
    await screen.findByAltText('AI try-on of Adinkra Royal Stole');
    expect(createJob).toHaveBeenCalledTimes(1);
    const [photo, productId, key] = createJob.mock.calls[0];
    expect(photo).toBe('data:image/jpeg;base64,UEhPVE8=');
    expect(productId).toBe(11);
    expect(key).toMatch(/^key-\d+-abcdef$/);
    expect(waitForJob.mock.calls[0][1]).toBe(11);
    expect(getResultObjectUrl).toHaveBeenCalledWith('job-11');
  });

  it('product B uses product B — the URL product is the only one ever sent', async () => {
    succeedFor(12);
    renderAt('/ai-tryon?product=12');
    await pickPhotoAndConsent();
    fireEvent.click(screen.getByRole('button', { name: /Try On Sika Futuro Wrap/ }));
    await screen.findByAltText('AI try-on of Sika Futuro Wrap');
    expect(createJob.mock.calls.map((c) => c[1])).toEqual([12]);
  });

  it('without a product, the customer picks one to try on right here (nothing is generated)', () => {
    renderAt('/ai-tryon');
    expect(screen.getByText('Choose a piece to try on')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Try this on/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/ai-tryon?product=11', '/ai-tryon?product=12']);
    expect(screen.queryByText(/Sold Out Stole/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See all Kente/ })).toHaveAttribute('href', '/products');
    expect(screen.queryByText('pick photo')).not.toBeInTheDocument();
    expect(getProductEligibility).not.toHaveBeenCalled();
  });

  it('picking a piece opens the try-on for exactly that product', async () => {
    renderAt('/ai-tryon');
    fireEvent.click(screen.getByRole('link', { name: /Sika Futuro Wrap/ }));
    expect(await screen.findByText("You're trying on")).toBeInTheDocument();
    expect(getProductEligibility).toHaveBeenCalledWith(12);
  });

  it('with try-on switched off, the menu page says so instead of offering pieces', () => {
    tryOnStatus.enabled = false;
    renderAt('/ai-tryon');
    expect(screen.getByText(/AI try-on is offline/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Try this on/ })).not.toBeInTheDocument();
    expect(listArgs.mock.calls.every(([, opts]) => opts?.skip === true)).toBe(true);
  });

  it.each(['abc', '0', '-4', '1.5'])('an invalid product id (%s) never starts a session', (bad) => {
    renderAt(`/ai-tryon?product=${bad}`);
    expect(screen.getByText('Choose a piece to try on')).toBeInTheDocument();
    expect(getProductEligibility).not.toHaveBeenCalled();
  });
});

describe('processing states follow the real job status', () => {
  it('shows queued then processing copy, disables the form, and blocks double submits', async () => {
    let finish: (v: unknown) => void = () => {};
    createJob.mockResolvedValue(job(11, { status: 'queued' }));
    waitForJob.mockImplementation((_j, _p, onUpdate) => new Promise((resolve) => {
      finish = (v) => resolve(v);
      setTimeout(() => onUpdate(job(11, { status: 'processing' })), 0);
    }));
    renderAt('/ai-tryon?product=11');
    await pickPhotoAndConsent();
    const go = screen.getByRole('button', { name: /Try On Adinkra Royal Stole/ });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(await screen.findByText(/Waiting for the AI stylist to start/)).toBeInTheDocument();
    expect(await screen.findByText(/The AI is creating your try-on/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Working on it/ })).toBeDisabled();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(createJob).toHaveBeenCalledTimes(1);
    finish(job(11, { status: 'failed', error: { code: 'generation_failed', message: 'x', retryable: true } }));
    await screen.findByRole('alert');
  });

  it('a failed job is explained and can be retried with a NEW key for the same product', async () => {
    createJob.mockResolvedValue(job(11, { status: 'queued' }));
    waitForJob.mockResolvedValueOnce(job(11, {
      status: 'failed',
      error: { code: 'generation_failed', message: 'The AI could not create a try-on from this photo. Please try a different photo.', retryable: true },
    }));
    renderAt('/ai-tryon?product=11');
    await pickPhotoAndConsent();
    fireEvent.click(screen.getByRole('button', { name: /Try On Adinkra Royal Stole/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not create a try-on from this photo');

    succeedFor(11);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByAltText('AI try-on of Adinkra Royal Stole');
    expect(createJob).toHaveBeenCalledTimes(2);
    expect(createJob.mock.calls.map((c) => c[1])).toEqual([11, 11]);
    expect(createJob.mock.calls[0][2]).not.toBe(createJob.mock.calls[1][2]);
  });

  it('an expired job is reported as such', async () => {
    createJob.mockResolvedValue(job(11, { status: 'queued' }));
    waitForJob.mockResolvedValue(job(11, {
      status: 'expired',
      error: { code: 'job_timeout', message: 'This try-on took too long and was stopped. Please try again.', retryable: true },
    }));
    renderAt('/ai-tryon?product=11');
    await pickPhotoAndConsent();
    fireEvent.click(screen.getByRole('button', { name: /Try On Adinkra Royal Stole/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('took too long');
  });

  it('a request failure (e.g. provider unavailable) is shown clearly', async () => {
    createJob.mockRejectedValue(new TryOnRequestError('The AI stylist is unavailable right now. Please try again later.', 503));
    renderAt('/ai-tryon?product=11');
    await pickPhotoAndConsent();
    fireEvent.click(screen.getByRole('button', { name: /Try On Adinkra Royal Stole/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable right now');
    expect(screen.getByText("You're trying on")).toBeInTheDocument();
    expect(screen.queryByAltText(/AI try-on of/)).not.toBeInTheDocument();
  });

  it('an expired result image is reported, not substituted', async () => {
    createJob.mockResolvedValue(job(11, { status: 'queued' }));
    waitForJob.mockResolvedValue(job(11, { status: 'succeeded', resultAvailable: true }));
    getResultObjectUrl.mockRejectedValue(new TryOnRequestError('This try-on image has expired. Please create a new one.', 410));
    renderAt('/ai-tryon?product=11');
    await pickPhotoAndConsent();
    fireEvent.click(screen.getByRole('button', { name: /Try On Adinkra Royal Stole/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
    expect(screen.queryByAltText(/AI try-on of/)).not.toBeInTheDocument();
  });
});

describe('result screen sells the same product', () => {
  const tryOn = async (url: string, productId: number, title: string) => {
    succeedFor(productId);
    renderAt(url);
    await pickPhotoAndConsent();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Try On ${title}`) }));
    await screen.findByAltText(`AI try-on of ${title}`);
  };

  it('shows the generated and original images, name, price and the AI disclosure', async () => {
    await tryOn('/ai-tryon?product=11&yards=4', 11, 'Adinkra Royal Stole');
    expect(screen.getByAltText('AI try-on of Adinkra Royal Stole')).toHaveAttribute('src', 'blob:local/11');
    expect(screen.getByAltText('Adinkra Royal Stole')).toHaveAttribute('src', '/uploads/products/a.jpg');
    expect(screen.getByText('GH₵450')).toBeInTheDocument();
    expect(screen.getByText('AI-generated visualization')).toBeInTheDocument();
    expect(screen.getByText(/Fabric details, fit, colours and patterns may differ/)).toBeInTheDocument();
  });

  it('View Product links back to the exact product', async () => {
    await tryOn('/ai-tryon?product=11&yards=4', 11, 'Adinkra Royal Stole');
    expect(screen.getByRole('link', { name: /View Product/ })).toHaveAttribute('href', '/product/11');
  });

  it('Add to Cart adds one packaged piece of the tried-on product', async () => {
    await tryOn('/ai-tryon?product=11', 11, 'Adinkra Royal Stole');
    expect(screen.getByText(/per piece \(6 yards\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/ }));
    expect(addToCart).toHaveBeenCalledTimes(1);
    expect(addToCart.mock.calls[0][0]).toMatchObject({ id: 11, title: 'Adinkra Royal Stole', price: 450, vendorId: 1, yards: 6, quantity: 1 });
  });

  it('the buyer chooses only how many pieces, up to the stock — never a yardage', async () => {
    await tryOn('/ai-tryon?product=12', 12, 'Sika Futuro Wrap');
    expect(screen.queryByRole('button', { name: /yards$/ })).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Increase quantity' });
    fireEvent.click(more);
    expect(more).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/ }));
    expect(addToCart.mock.calls[0][0]).toMatchObject({ id: 12, yards: 12, quantity: 2 });
    expect(screen.getByRole('link', { name: /Added — go to cart/ })).toHaveAttribute('href', '/cart');
  });

  it('Buy Now adds the piece once and goes to the cart', async () => {
    await tryOn('/ai-tryon?product=12', 12, 'Sika Futuro Wrap');
    fireEvent.click(screen.getByRole('button', { name: /Buy Now/ }));
    expect(addToCart).toHaveBeenCalledTimes(1);
    expect(addToCart.mock.calls[0][0]).toMatchObject({ id: 12, yards: 12, quantity: 1 });
    expect(screen.getByTestId('where')).toHaveTextContent('/cart');
  });

  it('Buy Now after Add to Cart does not add the piece twice', async () => {
    await tryOn('/ai-tryon?product=11', 11, 'Adinkra Royal Stole');
    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/ }));
    fireEvent.click(screen.getByRole('button', { name: /Buy Now/ }));
    expect(addToCart).toHaveBeenCalledTimes(1);
  });

  it('a sold-out product cannot be added from the result', async () => {
    await tryOn('/ai-tryon?product=13&yards=2', 13, 'Sold Out Stole');
    expect(screen.queryByRole('button', { name: /Add to Cart/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buy Now/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sold out/ })).toHaveAttribute('href', '/product/13');
  });

  it('Try Again keeps the same product and releases the private image URL', async () => {
    await tryOn('/ai-tryon?product=11', 11, 'Adinkra Royal Stole');
    fireEvent.click(screen.getByRole('button', { name: /Try Again/ }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local/11');
    expect(screen.getByText("You're trying on")).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await pickPhotoAndConsent();
    fireEvent.click(screen.getByRole('button', { name: /Try On Adinkra Royal Stole/ }));
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(2));
    expect(createJob.mock.calls.map((c) => c[1])).toEqual([11, 11]);
  });
});

describe('ineligible products and unavailable feature', () => {
  it('an unsupported product explains why and offers no upload', async () => {
    getProductEligibility.mockResolvedValue({ productId: 11, enabled: true, eligible: false, reason: 'AI try-on is only available for Kente you wear.' });
    renderAt('/ai-tryon?product=11');
    expect(await screen.findByText('AI try-on is only available for Kente you wear.')).toBeInTheDocument();
    expect(screen.queryByText('pick photo')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to product/ })).toHaveAttribute('href', '/product/11');
  });

  it('a missing / hidden product is rejected', async () => {
    getProductEligibility.mockRejectedValue(new TryOnRequestError('That Kente cloth is not available for AI try-on.', 404));
    renderAt('/ai-tryon?product=999');
    expect(await screen.findByText(/This product isn't available/)).toBeInTheDocument();
    expect(screen.queryByText('pick photo')).not.toBeInTheDocument();
  });

  it('feature switched off is explained', async () => {
    getProductEligibility.mockResolvedValue({ productId: 11, enabled: false, eligible: true, reason: null });
    renderAt('/ai-tryon?product=11');
    expect(await screen.findByText(/AI try-on is offline/)).toBeInTheDocument();
  });
});

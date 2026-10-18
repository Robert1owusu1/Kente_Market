// Delivery-fee editor shared by the admin (platform defaults) and sellers.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ShippingFeesEditor from '../ShippingFeesEditor';
import { describeRate } from '../../../utils/shippingFees';

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const carriers = [
  { code: 'local_gh', name: 'Ghana Local Delivery', countries: ['GH'] },
  { code: 'dhl', name: 'DHL Express', countries: ['GB', 'US'] },
];
const platformGH = { countryCode: 'GH', baseCost: 15, perKgCost: 0, freeThreshold: 200, currency: 'GHS', transitDaysMin: 2, transitDaysMax: 5, carrierCode: 'local_gh', carrierName: 'Ghana Local Delivery' };

describe('ShippingFeesEditor', () => {
  it('a seller without a fee sees the platform default it falls back to', () => {
    render(<ShippingFeesEditor mode="vendor" countries={['GH']} rates={[]} defaults={[platformGH]} carriers={carriers} onSave={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/Platform default/)).toHaveTextContent('free over');
    expect(screen.getByRole('button', { name: /Set my fee/ })).toBeInTheDocument();
  });

  it('Ghana fees are cedis only, with Ghana couriers; the form sends numbers', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<ShippingFeesEditor mode="admin" countries={['GH']} rates={[]} carriers={carriers} onSave={onSave} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Set fee/ }));
    const currency = screen.getByLabelText('Currency') as HTMLSelectElement;
    expect([...currency.options].map((o) => o.value)).toEqual(['GHS']);
    expect([...(screen.getByLabelText('Courier') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['local_gh']);
    fireEvent.change(screen.getByLabelText('Delivery fee'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/Free delivery when/), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save fee' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      countryCode: 'GH', baseCost: 20, freeThreshold: 300, currency: 'GHS', transitDaysMin: 2, transitDaysMax: 5, carrierCode: 'local_gh',
    }));
  });

  it('abroad, a fee may be in cedis or the local currency; empty free amount means never free', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<ShippingFeesEditor mode="vendor" countries={['GB']} rates={[]} carriers={carriers} onSave={onSave} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Set my fee/ }));
    expect([...(screen.getByLabelText('Currency') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['GHS', 'GBP']);
    fireEvent.change(screen.getByLabelText('Delivery fee'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save fee' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ countryCode: 'GB', baseCost: 12, currency: 'GBP', freeThreshold: null, carrierCode: 'dhl' })));
  });

  it('an existing fee can be removed after confirmation', async () => {
    const onRemove = vi.fn().mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ShippingFeesEditor mode="vendor" countries={['GH']} rates={[{ ...platformGH, baseCost: 25, freeThreshold: null }]} carriers={carriers} onSave={vi.fn()} onRemove={onRemove} />);
    expect(screen.getByText(/Your fee:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the delivery fee for Ghana' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('GH'));
  });

  it('describeRate states the fee, free threshold, days and courier', () => {
    const text = describeRate(platformGH);
    expect(text).toMatch(/15/);
    expect(text).toMatch(/free over/);
    expect(text).toMatch(/2–5 days/);
    expect(text).toMatch(/Ghana Local Delivery/);
  });
});

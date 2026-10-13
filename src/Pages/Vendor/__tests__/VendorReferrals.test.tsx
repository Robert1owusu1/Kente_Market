// Sellers get a store link and a home link that both carry their referral
// code, and are told the reward does not reduce their sale payout.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';

vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));
vi.mock('../../../slices/referralsApiSlice', () => ({
  useGetMyReferralsQuery: () => ({
    data: {
      code: 'SELLER23', link: 'https://kente.test/?ref=SELLER23', enabled: true, tier: 'standard', rate: 0.04, windowDays: 365,
      suspended: false, referredCount: 5, wallet: { balance: 120, reserved: 0, totalEarned: 160, totalWithdrawn: 40, totalSpent: 0 },
      minWithdrawal: 10, payoutAccount: null,
      commissions: [{ id: 1, status: 'pending', amount: 40, originalAmount: 40, customer: 'A***', order: '•••1', createdAt: '2026-10-12', availableAt: null }],
      withdrawals: [],
    },
    isLoading: false, isError: false,
  }),
}));
const { default: VendorReferrals } = await import('../VendorReferrals');

describe('VendorReferrals', () => {
  it('shows the store link and home link with the referral code', () => {
    render(<MemoryRouter><VendorReferrals storeSlug="bonwire-looms" /></MemoryRouter>);
    expect(screen.getByDisplayValue('https://kente.test/store/bonwire-looms?ref=SELLER23')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://kente.test/?ref=SELLER23')).toBeInTheDocument();
    expect(screen.getByText(/including orders from your own store/)).toBeInTheDocument();
    expect(screen.getByText(/your sale payout is not reduced/)).toBeInTheDocument();
    expect(screen.getByText('GH₵40.00')).toBeInTheDocument(); // pending
  });

  it('works without a store slug (home link only)', () => {
    render(<MemoryRouter><VendorReferrals storeSlug={null} /></MemoryRouter>);
    expect(screen.queryByLabelText('Your store, with your referral code')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('https://kente.test/?ref=SELLER23')).toBeInTheDocument();
  });
});

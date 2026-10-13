// Ambassador page: shows only server values (masked buyers), and a withdrawal
// double-click reuses one request key so the server creates one withdrawal.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const withdrawMock = vi.fn();
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const data = {
  code: 'ABCDEFGH', link: 'https://kente.test/?ref=ABCDEFGH', enabled: true, tier: 'standard', rate: 0.04, windowDays: 30,
  suspended: false, referredCount: 3,
  wallet: { balance: 80, reserved: 0, totalEarned: 120, totalWithdrawn: 40, totalSpent: 0 },
  minWithdrawal: 10, payoutAccount: 'MoMo MTN •••4567',
  commissions: [
    { id: 1, status: 'available', amount: 40, originalAmount: 40, customer: 'A***', order: '•••1234', createdAt: '2026-10-01', availableAt: '2026-10-09' },
    { id: 2, status: 'reversed', amount: 0, originalAmount: 40, customer: 'K***', order: '•••9876', createdAt: '2026-10-02', availableAt: null },
  ],
  withdrawals: [],
};
vi.mock('../../../slices/referralsApiSlice', () => ({
  useGetMyReferralsQuery: () => ({ data, isLoading: false, isError: false }),
  useSetReferralPayoutAccountMutation: () => [vi.fn(), { isLoading: false }],
  useWithdrawReferralEarningsMutation: () => [withdrawMock, { isLoading: false }],
}));
const { default: ReferralsPage } = await import('../ReferralsPage');

describe('ReferralsPage', () => {
  beforeEach(() => {
    withdrawMock.mockReset();
    withdrawMock.mockReturnValue({ unwrap: () => Promise.reject({ data: { message: 'network' } }) });
  });

  it('renders the link, rate, window and masked purchases from the server', () => {
    render(<ReferralsPage />);
    expect(screen.getByDisplayValue('https://kente.test/?ref=ABCDEFGH')).toBeInTheDocument();
    expect(screen.getByText(/4% of the/)).toBeInTheDocument();
    expect(screen.getByText('A***')).toBeInTheDocument();
    expect(screen.getByText('Reversed')).toBeInTheDocument();
    expect(screen.getByText(/was GH₵40.00/)).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('a retried withdrawal for the same amount reuses the request key', async () => {
    render(<ReferralsPage />);
    fireEvent.change(screen.getByPlaceholderText('Amount (GH₵)'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdrawMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdrawMock).toHaveBeenCalledTimes(2));
    const [a, b] = withdrawMock.mock.calls.map((c) => c[0]);
    expect(a.amount).toBe('25');
    expect(a.requestKey).toBe(b.requestKey);
  });
});

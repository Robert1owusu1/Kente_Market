// Admin referrals page: no way to mark a withdrawal paid or edit a balance;
// a review decision always carries the admin's note.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const reviewMock = vi.fn();
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../slices/referralsApiSlice', () => ({
  useGetReferralSettingsQuery: () => ({ data: { enabled: true, standardRate: 0.04, windowDays: 30, platformRate: 0.1 }, isLoading: false }),
  useUpdateReferralSettingsMutation: () => [vi.fn(), { isLoading: false }],
  useGetAmbassadorsQuery: () => ({ data: [], isFetching: false }),
  useUpdateAmbassadorMutation: () => [vi.fn(), { isLoading: false }],
  useGetReferralCommissionsQuery: () => ({
    data: [{ id: 7, orderId: 1, orderNumber: 'ORD-1', referrerId: 2, referrerEmail: 'kwame@x.test', customerEmail: 'ama@x.test',
      base: 1000, rate: 0.04, cap: 200, amount: 40, currentAmount: 40, status: 'under_review', reviewReasons: ['same_phone'],
      reviewNote: null, paymentStatus: 'paid', orderStatus: 'processing', created_at: '2026-10-12' }],
    isFetching: false,
  }),
  useReviewReferralCommissionMutation: () => [reviewMock, { isLoading: false }],
  useGetReferralWithdrawalsQuery: () => ({
    data: [{ id: 3, userId: 2, email: 'kwame@x.test', amount: 25, currency: 'GHS', reference: 'kente_rtr_x', status: 'processing', providerStatus: null, lastError: null, created_at: '2026-10-12' }],
    isFetching: false,
  }),
  useVerifyReferralWithdrawalMutation: () => [vi.fn(), { isLoading: false }],
}));
const { default: ReferralsAdminPage } = await import('../ReferralsAdminPage');

describe('ReferralsAdminPage', () => {
  beforeEach(() => {
    reviewMock.mockReset();
    reviewMock.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  });

  it('offers verify-with-Paystack but no manual paid / balance controls', () => {
    render(<ReferralsAdminPage />);
    expect(screen.getByText(/Verify with Paystack/)).toBeInTheDocument();
    for (const forbidden of [/mark (as )?paid/i, /force/i, /adjust balance/i, /set balance/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
    expect(screen.getByText('Same phone number as the referrer')).toBeInTheDocument();
  });

  it('sends the decision with the justification note', async () => {
    render(<ReferralsAdminPage />);
    fireEvent.change(screen.getByLabelText('Note for 7'), { target: { value: 'Same household' } });
    fireEvent.click(screen.getByText('Reject'));
    await waitFor(() => expect(reviewMock).toHaveBeenCalledWith({ id: 7, decision: 'reject', note: 'Same household' }));
  });
});

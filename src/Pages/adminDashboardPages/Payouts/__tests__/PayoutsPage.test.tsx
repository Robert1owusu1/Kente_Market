// The admin payout page must never offer a way to move money that bypasses
// Paystack: no force-paid / retry-transfer control, a parked payout can only
// be re-verified with an acknowledgement + justification, and an unknown
// outcome is never presented as success. The server enforces all of this;
// this test pins that the UI does not contradict it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const reconcileMock = vi.fn();
const noteMock = vi.fn();
const toastMock = { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() };

vi.mock('react-toastify', () => ({ toast: toastMock }));

const baseAttempt = {
  withdrawalId: 9, allocationId: 3, vendorId: 42, businessName: 'Bonwire Looms', amount: '40.00',
  amountMinor: 4000, currency: 'GHS', providerReference: null, providerStatus: 'pending',
  initiatedAt: '2026-10-12T10:00:00Z', initiateHttpStatus: null, lastError: null, checkCount: 2,
  lastCheckedAt: '2026-10-12T11:00:00Z', alertedReason: null, resolutionNote: null,
  created_at: '2026-10-12T09:00:00Z', ageMinutes: 125,
};
type Row = typeof baseAttempt & { id: number; reference: string; status: string; reviewReason: string | null; explanation: string };
const processing: Row = { ...baseAttempt, id: 1, reference: 'kente_tr_ref_processing', status: 'processing', reviewReason: null, explanation: 'Waiting for Paystack confirmation.' };
const parked: Row = { ...baseAttempt, id: 2, reference: 'kente_tr_ref_parked', status: 'reconciliation_required', reviewReason: 'amount_mismatch: provider reports 3990', explanation: 'Automation stopped: amount_mismatch.' };

const detailFor = (attempt: Row) => ({
  attempt,
  allocation: null,
  journal: [],
  consistency: { wallet: 40, allocations: 0, inFlight: 40, delta: 0, ok: true },
  history: [{ id: 7, actorId: 1, actorEmail: 'ops@kente.test', action: 'payout.note', beforeVal: null, afterVal: { resolutionNote: 'asked Paystack support' }, created_at: '2026-10-12T11:30:00Z' }],
  canReverify: true,
  reverifyNeedsJustification: attempt.status === 'reconciliation_required',
});

vi.mock('../../../../slices/adminPayoutsApiSlice', () => ({
  useGetUnresolvedPayoutsQuery: () => ({ data: { count: 2, payouts: [processing, parked] }, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false }),
  useGetPayoutDetailQuery: (id: number) => ({ data: detailFor(id === 1 ? processing : parked), isLoading: false, isError: false }),
  useReconcilePayoutMutation: () => [reconcileMock, { isLoading: false }],
  useAddPayoutNoteMutation: () => [noteMock, { isLoading: false }],
}));

const { default: PayoutsPage } = await import('../PayoutsPage');

describe('PayoutsPage', () => {
  beforeEach(() => {
    reconcileMock.mockReset();
    noteMock.mockReset();
    Object.values(toastMock).forEach((m) => m.mockReset());
  });

  it('lists amount, currency, vendor, state, age and reason — and offers no force/retry control', () => {
    render(<PayoutsPage />);
    expect(screen.getAllByText('GHS 40.00').length).toBe(2);
    expect(screen.getAllByText(/Bonwire Looms/).length).toBe(2);
    expect(screen.getByText('needs review')).toBeInTheDocument();
    expect(screen.getByText('Automation stopped: amount_mismatch.')).toBeInTheDocument();
    expect(screen.getAllByText('2 h').length).toBe(2);
    for (const forbidden of [/force/i, /mark (as )?paid/i, /retry transfer/i, /re-?send/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).toBeNull();
    }
  });

  it('a parked payout cannot be re-verified without acknowledgement and a justification', async () => {
    reconcileMock.mockReturnValue({ unwrap: () => Promise.resolve({ outcome: 'review', severity: 'warning', message: 'still unsafe' }) });
    render(<PayoutsPage />);
    fireEvent.click(screen.getByText('#2'));
    const verify = await screen.findByRole('button', { name: /verify with paystack/i });
    expect(verify).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(verify).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/why is re-verification safe/i), { target: { value: 'short' } });
    expect(verify).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/why is re-verification safe/i), { target: { value: 'Dashboard shows 39.90 sent; escalated to eng' } });
    expect(verify).toBeEnabled();
    fireEvent.click(verify);
    await waitFor(() => expect(reconcileMock).toHaveBeenCalledWith({ id: 2, acknowledge: true, note: 'Dashboard shows 39.90 sent; escalated to eng' }));
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith('still unsafe'));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('an unknown outcome (Paystack unreachable) is shown as an error, never as success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    reconcileMock.mockReturnValue({ unwrap: () => Promise.resolve({ outcome: 'errored', severity: 'error', message: 'Paystack could not be reached. Nothing changed.' }) });
    render(<PayoutsPage />);
    fireEvent.click(screen.getByText('#1'));
    fireEvent.click(await screen.findByRole('button', { name: /verify with paystack/i }));
    await waitFor(() => expect(reconcileMock).toHaveBeenCalledWith({ id: 1 }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(await screen.findByText(/Nothing changed/)).toBeInTheDocument();
  });

  it('shows the action history and records investigation notes', async () => {
    noteMock.mockReturnValue({ unwrap: () => Promise.resolve({ message: 'Note recorded' }) });
    render(<PayoutsPage />);
    fireEvent.click(screen.getByText('#1'));
    expect(await screen.findByText('asked Paystack support')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: /add note/i });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Findings, ticket numbers/i), { target: { value: 'Paystack ticket #123 opened' } });
    fireEvent.click(add);
    await waitFor(() => expect(noteMock).toHaveBeenCalledWith({ id: 1, note: 'Paystack ticket #123 opened' }));
  });
});

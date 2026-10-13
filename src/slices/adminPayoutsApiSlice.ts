// slices/adminPayoutsApiSlice.ts
// Admin payout investigation (backend: routes/adminPayoutRoutes.js). The only
// money-affecting call is `reconcilePayout`, which asks Paystack and applies
// exactly what Paystack confirms — it can never send a transfer.
import { ADMIN_PAYOUTS_URL } from '../constant';
import { apiSlice } from './apiSlice';

export type PayoutStatus = 'processing' | 'succeeded' | 'failed' | 'reversed' | 'reconciliation_required';
export type ReconcileOutcome =
  | 'succeeded' | 'failed' | 'reversed' | 'pending' | 'attention' | 'review' | 'errored' | 'already' | 'skipped';
export type OutcomeSeverity = 'success' | 'info' | 'warning' | 'error';

export interface PayoutAttempt {
  id: number;
  withdrawalId: number | null;
  allocationId: number;
  vendorId: number;
  businessName: string | null;
  amount: string | number;
  amountMinor: number | null;
  currency: string;
  reference: string;
  providerReference: string | null;
  status: PayoutStatus;
  providerStatus: string | null;
  initiatedAt: string | null;
  initiateHttpStatus: number | null;
  lastError: string | null;
  checkCount: number;
  lastCheckedAt: string | null;
  reviewReason: string | null;
  alertedReason: string | null;
  resolutionNote: string | null;
  created_at: string;
  ageMinutes: number;
  explanation: string;
  outcomeKnown?: string;
}

export interface PayoutHistoryEntry {
  id: number;
  actorId: number | null;
  actorEmail: string | null;
  action: string;
  beforeVal: unknown;
  afterVal: unknown;
  created_at: string;
}

export interface PayoutDetail {
  attempt: PayoutAttempt;
  allocation: { id: number; orderId: number; status: string; payoutAmount: string | number } | null;
  journal: { eventType: string; amount: string | number; direction: string; reference: string | null; created_at: string }[];
  consistency: { wallet: number; allocations: number; inFlight: number; delta: number; ok: boolean };
  history: PayoutHistoryEntry[];
  canReverify: boolean;
  reverifyNeedsJustification: boolean;
}

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  severity: OutcomeSeverity;
  message: string;
}

export const adminPayoutsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getUnresolvedPayouts: builder.query<{ count: number; payouts: PayoutAttempt[] }, { status?: string } | void>({
      query: (args) => ({ url: `${ADMIN_PAYOUTS_URL}/unresolved`, params: args?.status ? { status: args.status } : undefined }),
      providesTags: ['Payout'],
    }),
    getPayoutDetail: builder.query<PayoutDetail, number>({
      query: (id) => `${ADMIN_PAYOUTS_URL}/${id}`,
      providesTags: (_r, _e, id) => [{ type: 'Payout', id }],
    }),
    reconcilePayout: builder.mutation<ReconcileResult, { id: number; acknowledge?: boolean; note?: string }>({
      query: ({ id, ...body }) => ({ url: `${ADMIN_PAYOUTS_URL}/${id}/reconcile`, method: 'POST', body }),
      invalidatesTags: (_r, _e, { id }) => ['Payout', { type: 'Payout', id }],
    }),
    addPayoutNote: builder.mutation<{ message: string }, { id: number; note: string }>({
      query: ({ id, note }) => ({ url: `${ADMIN_PAYOUTS_URL}/${id}/note`, method: 'POST', body: { note } }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Payout', id }],
    }),
  }),
});

export const {
  useGetUnresolvedPayoutsQuery,
  useGetPayoutDetailQuery,
  useReconcilePayoutMutation,
  useAddPayoutNoteMutation,
} = adminPayoutsApiSlice;

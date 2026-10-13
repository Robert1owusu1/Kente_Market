// slices/referralsApiSlice.ts
// Referral (ambassador) programme — backend: routes/referralRoutes.js,
// rules: REFERRAL_SYSTEM_DESIGN.md. Amounts and rates always come from the
// server; the client never sends a commission amount or a referrer id.
import { REFERRALS_URL, ADMIN_REFERRALS_URL } from '../constant';
import { apiSlice } from './apiSlice';

export type ReferralCommissionStatus = 'pending' | 'under_review' | 'available' | 'cancelled' | 'reversed';

export interface MyReferralCommission {
  id: number;
  status: ReferralCommissionStatus;
  amount: number;
  originalAmount: number;
  customer: string;
  order: string;
  createdAt: string;
  availableAt: string | null;
}

export interface ReferralWallet {
  balance: number;
  reserved: number;
  totalEarned: number;
  totalWithdrawn: number;
  totalSpent: number;
}

export interface ReferralWithdrawalRow {
  id: number;
  amount: string | number;
  status: 'processing' | 'paid' | 'failed' | 'reconciliation_required';
  created_at: string;
  settledAt: string | null;
}

export interface MyReferrals {
  code: string;
  link: string;
  enabled: boolean;
  tier: 'standard' | 'super';
  rate: number | null;
  windowDays: number;
  suspended: boolean;
  referredCount: number;
  wallet: ReferralWallet;
  minWithdrawal: number;
  payoutAccount: string | null;
  commissions: MyReferralCommission[];
  withdrawals: ReferralWithdrawalRow[];
}

export interface ReferralSettings {
  enabled: boolean;
  standardRate: number | null;
  windowDays: number;
  platformRate?: number;
  windowChoices?: number[];
}

export interface AdminAmbassador {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  referralCode: string | null;
  ambassadorTier: 'standard' | 'super';
  ambassadorRate: string | number | null;
  ambassadorSuspended: number;
  referredCount: number;
  balance: string | number;
  totalEarned: string | number;
}

export interface AdminReferralCommission {
  id: number;
  orderId: number;
  orderNumber: string;
  referrerId: number;
  referrerEmail: string;
  customerEmail: string;
  base: string | number;
  rate: string | number;
  cap: string | number;
  amount: string | number;
  currentAmount: string | number;
  status: ReferralCommissionStatus;
  reviewReasons: string[] | null;
  reviewNote: string | null;
  paymentStatus: string;
  orderStatus: string;
  created_at: string;
}

export interface AdminReferralWithdrawal {
  id: number;
  userId: number;
  email: string;
  amount: string | number;
  currency: string;
  reference: string;
  status: ReferralWithdrawalRow['status'];
  providerStatus: string | null;
  lastError: string | null;
  created_at: string;
}

export const referralsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    captureReferralVisit: builder.mutation<{ ok: boolean }, string>({
      query: (code) => ({ url: `${REFERRALS_URL}/visit`, method: 'POST', body: { code } }),
    }),
    getMyReferrals: builder.query<MyReferrals, void>({
      query: () => ({ url: `${REFERRALS_URL}/me` }),
      providesTags: ['Referral'],
      keepUnusedDataFor: 5,
    }),
    setReferralPayoutAccount: builder.mutation<{ message: string; payoutAccount: string },
      { type: 'mobile_money' | 'bank'; name: string; accountNumber: string; bankCode: string }>({
      query: (body) => ({ url: `${REFERRALS_URL}/payout-account`, method: 'POST', body }),
      invalidatesTags: ['Referral'],
    }),
    withdrawReferralEarnings: builder.mutation<{ message: string }, { amount: string; requestKey: string }>({
      query: (body) => ({ url: `${REFERRALS_URL}/withdraw`, method: 'POST', body }),
      invalidatesTags: ['Referral'],
    }),
    payOrderWithEarnings: builder.mutation<{ message: string; orderId: number; amount: number }, { orderId: number; acceptFinal: true }>({
      query: (body) => ({ url: `${REFERRALS_URL}/pay-order`, method: 'POST', body }),
      invalidatesTags: ['Referral', 'Order'],
    }),
    // ---- admin ----
    getReferralSettings: builder.query<ReferralSettings, void>({
      query: () => ({ url: `${ADMIN_REFERRALS_URL}/settings` }),
      providesTags: ['Referral'],
    }),
    updateReferralSettings: builder.mutation<{ message: string; settings: ReferralSettings },
      { enabled?: boolean; standardRate?: number | string | null; windowDays?: number }>({
      query: (body) => ({ url: `${ADMIN_REFERRALS_URL}/settings`, method: 'PUT', body }),
      invalidatesTags: ['Referral'],
    }),
    getAmbassadors: builder.query<AdminAmbassador[], { search?: string; tier?: 'super' } | void>({
      query: (args) => ({ url: `${ADMIN_REFERRALS_URL}/ambassadors`, params: args || {} }),
      providesTags: ['Referral'],
    }),
    updateAmbassador: builder.mutation<{ message: string },
      { userId: number; tier?: 'standard' | 'super'; rate?: number | string | null; suspended?: boolean }>({
      query: ({ userId, ...body }) => ({ url: `${ADMIN_REFERRALS_URL}/ambassadors/${userId}`, method: 'PUT', body }),
      invalidatesTags: ['Referral'],
    }),
    getReferralCommissions: builder.query<AdminReferralCommission[], { status?: ReferralCommissionStatus } | void>({
      query: (args) => ({ url: `${ADMIN_REFERRALS_URL}/commissions`, params: args || {} }),
      providesTags: ['Referral'],
    }),
    reviewReferralCommission: builder.mutation<{ message: string; status: string },
      { id: number; decision: 'approve' | 'reject'; note: string }>({
      query: ({ id, ...body }) => ({ url: `${ADMIN_REFERRALS_URL}/commissions/${id}/review`, method: 'POST', body }),
      invalidatesTags: ['Referral'],
    }),
    getReferralWithdrawals: builder.query<AdminReferralWithdrawal[], { status?: ReferralWithdrawalRow['status'] } | void>({
      query: (args) => ({ url: `${ADMIN_REFERRALS_URL}/withdrawals`, params: args || {} }),
      providesTags: ['Referral'],
    }),
    verifyReferralWithdrawal: builder.mutation<{ message: string }, number>({
      query: (id) => ({ url: `${ADMIN_REFERRALS_URL}/withdrawals/${id}/verify`, method: 'POST' }),
      invalidatesTags: ['Referral'],
    }),
  }),
});

export const {
  useCaptureReferralVisitMutation,
  useGetMyReferralsQuery,
  useSetReferralPayoutAccountMutation,
  useWithdrawReferralEarningsMutation,
  usePayOrderWithEarningsMutation,
  useGetReferralSettingsQuery,
  useUpdateReferralSettingsMutation,
  useGetAmbassadorsQuery,
  useUpdateAmbassadorMutation,
  useGetReferralCommissionsQuery,
  useReviewReferralCommissionMutation,
  useGetReferralWithdrawalsQuery,
  useVerifyReferralWithdrawalMutation,
} = referralsApiSlice;

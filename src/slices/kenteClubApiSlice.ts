import { apiSlice } from "./apiSlice";

const CLUB_URL = "/api/kente-club";
const ADMIN_CLUB_URL = "/api/admin/kente-club";

export interface MembershipTier {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  billingInterval: "monthly" | "annually";
  discountPercent: number;
  sortOrder: number;
}

export interface AdminMembershipPlan extends MembershipTier {
  paystackPlanCode: string | null;
  isActive: boolean;
  isPublic: boolean;
}

export interface Membership {
  id: number;
  planId: number;
  planName?: string;
  status: "pending" | "active" | "past_due" | "cancelled" | "expired";
  discountPercentAtSubscribe: number;
  currentPeriodEnd?: string | null;
  nextPaymentAt?: string | null;
}

export const kenteClubApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getMembershipTiers: builder.query<MembershipTier[], void>({
      query: () => `${CLUB_URL}/tiers`,
      providesTags: ["Membership"],
    }),
    getMyMembership: builder.query<{ membership: Membership | null; active: boolean; discountPercent: number }, void>({
      query: () => `${CLUB_URL}/me`,
      providesTags: ["Membership"],
    }),
    subscribeMembership: builder.mutation<{ authorizationUrl: string; reference: string; membershipId: number }, { planId: number }>({
      query: (body) => ({ url: `${CLUB_URL}/subscribe`, method: "POST", body }),
      invalidatesTags: ["Membership"],
    }),
    cancelMembership: builder.mutation<{ message: string }, void>({
      query: () => ({ url: `${CLUB_URL}/me`, method: "DELETE" }),
      invalidatesTags: ["Membership"],
    }),
    // Admin
    getAdminMembershipPlans: builder.query<AdminMembershipPlan[], void>({
      query: () => `${ADMIN_CLUB_URL}/plans`,
      providesTags: ["Membership"],
    }),
    updateAdminMembershipPlan: builder.mutation<AdminMembershipPlan, { id: number } & Partial<AdminMembershipPlan>>({
      query: ({ id, ...body }) => ({ url: `${ADMIN_CLUB_URL}/plans/${id}`, method: "PUT", body }),
      invalidatesTags: ["Membership"],
    }),
    setAdminMembershipActive: builder.mutation<AdminMembershipPlan, { id: number; active: boolean }>({
      query: ({ id, active }) => ({ url: `${ADMIN_CLUB_URL}/plans/${id}/activate`, method: "PUT", body: { active } }),
      invalidatesTags: ["Membership"],
    }),
  }),
});

export const {
  useGetMembershipTiersQuery,
  useGetMyMembershipQuery,
  useSubscribeMembershipMutation,
  useCancelMembershipMutation,
  useGetAdminMembershipPlansQuery,
  useUpdateAdminMembershipPlanMutation,
  useSetAdminMembershipActiveMutation,
} = kenteClubApiSlice;

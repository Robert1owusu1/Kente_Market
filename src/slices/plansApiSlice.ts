import { apiSlice } from "./apiSlice";

const ADMIN_PLANS_URL = "/api/admin/plans";

export interface AdminPlan {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  billingInterval: "monthly" | "annually";
  commissionRate: number | null;
  paystackPlanCode: string | null;
  features: string[];
  productLimit: number | null;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
}

export const plansApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAdminPlans: builder.query<AdminPlan[], void>({
      query: () => ADMIN_PLANS_URL,
      providesTags: ["Plan"],
    }),
    createAdminPlan: builder.mutation<AdminPlan, Partial<AdminPlan>>({
      query: (body) => ({ url: ADMIN_PLANS_URL, method: "POST", body }),
      invalidatesTags: ["Plan"],
    }),
    updateAdminPlan: builder.mutation<AdminPlan, { id: number | string } & Partial<AdminPlan>>({
      query: ({ id, ...body }) => ({ url: `${ADMIN_PLANS_URL}/${id}`, method: "PUT", body }),
      invalidatesTags: ["Plan"],
    }),
    setAdminPlanActive: builder.mutation<AdminPlan, { id: number | string; active: boolean }>({
      query: ({ id, active }) => ({ url: `${ADMIN_PLANS_URL}/${id}/activate`, method: "PUT", body: { active } }),
      invalidatesTags: ["Plan"],
    }),
    getPlanSettings: builder.query<PlanGateSettings, void>({
      query: () => `${ADMIN_PLANS_URL}/settings`,
      providesTags: ["Plan"],
    }),
    updatePlanSettings: builder.mutation<PlanGateSettings, Partial<PlanGateSettings>>({
      query: (body) => ({ url: `${ADMIN_PLANS_URL}/settings`, method: "PUT", body }),
      invalidatesTags: ["Plan"],
    }),
  }),
});

export interface PlanGateSettings {
  required: boolean;
  bonwireVerificationRequired: boolean;
}

export const {
  useGetAdminPlansQuery,
  useCreateAdminPlanMutation,
  useUpdateAdminPlanMutation,
  useSetAdminPlanActiveMutation,
  useGetPlanSettingsQuery,
  useUpdatePlanSettingsMutation,
} = plansApiSlice;

import { USERS_URL } from "../constant";
import { apiSlice } from "./apiSlice";
import type { AuthUser } from "../types/domain";

export const usersApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // 🔹 Login
    login: builder.mutation<Record<string, unknown>, { email: string; password: string }>({
      query: (data) => ({
        url: `${USERS_URL}/auth`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),

    // 🔹 Register
    register: builder.mutation<Record<string, unknown>, Record<string, unknown>>({
      query: (data) => ({
        url: `${USERS_URL}`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),

    // 🔹 Logout
    logout: builder.mutation<{ message?: string }, void>({
      query: () => ({
        url: `${USERS_URL}/logout`,
        method: "POST",
      }),
      invalidatesTags: ["User"],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } finally {
          // Drop another logged-in user's data from the Redux cache so nothing
          // sensitive survives a session switch.
          dispatch(apiSlice.util.resetApiState());
          // Purge any cached pages from the service worker (they may have been
          // personalized) so the next visitor sees a fresh network response.
          if ("caches" in window) {
            try {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            } catch { /* best-effort */ }
          }
        }
      },
    }),

    // ⭐ NEW: Verify Email
    verifyEmail: builder.mutation<Record<string, unknown>, Record<string, unknown>>({
      query: (data) => ({
        url: `${USERS_URL}/verify-email`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),

    // ⭐ NEW: Resend OTP
    resendOTP: builder.mutation<{ message?: string }, void>({
      query: () => ({
        url: `${USERS_URL}/resend-otp`,
        method: "POST",
      }),
    }),

    // ⭐ NEW: Get Verification Status
    getVerificationStatus: builder.query<{ verified?: boolean; [key: string]: unknown }, void>({
      query: () => ({
        url: `${USERS_URL}/verification-status`,
        method: "GET",
      }),
      providesTags: ["User"],
    }),

    // ✅ Get user profile (authenticated user)
    getProfile: builder.query<AuthUser, void>({
      query: () => ({
        url: `${USERS_URL}/profile`,
        method: "GET",
      }),
      providesTags: ["User"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Update user profile (authenticated user)
    updateProfile: builder.mutation<AuthUser, Record<string, unknown>>({
      query: (data) => ({
        url: `${USERS_URL}/profile`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["User"],
      async onQueryStarted(_arg, { queryFulfilled }) {
        try {
          await queryFulfilled;
        } catch (error) {
          console.error('Profile update error:', error);
        }
      },
    }),

    // ✅ Get all users (admin only)
    getUsers: builder.query<AuthUser[], void>({
      query: () => ({
        url: USERS_URL,
        method: "GET",
      }),
      providesTags: ["User"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Delete user (admin only)
    deleteUser: builder.mutation<{ message?: string }, number | string>({
      query: (userId) => ({
        url: `${USERS_URL}/${userId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["User"],
    }),

    // ✅ Get user by ID (admin only)
    getUserById: builder.query<AuthUser, number | string>({
      query: (userId) => ({
        url: `${USERS_URL}/${userId}`,
        method: "GET",
      }),
      providesTags: (_result, _error, userId) => [{ type: "User", id: userId }] as const,
    }),

    // ✅ Update user by ID (admin only)
    updateUser: builder.mutation<AuthUser, { userId: number | string; [key: string]: unknown }>({
      query: ({ userId, ...data }) => ({
        url: `${USERS_URL}/${userId}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: "User", id: arg.userId },
        "User",
      ] as const,
    }),
  }),
});

export const {
  useLoginMutation,
  useRegisterMutation,
  useLogoutMutation,
  useVerifyEmailMutation,        // ⭐ NEW
  useResendOTPMutation,          // ⭐ NEW
  useGetVerificationStatusQuery, // ⭐ NEW
  useGetProfileQuery,
  useUpdateProfileMutation,
  useGetUsersQuery,
  useDeleteUserMutation,
  useGetUserByIdQuery,
  useUpdateUserMutation,
} = usersApiSlice;
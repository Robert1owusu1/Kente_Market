import { USERS_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export const usersApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // 🔹 Login
    login: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}/auth`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),

    // 🔹 Register
    register: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),

    // 🔹 Logout
    logout: builder.mutation({
      query: () => ({
        url: `${USERS_URL}/logout`,
        method: "POST",
      }),
      invalidatesTags: ["User"],
    }),

    // ⭐ NEW: Verify Email
    verifyEmail: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}/verify-email`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["User"],
    }),

    // ⭐ NEW: Resend OTP
    resendOTP: builder.mutation({
      query: () => ({
        url: `${USERS_URL}/resend-otp`,
        method: "POST",
      }),
    }),

    // ⭐ NEW: Get Verification Status
    getVerificationStatus: builder.query({
      query: () => ({
        url: `${USERS_URL}/verification-status`,
        method: "GET",
      }),
      providesTags: ["User"],
    }),

    // ✅ Get user profile (authenticated user)
    getProfile: builder.query({
      query: () => ({
        url: `${USERS_URL}/profile`,
        method: "GET",
      }),
      providesTags: ["User"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Update user profile (authenticated user)
    updateProfile: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}/profile`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: ["User"],
      async onQueryStarted(arg, { queryFulfilled }) {
        try {
          await queryFulfilled;
        } catch (error) {
          console.error('Profile update error:', error);
        }
      }
    }),

    // ✅ Get all users (admin only)
    getUsers: builder.query({
      query: () => ({
        url: USERS_URL,
        method: "GET",
      }),
      providesTags: ["User"],
      keepUnusedDataFor: 5,
    }),

    // ✅ Delete user (admin only)
    deleteUser: builder.mutation({
      query: (userId) => ({
        url: `${USERS_URL}/${userId}`,
        method: "DELETE",
      }),
      invalidatesTags: ["User"],
    }),

    // ✅ Get user by ID (admin only)
    getUserById: builder.query({
      query: (userId) => ({
        url: `${USERS_URL}/${userId}`,
        method: "GET",
      }),
      providesTags: (result, error, userId) => [{ type: "User", id: userId }],
    }),

    // ✅ Update user by ID (admin only)
    updateUser: builder.mutation({
      query: ({ userId, ...data }) => ({
        url: `${USERS_URL}/${userId}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (result, error, { userId }) => [
        { type: "User", id: userId },
        "User",
      ],
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
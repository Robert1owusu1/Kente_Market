import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuthUser } from "../types/domain";

interface AuthState {
  userInfo: AuthUser | null;
}

const initialState: AuthState = {
  userInfo: localStorage.getItem('userInfo')
    ? (JSON.parse(localStorage.getItem('userInfo') as string) as AuthUser)
    : null,
};

// Backend may return the user directly or nested under `user`, and may send
// `isAdmin` or only `role`. Normalize everything into a flat AuthUser with a
// consistent isAdmin flag.
const normalizeUser = (payload: Record<string, unknown>): AuthUser => {
  const source = payload.user && typeof payload.user === 'object'
    ? (payload.user as Record<string, unknown>)
    : payload;
  const userData = { ...source } as Record<string, unknown>;
  const { token: _token, ...rest } = userData;
  void _token;
  const user = { ...rest } as AuthUser;
  if (typeof user.role === 'string' && typeof user.isAdmin !== 'boolean') {
    user.isAdmin = user.role === 'admin';
  }
  return user;
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials: (state, action: PayloadAction<Record<string, unknown>>) => {
      const userInfo = normalizeUser(action.payload);
      state.userInfo = userInfo;
      localStorage.setItem('userInfo', JSON.stringify(userInfo));
    },

    logout: (state) => {
      state.userInfo = null;
      localStorage.removeItem('userInfo');
    },

    // Refresh the stored role/isAdmin from the latest backend profile so the UI
    // (e.g. "Become a Seller" vs "Seller Dashboard") stays in sync after an admin
    // promotes/demotes a vendor without requiring re-login.
    syncUserRole: (state, action: PayloadAction<AuthUser | null | undefined>) => {
      if (!state.userInfo) return;
      const fresh = action.payload;
      if (!fresh || !fresh.role) return;
      state.userInfo = {
        ...state.userInfo,
        role: fresh.role,
        isAdmin: typeof fresh.isAdmin === 'boolean' ? fresh.isAdmin : fresh.role === 'admin',
      };
      localStorage.setItem('userInfo', JSON.stringify(state.userInfo));
    },
  },
});

export const { setCredentials, logout, syncUserRole } = authSlice.actions;

export default authSlice.reducer;
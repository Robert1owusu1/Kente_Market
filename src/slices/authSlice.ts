import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuthUser } from "../types/domain";

interface AuthState {
  userInfo: AuthUser | null;
}

const USER_INFO_KEY = "userInfo";
// PII lifetime: stored profile data is dropped after 7 days without a fresh
// login so a shared/unattended browser does not keep personal details around
// indefinitely.
const USER_INFO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** What we actually write to localStorage: the user plus when we saved it. */
interface PersistedUserInfo {
  user: AuthUser;
  savedAt: number;
}

const persistUserInfo = (user: AuthUser): void => {
  try {
    localStorage.setItem(USER_INFO_KEY, JSON.stringify({ user, savedAt: Date.now() }));
  } catch {
    /* storage full / private mode — state still holds the user */
  }
};

// Safe load: malformed JSON must never crash the app at module load (same
// pattern as CartContext.getInitialCart). Also enforces the 7-day lifetime and
// migrates the legacy bare-object format by attaching "now" as savedAt.
const loadUserInfo = (): AuthUser | null => {
  try {
    const raw = localStorage.getItem(USER_INFO_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const record = parsed as Partial<PersistedUserInfo> & Record<string, unknown>;
    // Envelope format is identified by a numeric savedAt; anything else is the
    // legacy bare AuthUser object.
    const isEnvelope =
      typeof record.savedAt === "number" &&
      record.user !== undefined &&
      typeof record.user === "object" &&
      record.user !== null;

    const user = isEnvelope ? (record.user as AuthUser) : (parsed as AuthUser);
    const savedAt = isEnvelope && record.savedAt !== undefined ? record.savedAt : Date.now();

    if (Date.now() - savedAt > USER_INFO_MAX_AGE_MS) {
      // Expired: clear the PII and treat the visitor as logged out.
      localStorage.removeItem(USER_INFO_KEY);
      return null;
    }

    if (!isEnvelope) {
      // Migrate the legacy bare-object format to { user, savedAt }.
      try {
        localStorage.setItem(USER_INFO_KEY, JSON.stringify({ user, savedAt }));
      } catch {
        /* ignore */
      }
    }

    return user;
  } catch (error) {
    console.error("Error loading userInfo from localStorage:", error);
    return null;
  }
};

const initialState: AuthState = {
  userInfo: loadUserInfo(),
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
      persistUserInfo(userInfo);
    },

    logout: (state) => {
      state.userInfo = null;
      localStorage.removeItem(USER_INFO_KEY);
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
      persistUserInfo(state.userInfo);
    },
  },
});

export const { setCredentials, logout, syncUserRole } = authSlice.actions;

export default authSlice.reducer;

import { configureStore } from '@reduxjs/toolkit';
import { apiSlice } from './slices/apiSlice';
import authSliceReducer from './slices/authSlice';
import type { TypedUseSelectorHook } from 'react-redux';
import { useDispatch, useSelector } from 'react-redux';
import { resetCsrfToken } from './utils/csrf';

const store = configureStore({
  reducer: {
    [apiSlice.reducerPath]: apiSlice.reducer,
    auth: authSliceReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(apiSlice.middleware),
  devTools: import.meta.env.DEV,
});

// The CSRF token rotates whenever a session is created or destroyed (login,
// logout, OAuth exchange). Reset the in-memory copy on those transitions; it
// is re-fetched (lazily) with the fresh cookie on the next state-changing
// request.
//
// Keyed on the userInfo *reference*, not on the signed-in boolean: session
// issuance always rotates the csrf cookie (generateToken -> setCsrfCookie),
// and a user whose localStorage still holds userInfo when they sign in again
// (expired JWT, no 401 seen yet) never flips the boolean — leaving the old
// token cached against a cookie that has already changed, i.e. 403 "CSRF
// token mismatch" on their next state-changing request. Comparing the object
// catches that rotation, and any other auth-state mutation, for free.
let lastUserInfo = store.getState().auth?.userInfo;
store.subscribe(() => {
  const nowUserInfo = store.getState().auth?.userInfo;
  if (nowUserInfo !== lastUserInfo) {
    lastUserInfo = nowUserInfo;
    resetCsrfToken();
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export default store;
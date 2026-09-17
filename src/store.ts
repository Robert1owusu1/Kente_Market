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
let lastSignedIn = Boolean(store.getState().auth?.userInfo);
store.subscribe(() => {
  const nowSignedIn = Boolean(store.getState().auth?.userInfo);
  if (nowSignedIn !== lastSignedIn) {
    lastSignedIn = nowSignedIn;
    resetCsrfToken();
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export default store;
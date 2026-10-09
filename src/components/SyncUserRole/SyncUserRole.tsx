// components/SyncUserRole/SyncUserRole.jsx
// Keeps the user's role in Redux/localStorage in sync with the backend on app
// load. This ensures the navbar reflects role changes (e.g. an admin approving
// a vendor) without requiring the user to log out and back in.
import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store';
import { useGetProfileQuery } from '../../slices/usersApiSlice';
import { syncUserRole } from '../../slices/authSlice';

const SyncUserRole = () => {
  const dispatch = useAppDispatch();
  const userInfo = useAppSelector((state) => state.auth.userInfo);

  const { data: profile } = useGetProfileQuery(undefined, {
    // Pending verification (registration flow) has NO session cookie yet —
    // a profile GET here would 401, log the visitor out mid-signup and
    // bounce them off /verify-email. Sync resumes once verification issues
    // the real session and clears the flag.
    skip: !userInfo || userInfo.pendingVerification === true,
  });

  useEffect(() => {
    if (profile) {
      dispatch(syncUserRole(profile));
    }
  }, [profile, dispatch]);

  return null;
};

export default SyncUserRole;

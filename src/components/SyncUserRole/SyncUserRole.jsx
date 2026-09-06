// components/SyncUserRole/SyncUserRole.jsx
// Keeps the user's role in Redux/localStorage in sync with the backend on app
// load. This ensures the navbar reflects role changes (e.g. an admin approving
// a vendor) without requiring the user to log out and back in.
import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useGetProfileQuery } from '../../slices/usersApiSlice';
import { syncUserRole } from '../../slices/authSlice';

const SyncUserRole = () => {
  const dispatch = useDispatch();
  const userInfo = useSelector((state) => state.auth.userInfo);

  const { data: profile } = useGetProfileQuery(undefined, {
    skip: !userInfo,
  });

  useEffect(() => {
    if (profile) {
      dispatch(syncUserRole(profile));
    }
  }, [profile, dispatch]);

  return null;
};

export default SyncUserRole;

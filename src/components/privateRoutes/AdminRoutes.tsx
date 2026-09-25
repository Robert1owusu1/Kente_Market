import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAppSelector } from '../../store';

const AdminRoute = () => {
  const {userInfo} = useAppSelector((state) => state.auth);

  // NOTE: this guard is UX-only — it hides admin screens from non-admins to
  // avoid rendering pages the user cannot use. The server is the authority:
  // every /api/admin (and admin-only) endpoint enforces the admin role itself,
  // so bypassing this check in the browser still yields 401/403 responses.
  return userInfo && userInfo.isAdmin ? (
    <Outlet /> 
  ) : (
    <Navigate to="/login" replace />
  );
}


export default AdminRoute

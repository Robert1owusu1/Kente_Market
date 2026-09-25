import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAppSelector } from '../../store';

const VerifiedRoute = () => {
  const {userInfo} = useAppSelector((state) => state.auth);

  if (!userInfo) {
    return <Navigate to="/login" replace />;
  }

  // Strict: only an explicit `true` passes. `undefined`/`null` (e.g. a legacy
  // session payload that never carried the flag) is treated as unverified so
  // verification-gated pages stay closed until the server confirms it.
  if (userInfo.isEmailVerified !== true) {
    return <Navigate to="/verify-email" replace />;
  }

  return <Outlet />;
}

export default VerifiedRoute

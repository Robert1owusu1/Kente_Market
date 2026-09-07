import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAppSelector } from '../../store';

const VerifiedRoute = () => {
  const {userInfo} = useAppSelector((state) => state.auth);

  if (!userInfo) {
    return <Navigate to="/login" replace />;
  }

  if (userInfo.isEmailVerified === false) {
    return <Navigate to="/verify-email" replace />;
  }

  return <Outlet />;
}

export default VerifiedRoute

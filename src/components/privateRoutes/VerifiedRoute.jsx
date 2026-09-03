import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useSelector } from 'react-redux';

const VerifiedRoute = () => {
  const {userInfo} = useSelector((state) => state.auth);

  if (!userInfo) {
    return <Navigate to="/login" replace />;
  }

  if (userInfo.isEmailVerified === false) {
    return <Navigate to="/verify-email" replace />;
  }

  return <Outlet />;
}

export default VerifiedRoute

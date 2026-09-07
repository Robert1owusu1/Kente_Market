import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAppSelector } from '../../store';

const PrivateRoute = () => {
  const {userInfo} = useAppSelector((state) => state.auth);

  return userInfo ? <Outlet /> : <Navigate to="/login" replace />;
}


export default PrivateRoute

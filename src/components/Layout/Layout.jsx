import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../Navbar/Navbar';
import BottomNav from '../Navbar/BottomNav';

const Layout = () => {
  return (
    <>
      <Navbar />
      <BottomNav />
      <Outlet />
    </>
  );
};

export default Layout;

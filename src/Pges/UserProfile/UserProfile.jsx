import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FaUser, FaShoppingBag, FaPalette, FaHeart, FaMapMarkerAlt, FaCreditCard, FaCog, FaQuestionCircle, FaSignInAlt, FaSignOutAlt, FaCamera, FaEdit, FaTrash } from 'react-icons/fa';
import { IoMdSearch } from "react-icons/io";
import { BiLoaderAlt } from "react-icons/bi";
import { useSelector, useDispatch } from 'react-redux';
import { useLogoutMutation, useUpdateProfileMutation } from '../../slices/usersApiSlice';
import { useUploadProfilePictureMutation, useDeleteProfilePictureMutation } from '../../slices/profileApiSlice';
import { logout, setCredentials } from '../../slices/authSlice';
import { toast } from 'react-toastify';
import { useGetMyOrdersQuery } from '../../slices/ordersApiSlice';

const CustomerProfile = () => {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  const { userInfo } = useSelector((state) => state.auth);

  const [logoutApiCall, { isLoading: isLoggingOut }] = useLogoutMutation();
  const [updateProfile, { isLoading: loadingUpdateProfile }] = useUpdateProfileMutation();
  
  const { data: myOrders, isLoading: loadingMyOrders, error: ordersError } = useGetMyOrdersQuery();

  useEffect(() => {
    if (userInfo) {
      setName(userInfo.name || '');
      setEmail(userInfo.email || '');
    }
  }, [userInfo]);

  useEffect(() => {
    if (!userInfo) {
      navigate('/login?redirect=/profile');
    }
  }, [userInfo, navigate]);

  const submitHandler = async (e) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail) {
      toast.error('Name and email are required');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (password && password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (password && password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    try {
      const updateData = { 
        name: trimmedName, 
        email: trimmedEmail,
        ...(password && { password })
      };

      const result = await updateProfile(updateData).unwrap();
      dispatch(setCredentials({ ...userInfo, ...result }));
      toast.success('Profile updated successfully');
      setIsEditing(false);
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      const errorMsg = err?.data?.message || err?.error || 'Failed to update profile';
      toast.error(errorMsg);
      console.error('Profile update failed:', err);
    }
  };

  const logoutHandler = async () => {
    try {
      await logoutApiCall().unwrap();
      dispatch(logout());
      toast.success('Logged out successfully');
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
      dispatch(logout());
      navigate('/');
    }
  };

  if (!userInfo) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-lg text-center max-w-md mx-4">
          <FaSignInAlt className="text-6xl text-primary mx-auto mb-6" />
          <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
            Authentication Required
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            You need to be logged in to access your profile. Please sign in to continue.
          </p>
          <div className="space-y-4">
            <Link 
              to="/login?redirect=/profile"
              className="block w-full bg-primary text-white py-3 px-6 rounded-lg hover:bg-primary/90 transition-colors font-semibold"
            >
              Sign In
            </Link>
            <Link 
              to="/register?redirect=/profile"
              className="block w-full border border-primary text-primary py-3 px-6 rounded-lg hover:bg-primary/10 transition-colors font-semibold"
            >
              Create Account
            </Link>
            <Link 
              to="/"
              className="block text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const customerData = {
    name: `${userInfo.firstName || ''} ${userInfo.lastName || ''}`.trim() || userInfo.name || userInfo.email.split('@')[0],
    email: userInfo.email,
    avatar: userInfo.profilePicture || userInfo.avatar || null,
    memberSince: userInfo.createdAt ? new Date(userInfo.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Recently',
    totalOrders: userInfo.totalOrders || 0,
    totalSpent: userInfo.totalSpent || 0,
    favoriteDesigns: userInfo.favoriteDesigns || 0,
    role: userInfo.role || 'customer',
    isAdmin: userInfo.isAdmin || userInfo.role === 'admin'
  };

  const ProfilePictureUpload = () => {
    const fileInputRef = useRef(null);
    const [isUploading, setIsUploading] = useState(false);
    
    const [uploadProfilePicture] = useUploadProfilePictureMutation();
    const [deleteProfilePicture] = useDeleteProfilePictureMutation();

    const handleFileSelect = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        toast.error('Please upload a valid image file (JPG, PNG, GIF, or WEBP)');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image size must be less than 5MB');
        return;
      }

      setIsUploading(true);

      try {
        const formData = new FormData();
        formData.append('profilePicture', file);

        const result = await uploadProfilePicture(formData).unwrap();
        
        dispatch(setCredentials({
          ...userInfo,
          profilePicture: result.profilePicture
        }));

        toast.success('Profile picture updated successfully!');
      } catch (error) {
        console.error('Upload error:', error);
        toast.error(error?.data?.message || 'Failed to upload profile picture');
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };

    const handleDeletePicture = async () => {
      if (!userInfo.profilePicture) {
        toast.info('No profile picture to delete');
        return;
      }

      if (!window.confirm('Are you sure you want to delete your profile picture?')) {
        return;
      }

      setIsUploading(true);

      try {
        await deleteProfilePicture().unwrap();
        
        dispatch(setCredentials({
          ...userInfo,
          profilePicture: null
        }));

        toast.success('Profile picture deleted successfully');
      } catch (error) {
        console.error('Delete error:', error);
        toast.error(error?.data?.message || 'Failed to delete profile picture');
      } finally {
        setIsUploading(false);
      }
    };

    const profilePictureUrl = customerData.avatar 
      ? (customerData.avatar.startsWith('http') 
          ? customerData.avatar 
          : `${window.location.origin}${customerData.avatar}`)
      : null;

    return (
      <div className="relative group">
        <div className="w-16 h-16 rounded-full border-4 border-white/20 overflow-hidden bg-white/10 flex items-center justify-center relative">
          {isUploading ? (
            <BiLoaderAlt className="text-white text-2xl animate-spin" />
          ) : profilePictureUrl ? (
            <img 
              src={profilePictureUrl} 
              alt="Profile"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
              }}
            />
          ) : (
            <FaUser className="text-white text-2xl" />
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
          onChange={handleFileSelect}
          className="hidden"
          disabled={isUploading}
        />

        <div className="absolute -bottom-1 -right-1 flex gap-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="bg-primary text-white p-1.5 rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            type="button"
            aria-label="Upload profile picture"
            title="Upload profile picture"
          >
            <FaCamera className="text-xs" />
          </button>

          {userInfo.profilePicture && (
            <button
              onClick={handleDeletePicture}
              disabled={isUploading}
              className="bg-red-500 text-white p-1.5 rounded-full hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              type="button"
              aria-label="Delete profile picture"
              title="Delete profile picture"
            >
              <FaTrash className="text-xs" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const menuItems = [
    { id: 'dashboard', name: 'Dashboard', icon: FaUser },
    { id: 'orders', name: 'Order History', icon: FaShoppingBag },
    { id: 'designs', name: 'My Designs', icon: FaPalette },
    { id: 'favorites', name: 'Favorites', icon: FaHeart },
    { id: 'addresses', name: 'Address Book', icon: FaMapMarkerAlt },
    { id: 'payment', name: 'Payment Methods', icon: FaCreditCard },
    { id: 'settings', name: 'Account Settings', icon: FaCog },
    { id: 'help', name: 'Help & Support', icon: FaQuestionCircle }
  ];

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-primary to-secondary rounded-xl p-6 text-white">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold mb-2">Welcome back, {customerData.name}!</h2>
            <p className="opacity-90">Member since {customerData.memberSince}</p>
            {customerData.isAdmin && (
              <div className="mt-2">
                <span className="bg-white/20 text-white px-3 py-1 rounded-full text-sm font-medium">
                  Admin Account
                </span>
              </div>
            )}
          </div>
          <button
            onClick={logoutHandler}
            disabled={isLoggingOut}
            className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            type="button"
          >
            {isLoggingOut ? <BiLoaderAlt className="animate-spin" /> : <FaSignOutAlt />}
            {isLoggingOut ? 'Signing out...' : 'Sign Out'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-400">Total Orders</p>
              <p className="text-2xl font-bold text-primary">{customerData.totalOrders}</p>
            </div>
            <FaShoppingBag className="text-3xl text-primary/70" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-400">Total Spent</p>
              <p className="text-2xl font-bold text-secondary">${customerData.totalSpent.toFixed(2)}</p>
            </div>
            <FaCreditCard className="text-3xl text-secondary/70" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-400">Saved Designs</p>
              <p className="text-2xl font-bold text-green-500">{customerData.favoriteDesigns}</p>
            </div>
            <FaPalette className="text-3xl text-green-500/70" />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Recent Orders</h3>
          {customerData.totalOrders > 0 && (
            <button onClick={() => setActiveSection('orders')} className="text-primary hover:underline" type="button">
              View All
            </button>
          )}
        </div>
        
        <div className="text-center py-8">
          <FaShoppingBag className="text-4xl text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h4 className="text-lg font-semibold text-gray-600 dark:text-gray-400 mb-2">
            {customerData.totalOrders === 0 ? 'No orders yet' : 'No recent orders to display'}
          </h4>
          <p className="text-gray-500 dark:text-gray-500 mb-4">
            {customerData.totalOrders === 0 ? 'Start shopping to see your orders here' : 'Your order history will appear here when available'}
          </p>
          <Link to="/products" className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors">
            <FaShoppingBag />
            {customerData.totalOrders === 0 ? 'Start Shopping' : 'Browse Products'}
          </Link>
        </div>
      </div>
    </div>
  );

  const renderOrders = () => {
    if (loadingMyOrders) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <BiLoaderAlt className="animate-spin text-4xl text-primary mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading your orders...</p>
        </div>
      );
    }

    if (ordersError) {
      return (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">Failed to load orders</h3>
          <p className="text-red-700 dark:text-red-300">
            {ordersError?.data?.message || ordersError?.message || 'An error occurred while fetching your orders'}
          </p>
        </div>
      );
    }

    if (!myOrders || myOrders.length === 0) {
      return (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-12 shadow-md text-center">
          <FaShoppingBag className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-6" />
          <h3 className="text-2xl font-semibold text-gray-600 dark:text-gray-400 mb-4">No orders found</h3>
          <p className="text-gray-500 dark:text-gray-500 mb-6 max-w-md mx-auto">
            You haven't placed any orders yet. Start shopping to see your order history here.
          </p>
          <Link to="/products" className="inline-flex items-center gap-2 bg-primary text-white px-8 py-3 rounded-lg hover:bg-primary/90 transition-colors font-semibold">
            <FaShoppingBag />
            Browse Products
          </Link>
        </div>
      );
    }

    const filteredOrders = searchQuery
      ? myOrders.filter(order => order?._id?.toLowerCase().includes(searchQuery.toLowerCase()))
      : myOrders;

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-2xl font-bold">Order History</h2>
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:border-primary"
            />
            <IoMdSearch className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">No orders match your search</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => (
              <div key={order._id} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Order ID</p>
                    <p className="font-mono font-bold text-gray-900 dark:text-white">{order._id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Date</p>
                    <p className="text-gray-900 dark:text-white">
                      {new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Total</p>
                    <p className="text-xl font-bold text-primary">${order.totalPrice?.toFixed(2) || '0.00'}</p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Status</p>
                  <div className="flex gap-2">
                    {order.isPaid && (
                      <span className="inline-block px-3 py-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 rounded-full text-xs font-medium">
                        ✓ Paid
                      </span>
                    )}
                    {!order.isPaid && (
                      <span className="inline-block px-3 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-full text-xs font-medium">
                        Pending Payment
                      </span>
                    )}
                    {order.isDelivered && (
                      <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded-full text-xs font-medium">
                        ✓ Delivered
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSettings = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Account Settings</h2>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Profile Information</h3>
          <button onClick={() => setIsEditing(!isEditing)} className="text-primary hover:text-primary/80 transition-colors flex items-center gap-2" type="button">
            <FaEdit className="text-sm" />
            {isEditing ? 'Cancel' : 'Edit'}
          </button>
        </div>
        
        {!isEditing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
              <p className="text-gray-900 dark:text-gray-100">{userInfo.name || 'Not provided'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
              <p className="text-gray-900 dark:text-gray-100">{userInfo.email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
              <p className="text-gray-900 dark:text-gray-100">{userInfo.phone || 'Not provided'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Type</label>
              <p className="text-gray-900 dark:text-gray-100 capitalize">{userInfo.role || 'Customer'}</p>
            </div>
          </div>
        ) : (
          <form onSubmit={submitHandler} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Name *</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email *</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep current" className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Confirm Password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary" />
              </div>
            </div>
            
            <div className="flex gap-4 pt-4">
              <button type="submit" disabled={loadingUpdateProfile} className="flex-1 bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {loadingUpdateProfile ? <><BiLoaderAlt className="animate-spin" />Updating...</> : 'Save Changes'}
              </button>
              <button type="button" onClick={() => { setIsEditing(false); setName(userInfo.name || ''); setEmail(userInfo.email || ''); setPassword(''); setConfirmPassword(''); }} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-semibold">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard': return renderDashboard();
      case 'orders': return renderOrders();
      case 'settings': return renderSettings();
      default: return <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center"><p className="text-gray-600 dark:text-gray-400">Section coming soon</p></div>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
      <div className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="container mx-auto px-4 py-3">
          <nav className="text-sm">
            <span className="text-gray-600 dark:text-gray-400">Home</span>
            <span className="mx-2 text-gray-400">/</span>
            <span className="text-primary font-medium">My Account</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          <div className="lg:w-1/4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden sticky top-24">
              <div className="p-6 bg-gradient-to-r from-primary to-secondary text-white">
                <div className="flex items-center gap-4">
                  <ProfilePictureUpload />
                  <div>
                    <h3 className="font-bold text-lg">{customerData.name}</h3>
                    <p className="text-white/80 text-sm">{customerData.email}</p>
                  </div>
                </div>
              </div>

              <nav className="p-2">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
                        activeSection === item.id
                          ? 'bg-primary text-white'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      type="button"
                    >
                      <Icon className="text-lg" />
                      <span>{item.name}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          <div className="lg:w-3/4">
            {renderContent()}
          </div>
        </div>
      </div>

      <div className="h-20 sm:hidden"></div>
    </div>
  );
};

export default CustomerProfile;
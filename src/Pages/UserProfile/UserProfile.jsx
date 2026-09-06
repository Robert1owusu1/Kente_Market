import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FaUser, FaShoppingBag, FaPalette, FaHeart, FaMapMarkerAlt, FaCreditCard, FaCog, FaQuestionCircle, FaSignInAlt, FaSignOutAlt, FaCamera, FaEdit, FaTrash, FaUndo, FaStore, FaCheckCircle, FaPlus, FaHome, FaBriefcase, FaChevronDown, FaChevronUp, FaPaperPlane, FaTag, FaReply } from 'react-icons/fa';
import { IoMdSearch } from "react-icons/io";
import { BiLoaderAlt } from "react-icons/bi";
import { useSelector, useDispatch } from 'react-redux';
import { useLogoutMutation, useUpdateProfileMutation } from '../../slices/usersApiSlice';
import { useUploadProfilePictureMutation, useDeleteProfilePictureMutation } from '../../slices/profileApiSlice';
import { logout, setCredentials } from '../../slices/authSlice.js';
import { toast } from 'react-toastify';
import { useGetMyOrdersQuery } from '../../slices/ordersApiSlice';
import { useGetMyReturnsQuery } from '../../slices/returnsApiSlice';
import { useGetMyDesignsQuery, useCreateDesignMutation, useUpdateDesignMutation, useDeleteDesignMutation } from '../../slices/designsApiSlice';
import { useGetMyAddressesQuery, useCreateAddressMutation, useUpdateAddressMutation, useDeleteAddressMutation } from '../../slices/addressesApiSlice';
import { useGetMyPaymentMethodsQuery, useAddPaymentMethodMutation, useSetDefaultPaymentMethodMutation, useDeletePaymentMethodMutation } from '../../slices/paymentMethodsApiSlice';
import { useGetMyTicketsQuery, useCreateTicketMutation } from '../../slices/supportApiSlice';

const CustomerProfile = () => {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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
      setFirstName(userInfo.firstName || userInfo.name || '');
      setLastName(userInfo.lastName || '');
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

    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedFirstName || !trimmedLastName || !trimmedEmail) {
      toast.error('First name, last name and email are required');
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
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
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
    memberSince: userInfo.createdAt || userInfo.created_at
      ? new Date(userInfo.createdAt || userInfo.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'Recently',
    totalOrders: Array.isArray(myOrders) ? myOrders.length : (userInfo.totalOrders || 0),
    totalSpent: Array.isArray(myOrders)
      ? myOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0)
      : (userInfo.totalSpent || 0),
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
    { id: 'returns', name: 'My Returns', icon: FaUndo },
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
              <p className="text-2xl font-bold text-secondary">GH₵ {customerData.totalSpent.toFixed(2)}</p>
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
      ? myOrders.filter(order => order?.orderNumber?.toLowerCase().includes(searchQuery.toLowerCase()))
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
              <Link
                key={order.id || order.orderNumber}
                to={`/order/${order.id}`}
                className="block bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Order Number</p>
                    <p className="font-mono font-bold text-gray-900 dark:text-white">{order.orderNumber || `#${order.id}`}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Date</p>
                    <p className="text-gray-900 dark:text-white">
                      {order.created_at
                        ? new Date(order.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Total</p>
                    <p className="text-xl font-bold text-primary">GH₵ {(Number(order.totalAmount) || 0).toFixed(2)}</p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Status</p>
                  <div className="flex gap-2">
                    {order.paymentStatus === 'paid' && (
                      <span className="inline-block px-3 py-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 rounded-full text-xs font-medium">
                        ✓ Paid
                      </span>
                    )}
                    {order.paymentStatus !== 'paid' && (
                      <span className="inline-block px-3 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-full text-xs font-medium">
                        Pending Payment
                      </span>
                    )}
                    {order.orderStatus === 'delivered' && (
                      <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded-full text-xs font-medium">
                        ✓ Delivered
                      </span>
                    )}
                    {order.orderStatus === 'processing' && (
                      <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded-full text-xs font-medium">
                        Processing
                      </span>
                    )}
                    {order.orderStatus === 'cancelled' && (
                      <span className="inline-block px-3 py-1 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 rounded-full text-xs font-medium">
                        Cancelled
                      </span>
                    )}
                  </div>
                </div>
              </Link>
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
              <p className="text-gray-900 dark:text-gray-100">
                {`${userInfo.firstName || ''} ${userInfo.lastName || ''}`.trim() || userInfo.name || 'Not provided'}
              </p>
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
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-gray-900 dark:text-gray-100 capitalize">{userInfo.role || 'Customer'}</p>
                {userInfo.role === 'vendor' && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/40 px-2 py-0.5 rounded-full">
                    <FaCheckCircle /> Vendor
                  </span>
                )}
                {userInfo.role === 'vendor' && (
                  <Link
                    to="/vendor"
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <FaStore /> Seller Dashboard
                  </Link>
                )}
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={submitHandler} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name *</label>
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name *</label>
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-primary" required />
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
              <button type="button" onClick={() => { setIsEditing(false); setFirstName(userInfo.firstName || ''); setLastName(userInfo.lastName || ''); setEmail(userInfo.email || ''); setPassword(''); setConfirmPassword(''); }} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-semibold">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  const MyReturnsSection = () => {
    const { data: myReturns = [], isLoading } = useGetMyReturnsQuery();
    if (isLoading) return <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center"><BiLoaderAlt className="animate-spin text-2xl mx-auto text-primary" /></div>;
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">My Returns</h2>
        {myReturns.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center">
            <FaUndo className="text-4xl text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">No return requests yet.</p>
          </div>
        ) : (
          myReturns.map((ret) => (
            <div key={ret.id} className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Order #{ret.orderNumber || ret.orderId}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Reason: {ret.reason?.replace(/_/g, ' ')}</p>
                  {ret.description && <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{ret.description}</p>}
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  ret.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                  ret.status === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                  ret.status === 'rejected' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                }`}>{ret.status}</span>
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  const MyDesignsSection = () => {
    const { data: designs = [], isLoading } = useGetMyDesignsQuery();
    const [createDesign] = useCreateDesignMutation();
    const [updateDesign] = useUpdateDesignMutation();
    const [deleteDesign] = useDeleteDesignMutation();
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ name: '', description: '', image: '', config: '' });

    const resetForm = () => {
      setForm({ name: '', description: '', image: '', config: '' });
      setEditingId(null);
      setShowForm(false);
    };

    const startEdit = (d) => {
      setForm({
        name: d.name || '',
        description: d.description || '',
        image: d.image || '',
        config: d.config ? JSON.stringify(d.config) : '',
      });
      setEditingId(d.id);
      setShowForm(true);
      window.scrollTo({ top: document.getElementById('design-form')?.offsetTop - 120 || 0, behavior: 'smooth' });
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (!form.name.trim()) {
        toast.error('Design name is required');
        return;
      }
      let config = null;
      if (form.config.trim()) {
        try { config = JSON.parse(form.config); }
        catch { toast.error('Configuration must be valid JSON'); return; }
      }
      const payload = { name: form.name.trim(), description: form.description, image: form.image, config };
      try {
        if (editingId) {
          await updateDesign({ id: editingId, ...payload }).unwrap();
          toast.success('Design updated');
        } else {
          await createDesign(payload).unwrap();
          toast.success('Design saved');
        }
        resetForm();
      } catch (err) {
        toast.error(err?.data?.message || err?.message || 'Failed to save design');
      }
    };

    const handleDelete = async (d) => {
      if (!window.confirm(`Delete design "${d.name}"?`)) return;
      try {
        await deleteDesign(d.id).unwrap();
        toast.success('Design deleted');
      } catch (err) {
        toast.error(err?.data?.message || err?.message || 'Failed to delete design');
      }
    };

    if (isLoading) {
      return <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center"><BiLoaderAlt className="animate-spin text-2xl mx-auto text-primary" /></div>;
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">My Designs</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Save and manage your custom Kente design configurations.</p>
          </div>
          <button
            type="button"
            onClick={() => { if (editingId) resetForm(); else setShowForm(!showForm); }}
            className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm font-semibold"
          >
            <FaPlus /> {showForm && !editingId ? 'Close' : 'New Design'}
          </button>
        </div>

        {(showForm || editingId) && (
          <form id="design-form" onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md space-y-4">
            <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{editingId ? 'Edit Design' : 'New Design'}</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Design name *</label>
              <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. My wedding kente" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe your design" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Image URL</label>
              <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="https://..." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Configuration (JSON)</label>
              <textarea className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs" rows="3" value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} placeholder='{"pattern":"adweneasa","colors":["gold","green"]}' />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="flex-1 bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors font-semibold flex items-center justify-center gap-2">
                <FaCheckCircle /> {editingId ? 'Update Design' : 'Save Design'}
              </button>
              <button type="button" onClick={resetForm} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-semibold">Cancel</button>
            </div>
          </form>
        )}

        {designs.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-12 shadow-md text-center">
            <FaPalette className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-6" />
            <h3 className="text-xl font-semibold text-gray-600 dark:text-gray-400 mb-2">No saved designs yet</h3>
            <p className="text-gray-500 dark:text-gray-500 mb-4">Create a custom Kente design and save it here for future orders.</p>
            <button type="button" onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors font-semibold">
              <FaPlus /> Create a design
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {designs.map((d) => (
              <div key={d.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-100 dark:border-gray-700">
                {d.image ? (
                  <div className="h-40 bg-gray-100 dark:bg-gray-700">
                    <img src={d.image} alt={d.name} className="w-full h-full object-cover" onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} />
                  </div>
                ) : (
                  <div className="h-40 bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                    <FaPalette className="text-4xl text-primary/50" />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="font-semibold text-gray-900 dark:text-white truncate">{d.name}</h4>
                      {d.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{d.description}</p>}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" onClick={() => startEdit(d)} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><FaEdit /> Edit</button>
                    <button type="button" onClick={() => handleDelete(d)} className="inline-flex items-center gap-1 text-sm text-red-500 hover:underline"><FaTrash /> Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const MyAddressesSection = () => {
    const { data: addresses = [], isLoading } = useGetMyAddressesQuery();
    const [createAddress] = useCreateAddressMutation();
    const [updateAddress] = useUpdateAddressMutation();
    const [deleteAddress] = useDeleteAddressMutation();
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ label: 'Home', fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', zipCode: '', country: 'Ghana', isDefault: false });

    const resetForm = () => {
      setForm({ label: 'Home', fullName: '', phone: '', addressLine1: '', addressLine2: '', city: '', state: '', zipCode: '', country: 'Ghana', isDefault: false });
      setEditingId(null);
      setShowForm(false);
    };

    const startEdit = (a) => {
      setForm({
        label: a.label || 'Home',
        fullName: a.fullName || '',
        phone: a.phone || '',
        addressLine1: a.addressLine1 || '',
        addressLine2: a.addressLine2 || '',
        city: a.city || '',
        state: a.state || '',
        zipCode: a.zipCode || '',
        country: a.country || 'Ghana',
        isDefault: !!a.isDefault,
      });
      setEditingId(a.id);
      setShowForm(true);
      window.scrollTo({ top: document.getElementById('address-form')?.offsetTop - 120 || 0, behavior: 'smooth' });
    };

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (!form.fullName || !form.phone || !form.addressLine1 || !form.city) {
        toast.error('Full name, phone, address and city are required');
        return;
      }
      const payload = { ...form, fullName: form.fullName.trim(), addressLine1: form.addressLine1.trim(), city: form.city.trim() };
      try {
        if (editingId) {
          await updateAddress({ id: editingId, ...payload }).unwrap();
          toast.success('Address updated');
        } else {
          await createAddress(payload).unwrap();
          toast.success('Address added');
        }
        resetForm();
      } catch (err) {
        toast.error(err?.data?.message || err?.message || 'Failed to save address');
      }
    };

    const handleDelete = async (a) => {
      if (!window.confirm('Delete this address?')) return;
      try {
        await deleteAddress(a.id).unwrap();
        toast.success('Address deleted');
      } catch (err) {
        toast.error(err?.data?.message || err?.message || 'Failed to delete address');
      }
    };

    if (isLoading) {
      return <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center"><BiLoaderAlt className="animate-spin text-2xl mx-auto text-primary" /></div>;
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Address Book</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage the shipping addresses used at checkout.</p>
          </div>
          <button
            type="button"
            onClick={() => { if (editingId) resetForm(); else setShowForm(!showForm); }}
            className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm font-semibold"
          >
            <FaPlus /> {showForm && !editingId ? 'Close' : 'New Address'}
          </button>
        </div>

        {(showForm || editingId) && (
          <form id="address-form" onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md space-y-4">
            <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{editingId ? 'Edit Address' : 'New Address'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label</label>
                <select className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}>
                  <option value="Home">Home</option>
                  <option value="Work">Work</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Country</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full name *</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone *</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+233 ..." />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address line 1 *</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address line 2</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">City *</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State / Region</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Postal code</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 sm:pt-6">
                <input type="checkbox" id="addr-default" className="w-4 h-4 text-primary" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                <label htmlFor="addr-default" className="text-sm text-gray-700 dark:text-gray-300">Set as default</label>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" className="flex-1 bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors font-semibold flex items-center justify-center gap-2">
                <FaCheckCircle /> {editingId ? 'Update Address' : 'Save Address'}
              </button>
              <button type="button" onClick={resetForm} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-semibold">Cancel</button>
            </div>
          </form>
        )}

        {addresses.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-12 shadow-md text-center">
            <FaMapMarkerAlt className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-6" />
            <h3 className="text-xl font-semibold text-gray-600 dark:text-gray-400 mb-2">No saved addresses</h3>
            <p className="text-gray-500 dark:text-gray-500 mb-4">Add an address to speed up checkout.</p>
            <button type="button" onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors font-semibold">
              <FaPlus /> Add an address
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {addresses.map((a) => (
              <div key={a.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 border border-gray-100 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    {a.label === 'Work' ? <FaBriefcase className="text-primary" /> : <FaHome className="text-primary" />}
                    <span className="font-semibold text-gray-900 dark:text-white">{a.label || 'Address'}</span>
                    {a.isDefault && <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">Default</span>}
                  </div>
                </div>
                <p className="text-gray-700 dark:text-gray-300 text-sm">{a.fullName}</p>
                <p className="text-gray-600 dark:text-gray-400 text-sm">{a.addressLine1}{a.addressLine2 ? `, ${a.addressLine2}` : ''}</p>
                <p className="text-gray-600 dark:text-gray-400 text-sm">{a.city}{a.state ? `, ${a.state}` : ''} {a.zipCode}</p>
                <p className="text-gray-600 dark:text-gray-400 text-sm">{a.country}</p>
                <p className="text-gray-600 dark:text-gray-400 text-sm">{a.phone}</p>
                <div className="mt-3 flex items-center gap-3">
                  <button type="button" onClick={() => startEdit(a)} className="text-sm text-primary hover:underline inline-flex items-center gap-1"><FaEdit /> Edit</button>
                  <button type="button" onClick={() => handleDelete(a)} className="text-sm text-red-500 hover:underline inline-flex items-center gap-1"><FaTrash /> Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const MyPaymentMethodsSection = () => {
    const { data: methods = [], isLoading } = useGetMyPaymentMethodsQuery();
    const [addPaymentMethod] = useAddPaymentMethodMutation();
    const [setDefaultPaymentMethod] = useSetDefaultPaymentMethodMutation();
    const [deletePaymentMethod] = useDeletePaymentMethodMutation();
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ type: 'card', cardBrand: '', last4: '', expMonth: '', expYear: '', authorizedCode: '' });

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (!form.last4 || String(form.last4).length < 4) {
        toast.error('Last 4 digits are required');
        return;
      }
      try {
        await addPaymentMethod({ ...form, last4: String(form.last4).slice(-4) }).unwrap();
        toast.success('Payment method added');
        setForm({ type: 'card', cardBrand: '', last4: '', expMonth: '', expYear: '', authorizedCode: '' });
        setShowForm(false);
      } catch (err) {
        toast.error(err?.data?.message || err?.message || 'Failed to add payment method');
      }
    };

    const handleSetDefault = async (id) => {
      try {
        await setDefaultPaymentMethod(id).unwrap();
        toast.success('Default payment method updated');
      } catch (err) {
        toast.error(err?.data?.message || err?.message || 'Failed to update default');
      }
    };

    const handleDelete = async (m) => {
      if (!window.confirm('Remove this payment method?')) return;
      try {
        await deletePaymentMethod(m.id).unwrap();
        toast.success('Payment method removed');
      } catch (err) {
        toast.error(err?.data?.message || err?.message || 'Failed to remove payment method');
      }
    };

    if (isLoading) {
      return <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center"><BiLoaderAlt className="animate-spin text-2xl mx-auto text-primary" /></div>;
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Payment Methods</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your saved payment methods for faster checkout.</p>
          </div>
          <button type="button" onClick={() => setShowForm(!showForm)} className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm font-semibold">
            <FaPlus /> {showForm ? 'Close' : 'Add Method'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md space-y-4">
            <h3 className="font-semibold text-lg text-gray-900 dark:text-white">Add a payment method</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
              <select className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="card">Card</option>
                <option value="mobile_money">Mobile Money</option>
              </select>
            </div>
            {form.type === 'card' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Card brand</label>
                    <select className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.cardBrand} onChange={(e) => setForm({ ...form, cardBrand: e.target.value })}>
                      <option value="">Select brand</option>
                      <option value="Visa">Visa</option>
                      <option value="Mastercard">Mastercard</option>
                      <option value="Verve">Verve</option>
                      <option value="Amex">Amex</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last 4 digits *</label>
                    <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" maxLength="4" inputMode="numeric" value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '') })} placeholder="4321" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expiry month (MM)</label>
                    <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" maxLength="2" inputMode="numeric" value={form.expMonth} onChange={(e) => setForm({ ...form, expMonth: e.target.value.replace(/\D/g, '') })} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expiry year (YYYY)</label>
                    <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" maxLength="4" inputMode="numeric" value={form.expYear} onChange={(e) => setForm({ ...form, expYear: e.target.value.replace(/\D/g, '') })} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Paystack authorization code *</label>
                  <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={form.authorizedCode} onChange={(e) => setForm({ ...form, authorizedCode: e.target.value })} placeholder="AUTH_xxxxxxxx" />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This is stored securely to charge the card without re-entering details.</p>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mobile money last 4 digits *</label>
                <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" maxLength="4" inputMode="numeric" value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, '') })} placeholder="e.g. 4321" />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="submit" className="flex-1 bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors font-semibold flex items-center justify-center gap-2">
                <FaCheckCircle /> Save Method
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-semibold">Cancel</button>
            </div>
          </form>
        )}

        {methods.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-12 shadow-md text-center">
            <FaCreditCard className="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-6" />
            <h3 className="text-xl font-semibold text-gray-600 dark:text-gray-400 mb-2">No saved payment methods</h3>
            <p className="text-gray-500 dark:text-gray-500 mb-4">Save a card or mobile money account for faster checkout.</p>
            <button type="button" onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors font-semibold">
              <FaPlus /> Add a method
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {methods.map((m) => (
              <div key={m.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 border border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FaCreditCard className="text-2xl text-primary" />
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {m.type === 'card' ? (m.cardBrand || 'Card') : 'Mobile Money'} •••• {m.last4 || '••••'}
                      {m.isDefault && <span className="ml-2 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">Default</span>}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {m.type === 'card' && m.expMonth ? `Expires ${m.expMonth}/${m.expYear}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!m.isDefault && (
                    <button type="button" onClick={() => handleSetDefault(m.id)} className="text-sm text-primary hover:underline">Set default</button>
                  )}
                  <button type="button" onClick={() => handleDelete(m)} className="text-sm text-red-500 hover:underline inline-flex items-center gap-1"><FaTrash /> Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const MyHelpSection = () => {
    const { data: tickets = [], isLoading } = useGetMyTicketsQuery();
    const [createTicket] = useCreateTicketMutation();
    const [subject, setSubject] = useState('');
    const [category, setCategory] = useState('general');
    const [message, setMessage] = useState('');
    const [openId, setOpenId] = useState(null);

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (!subject.trim() || !message.trim()) {
        toast.error('Subject and message are required');
        return;
      }
      try {
        await createTicket({ subject: subject.trim(), category, message: message.trim() }).unwrap();
        toast.success('Support ticket submitted');
        setSubject('');
        setMessage('');
        setCategory('general');
      } catch (err) {
        toast.error(err?.data?.message || err?.message || 'Failed to submit ticket');
      }
    };

    const faqs = [
      { q: 'How do I track my order?', a: 'Go to Order History in your profile dashboard to see the live status of all your orders, including payment and delivery status.' },
      { q: 'How do I return a product?', a: 'Open My Returns in your profile and submit a return request. We will review it and keep you updated on its status.' },
      { q: 'What is the escrow payout system for sellers?', a: 'Vendor payouts are held in escrow and released by bank transfer or mobile money after customers confirm delivery of their orders.' },
      { q: 'How do I save a custom Kente design?', a: 'Use My Designs in your profile to save your custom design configuration. It will be available when placing future orders.' },
      { q: 'Can I change my saved address?', a: 'Yes. Open the Address Book in your profile to add, edit, delete or set a default shipping address.' },
    ];

    if (isLoading) {
      return <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center"><BiLoaderAlt className="animate-spin text-2xl mx-auto text-primary" /></div>;
    }

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Help & Support</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Browse FAQs or submit a support ticket and we'll get back to you.</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-4 flex items-center gap-2"><FaQuestionCircle className="text-primary" /> Frequently Asked Questions</h3>
          <div className="space-y-2">
            {faqs.map((f, i) => (
              <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                <button type="button" onClick={() => setOpenId(openId === i ? null : i)} className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg">
                  {f.q}
                  {openId === i ? <FaChevronUp className="text-gray-400" /> : <FaChevronDown className="text-gray-400" />}
                </button>
                {openId === i && <p className="px-4 pb-3 text-sm text-gray-600 dark:text-gray-400">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-4">
          <h3 className="font-semibold text-lg text-gray-900 dark:text-white flex items-center gap-2"><FaPaperPlane className="text-primary" /> Submit a Support Ticket</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
              <select className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="general">General</option>
                <option value="order">Order Issue</option>
                <option value="payment">Payment</option>
                <option value="shipping">Shipping</option>
                <option value="return">Return / Refund</option>
                <option value="vendor">Selling</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject *</label>
              <input className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary of your issue" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message *</label>
            <textarea className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" rows="4" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the issue in detail" />
          </div>
          <button type="submit" className="inline-flex items-center gap-2 bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors font-semibold">
            <FaPaperPlane /> Submit Ticket
          </button>
        </form>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-4">My Tickets</h3>
          {tickets.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">You have no support tickets yet.</p>
          ) : (
            <div className="space-y-3">
              {tickets.map((t) => (
                <div key={t.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white text-sm">{t.subject}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 capitalize">{t.category} · {new Date(t.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${
                      t.status === 'open' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                      t.status === 'answered' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                      'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                    }`}>{t.status}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{t.message}</p>
                  {t.reply && (
                    <div className="mt-3 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-lg p-3 flex gap-2">
                      <FaReply className="text-green-500 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">Support reply</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">{t.reply}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard': return renderDashboard();
      case 'orders': return renderOrders();
      case 'returns': return <MyReturnsSection />;
      case 'designs': return <MyDesignsSection />;
      case 'addresses': return <MyAddressesSection />;
      case 'payment': return <MyPaymentMethodsSection />;
      case 'help': return <MyHelpSection />;
      case 'settings': return renderSettings();
      case 'favorites': navigate('/wishlist'); return null;
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
          {/* Mobile profile card + menu toggle */}
          <div className="lg:hidden">
            <div className="bg-gradient-to-r from-primary to-secondary text-white rounded-lg shadow-md p-6 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <ProfilePictureUpload />
                <div className="min-w-0">
                  <h3 className="font-bold text-lg truncate">{customerData.name}</h3>
                  <p className="text-white/80 text-sm truncate">{customerData.email}</p>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="bg-white/20 hover:bg-white/30 rounded-lg p-2 text-2xl leading-none"
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? '−' : '+'}
              </button>
            </div>
            {mobileMenuOpen && (
              <nav className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-2 mb-4">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { setActiveSection(item.id); setMobileMenuOpen(false); }}
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
            )}
          </div>

          {/* Desktop sidebar */}
          <div className="hidden lg:block lg:w-1/4">
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
// FILE: frontend/src/components/Navbar/Navbar.jsx
// DESCRIPTION: Secure, production-ready Navbar with real backend search

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { IoMdSearch } from "react-icons/io";
import { FaCaretDown, FaUser, FaShoppingBag, FaPalette, FaHeart, FaCog, FaSignOutAlt, FaTimes } from 'react-icons/fa';
import { FaCartShopping } from "react-icons/fa6";
import { HiMenuAlt3 } from 'react-icons/hi';
import axios from 'axios';
import { useCart } from "../../Context/CartContext";
import CartDrawer from "../../components/CartDrawer/CartDrawer";
import { useLogoutMutation } from '../../slices/usersApiSlice';
import { logout } from '../../slices/authSlice.JS';
import { toast } from 'react-toastify';

// ⚙️ Configuration
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// 📋 Menu Configuration
const Menu = [
  { id: 1, name: "Home", link: "/" },
  { id: 2, name: "All Products", link: "/products" },
  { id: 3, name: "Contact Us", link: "/contactus" },
  { id: 4, name: "About Us", link: "/aboutus" },
];

const DropdownLinks = [
  { id: 1, name: "Top Products", link: "/" },
  { id: 2, name: "Trending Products", link: "/trendingproducts" },
];

const ProfileMenuItems = [
  { id: 1, name: "My Profile", link: "/profile", icon: FaUser },
  { id: 2, name: "Order History", link: "/profile?section=orders", icon: FaShoppingBag },
  { id: 3, name: "My Designs", link: "/profile?section=designs", icon: FaPalette },
  { id: 4, name: "Favorites", link: "/profile?section=favorites", icon: FaHeart },
  { id: 5, name: "Settings", link: "/profile?section=settings", icon: FaCog },
  { id: 6, name: "Sign Out", link: "/logout", icon: FaSignOutAlt, divider: true },
];

// 🎨 Dark Mode Component
const DarkMode = () => {
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  const element = document.documentElement;

  useEffect(() => {
    if (theme === "dark") {
      element.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      element.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [element.classList, theme]);

  return (
    <div className="relative">
      <button
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        className="w-12 h-6 rounded-full p-1 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-gray-800"
        style={{ backgroundColor: theme === "dark" ? "#374151" : "#e5e7eb" }}
        aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      >
        <div
          className="w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center text-xs"
          style={{
            backgroundColor: theme === "dark" ? "#fbbf24" : "#ffffff",
            transform: theme === "dark" ? "translateX(24px)" : "translateX(0px)"
          }}
        >
          {theme === "dark" ? "🌙" : "☀️"}
        </div>
      </button>
    </div>
  );
};

// 🧭 Main Navbar Component
const Navbar = () => {
  const searchRef = useRef(null);
  const navigate = useNavigate();
  const { cartItems } = useCart();
  const { userInfo } = useSelector((state) => state.auth);
  const dispatch = useDispatch();
  const [logoutApiCall] = useLogoutMutation();

  // 📊 State Management
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navVisible, setNavVisible] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  // 🎭 Effects
  useEffect(() => {
    setTimeout(() => setNavVisible(true), 100);
  }, []);

  // 🔍 Real-time search from backend (with debouncing)
  useEffect(() => {
    const searchProducts = async () => {
      const trimmedQuery = searchQuery.trim();
      
      if (trimmedQuery.length === 0) {
        setSearchResults([]);
        setShowSearchResults(false);
        return;
      }

      // Security: Sanitize search query
      const sanitizedQuery = trimmedQuery.replace(/[<>]/g, '');
      
      setIsSearching(true);
      
      try {
        const response = await axios.get(`${API_URL}/api/products`, {
          params: { 
            search: sanitizedQuery,
            limit: 10
          },
          timeout: 5000 // 5 second timeout
        });
        
        console.log('✅ Search results:', response.data);
        setSearchResults(Array.isArray(response.data) ? response.data : []);
        setShowSearchResults(true);
      } catch (error) {
        console.error('❌ Search error:', error);
        if (error.code === 'ECONNABORTED') {
          toast.error('Search timeout. Please try again.');
        }
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    // Debounce: Wait 300ms after user stops typing
    const timeoutId = setTimeout(searchProducts, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // 🔒 Click outside to close search results
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false);
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 🎯 Event Handlers
  const handleSearchChange = (e) => {
    const value = e.target.value;
    // Security: Limit search query length
    if (value.length <= 100) {
      setSearchQuery(value);
    }
  };

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    const trimmedQuery = searchQuery.trim();
    
    if (trimmedQuery) {
      // Security: Encode URI component
      navigate(`/products?search=${encodeURIComponent(trimmedQuery)}`);
      setShowSearchResults(false);
      setSearchQuery('');
      if (searchRef.current) searchRef.current.blur();
      setMobileMenuOpen(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearchSubmit(e);
    } else if (e.key === 'Escape') {
      clearSearch();
    }
  };

  const handleResultClick = (product) => {
    if (!product || !product.id) return;
    navigate(`/product/${product.id}`);
    setShowSearchResults(false);
    setSearchQuery('');
    setMobileMenuOpen(false);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setShowSearchResults(false);
    setIsSearchFocused(false);
  };

  const handleLogout = async () => {
    try {
      await logoutApiCall().unwrap();
      dispatch(logout());
      toast.success("Logged out successfully!");
      navigate("/");
      setMobileMenuOpen(false);
    } catch (err) {
      toast.error("Logout failed");
      console.error("Logout error:", err);
    }
  };

  // 🖼️ Helper Functions
  const getProfilePictureUrl = () => {
    if (!userInfo?.profilePicture) return null;
    
    if (userInfo.profilePicture.startsWith('http')) {
      return userInfo.profilePicture;
    }
    return `${window.location.origin}${userInfo.profilePicture}`;
  };

  const getUserDisplayName = () => {
    if (!userInfo) return "User";
    return userInfo.firstName || userInfo.name?.split(" ")[0] || "User";
  };

  const getUserFullName = () => {
    if (!userInfo) return "User";
    
    if (userInfo.firstName && userInfo.lastName) {
      return `${userInfo.firstName} ${userInfo.lastName}`;
    }
    
    return userInfo.name || userInfo.email?.split('@')[0] || "User";
  };

  const profilePictureUrl = getProfilePictureUrl();

  return (
    <>
      <nav className={`shadow-md bg-white dark:bg-gray-900 dark:text-white duration-200 sticky top-0 z-50 backdrop-blur-md ${navVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-0'} transition-all ease-in-out`}>
        
        {/* 🎨 Top Bar */}
        <div className='bg-primary/40 py-2'>
          <div className='container flex justify-between items-center'>
            
            {/* Logo */}
            <div>
              <a href="/" className='font-bold text-2xl sm:text-3xl flex gap-2 items-center'>
                <div className="w-10 h-10 bg-primary rounded"></div>
                <span>Branding House</span>
              </a>
            </div>
            
            {/* Right Side Actions */}
            <div className='flex justify-between items-center gap-4'>
              
              {/* 🔍 Desktop Search */}
              <div className='relative group hidden sm:block' ref={searchRef}>
                <div className="relative">
                  <input 
                    id='search' 
                    name='search' 
                    type="text" 
                    placeholder='Search products...'
                    value={searchQuery}
                    onChange={handleSearchChange}
                    onKeyDown={handleKeyPress}
                    onFocus={() => {
                      setIsSearchFocused(true);
                      if (searchQuery.trim()) setShowSearchResults(true);
                    }}
                    maxLength={100}
                    className={`w-[200px] sm:w-[200px] transition-all duration-300 rounded-full border border-gray-300 dark:bg-gray-800 px-4 py-2 pr-20 focus:outline-none focus:border-2 focus:border-primary ${isSearchFocused || searchQuery ? 'sm:w-[300px]' : ''}`}
                  />
                  
                  {searchQuery && (
                    <button 
                      type="button" 
                      onClick={clearSearch} 
                      className="absolute top-1/2 -translate-y-1/2 right-10 text-gray-400 hover:text-gray-600 p-1"
                      aria-label="Clear search"
                    >
                      <FaTimes className="text-sm" />
                    </button>
                  )}
                  
                  <button 
                    type="button" 
                    onClick={handleSearchSubmit} 
                    className="absolute top-1/2 -translate-y-1/2 right-3 text-gray-500 hover:text-primary p-1"
                    aria-label="Search"
                  >
                    <IoMdSearch className="text-lg" />
                  </button>
                </div>

                {/* 🎯 Search Results Dropdown */}
                {showSearchResults && (
                  <div className="absolute top-full mt-2 left-0 right-0 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 max-h-96 overflow-y-auto z-50">
                    {isSearching ? (
                      <div className="px-4 py-6 text-center">
                        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto"></div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Searching...</p>
                      </div>
                    ) : searchResults.length > 0 ? (
                      <>
                        <div className="px-4 py-3 border-b dark:border-gray-700">
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{searchQuery}"
                          </p>
                        </div>
                        <div className="py-2">
                          {searchResults.slice(0, 6).map((product) => (
                            <button
                              key={product.id}
                              onClick={() => handleResultClick(product)}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                            >
                              <img 
                                src={product.img || '/placeholder.jpg'} 
                                alt={product.title} 
                                className="w-12 h-12 rounded-lg object-cover"
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"%3E%3Cpath d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/%3E%3C/svg%3E';
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm text-gray-900 dark:text-white truncate">
                                  {product.title}
                                </h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                  {product.category || 'Uncategorized'}
                                </p>
                              </div>
                              <span className="text-primary font-semibold text-sm whitespace-nowrap">
                                ${Number(product.price).toFixed(2)}
                              </span>
                            </button>
                          ))}
                          {searchResults.length > 6 && (
                            <div className="px-4 py-2 border-t dark:border-gray-700">
                              <button 
                                onClick={handleSearchSubmit} 
                                className="w-full text-center text-primary hover:text-primary/80 text-sm font-medium py-1"
                              >
                                View all {searchResults.length} results
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    ) : searchQuery.trim() ? (
                      <div className="px-4 py-6 text-center">
                        <p className="text-gray-500 dark:text-gray-400">
                          No products found for "{searchQuery}"
                        </p>
                        <button 
                          onClick={handleSearchSubmit} 
                          className="mt-2 text-primary hover:text-primary/80 text-sm"
                        >
                          Search anyway
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* 🛒 Cart Button */}
              <button
                onClick={() => setIsCartOpen(true)}
                className='bg-gradient-to-r from-primary to-secondary transition-all duration-200 text-white py-1 px-4 rounded-full flex items-center gap-3 group'
                aria-label={`Cart with ${cartCount} items`}
              >
                <span className='group-hover:block hidden transition-all duration-200'>Order</span>
                <div className="relative">
                  <FaCartShopping className='text-xl text-white drop-shadow-sm cursor-pointer' />
                  {cartCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full font-semibold">
                      {cartCount > 99 ? '99+' : cartCount}
                    </span>
                  )}
                </div>
              </button>

              {/* 👤 Desktop Profile Menu */}
              {userInfo && (
                <div className="group relative cursor-pointer hidden sm:block">
                  <div className="flex items-center gap-2 py-2 px-3 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-200">
                    <img
                      src={profilePictureUrl || "/default-avatar.png"}
                      alt="Profile"
                      className="w-8 h-8 rounded-full border-2 border-white/30 object-cover"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
                      }}
                    />
                    <span className="hidden lg:block text-sm font-medium">{getUserDisplayName()}</span>
                    <FaCaretDown className="transition-all duration-200 group-hover:rotate-180" />
                  </div>
            
                  <div className="absolute z-[9999] hidden group-hover:block w-[220px] right-0 rounded-lg bg-white dark:bg-gray-800 shadow-xl border dark:border-gray-700 mt-2">
                    <div className="px-4 py-3 border-b dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {getUserFullName()}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {userInfo.email}
                      </p>
                    </div>
            
                    <ul className="py-2">
                      {ProfileMenuItems.map((item) => {
                        const Icon = item.icon;
                        if (item.name === "Sign Out") {
                          return (
                            <li key={item.id}>
                              <hr className="my-2 border-gray-200 dark:border-gray-700" />
                              <button
                                onClick={handleLogout}
                                className="flex items-center gap-3 w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                              >
                                <Icon className="text-base" />
                                {item.name}
                              </button>
                            </li>
                          );
                        }
                        return (
                          <li key={item.id}>
                            <a 
                              href={item.link} 
                              className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              <Icon className="text-base" />
                              {item.name}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}

              {/* 🔐 Sign In Button (if not logged in) */}
              {!userInfo && (
                <a 
                  href="/login" 
                  className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-all duration-200"
                >
                  <FaUser className="text-sm" />
                  <span className="text-sm font-medium">Sign In</span>
                </a>
              )}

              {/* 🌓 Dark Mode Toggle */}
              <div><DarkMode /></div>

              {/* 📱 Mobile Menu Button */}
              <button 
                className="sm:hidden block text-3xl focus:outline-none" 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Toggle mobile menu"
              >
                <HiMenuAlt3 />
              </button>
            </div>
          </div>
        </div>

        {/* 🧭 Desktop Navigation Menu */}
        <div className="flex justify-center">
          <ul className="sm:flex hidden items-center gap-4">
            {Menu.map((data) => (
              <li key={data.id}>
                <a 
                  href={data.link} 
                  className="inline-block px-4 hover:text-primary duration-200"
                >
                  {data.name}
                </a>
              </li>
            ))}
            <li className='group relative cursor-pointer'>
              <a href='#' className='flex items-center gap-[2px] py-2'>
                Trending
                <span><FaCaretDown className='transition-all duration-200 group-hover:rotate-180'/></span>
              </a>
              <div className='absolute z-[9999] hidden group-hover:block w-[180px] rounded-md bg-white dark:bg-gray-800 p-2 text-black dark:text-white shadow-xl border dark:border-gray-700'>
                <ul>
                  {DropdownLinks.map((data) => (
                    <li key={data.id}>
                      <a 
                        href={data.link} 
                        className='inline-block w-full rounded-md p-2 hover:bg-primary/20'
                      >
                        {data.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          </ul>
        </div>
        
        {/* 📱 Mobile Menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden bg-white dark:bg-gray-900 px-4 py-4 shadow-md">
            <ul className="flex flex-col gap-4">
              {Menu.map((data) => (
                <li key={data.id}>
                  <a 
                    href={data.link} 
                    className="block px-4 py-2 hover:translate-x-1 hover:text-primary text-black dark:text-white transition-all" 
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {data.name}
                  </a>
                </li>
              ))}
              <li>
                <span className="block px-4 py-2 font-semibold text-black dark:text-white">Trending</span>
                <ul className="ml-6 mt-1">
                  {DropdownLinks.map((data) => (
                    <li key={data.id}>
                      <a 
                        href={data.link} 
                        className="block px-4 py-1 text-black dark:text-white hover:text-primary hover:translate-x-1 transition-all" 
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        {data.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>

              {/* Mobile Profile Menu */}
              {userInfo && (
                <li>
                  <div className="flex items-center gap-3 px-4 py-2 border-t dark:border-gray-700 mt-2 pt-4">
                    <img 
                      src={profilePictureUrl || "/default-avatar.png"}
                      alt="Profile"
                      className="w-10 h-10 rounded-full object-cover"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="gray"%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/%3E%3C/svg%3E';
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-black dark:text-white truncate">
                        {getUserFullName()}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                        {userInfo.email}
                      </p>
                    </div>
                  </div>
                  <ul className="ml-6 mt-2 space-y-1">
                    {ProfileMenuItems.map((item) => {
                      const Icon = item.icon;
                      if (item.name === "Sign Out") {
                        return (
                          <li key={item.id}>
                            <button
                              onClick={() => {
                                handleLogout();
                                setMobileMenuOpen(false);
                              }}
                              className="flex items-center gap-3 px-4 py-2 text-sm rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 w-full text-left"
                            >
                              <Icon className="text-base" />
                              {item.name}
                            </button>
                          </li>
                        );
                      }
                      return (
                        <li key={item.id}>
                          <a
                            href={item.link}
                            className="flex items-center gap-3 px-4 py-2 text-sm rounded-lg text-black dark:text-white hover:text-primary hover:translate-x-1 transition-all"
                            onClick={() => setMobileMenuOpen(false)}
                          >
                            <Icon className="text-base" />
                            {item.name}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              )}

              {!userInfo && (
                <li className="border-t dark:border-gray-700 pt-4 mt-2">
                  <a 
                    href="/login" 
                    className="flex items-center gap-3 px-4 py-2 text-black dark:text-white hover:text-primary" 
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <FaUser className="text-base" />
                    Sign In
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}
      </nav>
      
      {/* 🛒 Cart Drawer */}
      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
};

export default Navbar;
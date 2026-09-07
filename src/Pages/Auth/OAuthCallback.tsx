// pages/Auth/OAuthCallback.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setCredentials } from '../../slices/authSlice';
import { toast } from 'react-toastify';
import { BiLoaderAlt } from 'react-icons/bi';
import { TiShoppingBag } from 'react-icons/ti';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const OAuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('Completing sign in...');

  const success = searchParams.get('success');
  const error = searchParams.get('error');

  // Fetch the authenticated user from the backend instead of trusting URL params.
  // The OAuth cookie is set on the backend origin during the redirect, so we must
  // query that origin directly (NOT through the Vite proxy) so the browser sends it.
  useEffect(() => {
    if (error) {
      setStatus('error');
      const errorMessages = {
        google_failed: 'Google sign in failed. Please try again.',
        facebook_failed: 'Facebook sign in failed. Please try again.',
        apple_failed: 'Apple sign in failed. Please try again.',
        oauth_failed: 'Authentication failed. Please try again.'
      };
      setMessage(errorMessages[error as keyof typeof errorMessages] || 'Sign in failed. Please try again.');
      toast.error(errorMessages[error as keyof typeof errorMessages] || 'Sign in failed');

      setTimeout(() => navigate('/login'), 3000);
      return;
    }

    if (success !== 'true') {
      setStatus('error');
      setMessage('Invalid authentication response');
      toast.error('Authentication failed');
      setTimeout(() => navigate('/login'), 3000);
      return;
    }

    const loadProfile = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/users/profile`, {
          credentials: 'include'
        });

        if (!res.ok) {
          throw new Error('Not authenticated');
        }

        const profile = await res.json();

        // Store credentials in Redux (backend profile, not client-supplied data)
        dispatch(setCredentials(profile));

        setStatus('success');
        setMessage(`Welcome back, ${profile.firstName}!`);
        toast.success(`Welcome, ${profile.firstName}!`);

        setTimeout(() => {
          if (profile.isAdmin || profile.role === 'admin') {
            navigate('/admin', { replace: true });
          } else {
            navigate('/', { replace: true });
          }
        }, 1500);
      } catch (err) {
        console.error('OAuth profile fetch error:', err);
        setStatus('error');
        setMessage('Failed to load your account. Please sign in again.');
        toast.error('Authentication failed');
        setTimeout(() => navigate('/login'), 3000);
      }
    };

    loadProfile();
  }, [success, error, navigate, dispatch]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800">
      <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-10 max-w-md w-full mx-4 text-center border border-white/20">
        {/* Logo */}
        <div className="flex justify-center gap-x-2 items-center mb-8">
          <div className="p-2 bg-amber-400/20 rounded-xl backdrop-blur-md">
            <TiShoppingBag className="text-amber-400 text-2xl" />
          </div>
          <span className="text-white font-bold text-xl">Bonwire Kente</span>
        </div>

        {/* Status Icon */}
        <div className="mb-6">
          {status === 'processing' && (
            <BiLoaderAlt className="w-16 h-16 text-amber-400 animate-spin mx-auto" />
          )}
          {status === 'success' && (
            <FaCheckCircle className="w-16 h-16 text-green-400 mx-auto animate-bounce" />
          )}
          {status === 'error' && (
            <FaTimesCircle className="w-16 h-16 text-red-400 mx-auto" />
          )}
        </div>

        {/* Message */}
        <h2 className={`text-xl font-semibold mb-2 ${
          status === 'success' ? 'text-green-400' :
          status === 'error' ? 'text-red-400' :
          'text-white'
        }`}>
          {status === 'processing' && 'Processing...'}
          {status === 'success' && 'Success!'}
          {status === 'error' && 'Oops!'}
        </h2>
        <p className="text-white/70">{message}</p>

        {/* Redirect notice */}
        {status !== 'processing' && (
          <p className="text-white/50 text-sm mt-4">
            Redirecting automatically...
          </p>
        )}
      </div>
    </div>
  );
};

export default OAuthCallback;
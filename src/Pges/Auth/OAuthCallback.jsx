// pages/Auth/OAuthCallback.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setCredentials } from '../../slices/authSlice.JS';
import { toast } from 'react-toastify';
import { BiLoaderAlt } from 'react-icons/bi';
import { TiShoppingBag } from 'react-icons/ti';
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa';

const OAuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('Completing sign in...');

  useEffect(() => {
    const processOAuth = async () => {
      try {
        const success = searchParams.get('success');
        const error = searchParams.get('error');
        const userDataParam = searchParams.get('user');

        // Handle errors
        if (error) {
          setStatus('error');
          const errorMessages = {
            google_failed: 'Google sign in failed. Please try again.',
            facebook_failed: 'Facebook sign in failed. Please try again.',
            apple_failed: 'Apple sign in failed. Please try again.',
            oauth_failed: 'Authentication failed. Please try again.'
          };
          setMessage(errorMessages[error] || 'Sign in failed. Please try again.');
          toast.error(errorMessages[error] || 'Sign in failed');
          
          setTimeout(() => navigate('/login'), 3000);
          return;
        }

        // Handle success
        if (success === 'true' && userDataParam) {
          const userData = JSON.parse(decodeURIComponent(userDataParam));
          
          // Store credentials in Redux
          dispatch(setCredentials(userData));
          
          setStatus('success');
          setMessage(`Welcome back, ${userData.firstName}!`);
          toast.success(`Welcome, ${userData.firstName}!`);
          
          // Redirect based on role
          setTimeout(() => {
            if (userData.isAdmin || userData.role === 'admin') {
              navigate('/admin', { replace: true });
            } else {
              navigate('/', { replace: true });
            }
          }, 1500);
          return;
        }

        // No valid params
        setStatus('error');
        setMessage('Invalid authentication response');
        setTimeout(() => navigate('/login'), 3000);

      } catch (err) {
        console.error('OAuth callback error:', err);
        setStatus('error');
        setMessage('Failed to process authentication');
        toast.error('Authentication failed');
        setTimeout(() => navigate('/login'), 3000);
      }
    };

    processOAuth();
  }, [searchParams, dispatch, navigate]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800">
      <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-10 max-w-md w-full mx-4 text-center border border-white/20">
        {/* Logo */}
        <div className="flex justify-center gap-x-2 items-center mb-8">
          <div className="p-2 bg-amber-400/20 rounded-xl backdrop-blur-md">
            <TiShoppingBag className="text-amber-400 text-2xl" />
          </div>
          <span className="text-white font-bold text-xl">Branding House</span>
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
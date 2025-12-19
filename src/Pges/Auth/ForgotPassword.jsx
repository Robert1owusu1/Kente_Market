import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MdOutlineMailOutline } from 'react-icons/md';
import { TiShoppingBag } from 'react-icons/ti';
import { BiLoaderAlt } from 'react-icons/bi';
import { FaCheckCircle, FaArrowLeft } from 'react-icons/fa';
import { toast } from 'react-toastify';

function IconInput({ children, placeholder, type, value, onChange, error, disabled }) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="w-full">
      <div className={`flex items-center gap-3 w-full relative h-12 border-2 transition-all duration-300 bg-white/5 backdrop-blur-md px-4 py-2 rounded-xl ${
        error 
          ? 'border-red-400 bg-red-50/10' 
          : isFocused 
            ? 'border-amber-400 bg-white/10' 
            : 'border-white/20 hover:border-white/30'
      }`}>
        <div className="text-xl text-white/80">
          {children}
        </div>
        <input  
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          className="bg-transparent outline-none text-white placeholder:text-white/50 w-full disabled:opacity-50"
        />
      </div>
      {error && (
        <p className="text-red-400 text-sm mt-1">{error}</p>
      )}
    </div>
  );
}

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!email) {
      setError('Email is required');
      return;
    }
    
    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/users/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to send reset email');
      }

      setIsSuccess(true);
      toast.success('Password reset link sent! Check your email.');
    } catch (err) {
      console.error('Error:', err);
      setError(err.message || 'Failed to send reset email. Please try again.');
      toast.error(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800 bg-[length:400%_400%] animate-gradient-cycle px-4">
      <div className="w-full max-w-md">
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-700/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 p-8">
          
          {/* Logo */}
          <div className="flex justify-center gap-x-2 items-center mb-8">
            <div className="p-2 bg-amber-400/20 rounded-xl backdrop-blur-md">
              <TiShoppingBag className="text-amber-400 text-2xl" />
            </div>
            <span className="text-white font-bold text-xl">Branding House</span>
          </div>

          {!isSuccess ? (
            <>
              {/* Header */}
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">
                  Forgot Password?
                </h1>
                <p className="text-white/70 text-base">
                  No worries! Enter your email and we'll send you reset instructions.
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                <IconInput
                  placeholder="Enter your email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  error={error}
                  disabled={isLoading}
                >
                  <MdOutlineMailOutline />
                </IconInput>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <BiLoaderAlt className="w-5 h-5 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>

              {/* Back to Login */}
              <div className="mt-6 text-center">
                <Link
                  to="/login"
                  className="text-amber-400 hover:text-amber-300 font-medium transition-colors inline-flex items-center gap-2"
                >
                  <FaArrowLeft className="text-sm" />
                  Back to Login
                </Link>
              </div>
            </>
          ) : (
            <>
              {/* Success Message */}
              <div className="text-center">
                <div className="mb-6 flex justify-center">
                  <div className="p-4 bg-green-500/20 rounded-full">
                    <FaCheckCircle className="text-green-400 text-5xl" />
                  </div>
                </div>
                
                <h2 className="text-2xl font-bold text-white mb-3">
                  Check Your Email
                </h2>
                
                <p className="text-white/80 mb-2">
                  We've sent password reset instructions to:
                </p>
                
                <p className="text-amber-400 font-semibold mb-6">
                  {email}
                </p>
                
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
                  <p className="text-white/70 text-sm">
                    <strong className="text-white">Didn't receive the email?</strong>
                    <br />
                    Check your spam folder or{' '}
                    <button
                      onClick={() => setIsSuccess(false)}
                      className="text-amber-400 hover:text-amber-300 font-medium"
                    >
                      try again
                    </button>
                  </p>
                </div>

                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 font-medium transition-colors"
                >
                  <FaArrowLeft className="text-sm" />
                  Back to Login
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Security Note */}
        <div className="mt-6 text-center">
          <p className="text-white/50 text-sm">
            🔒 This is a secure password reset process
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
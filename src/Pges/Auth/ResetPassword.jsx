// ResetPassword.jsx - Complete Component
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { RiLockPasswordFill } from 'react-icons/ri';
import { TiShoppingBag } from 'react-icons/ti';
import { BiLoaderAlt } from 'react-icons/bi';
import { FaEye, FaEyeSlash, FaCheckCircle } from 'react-icons/fa';
import { toast } from 'react-toastify';

function PasswordInput({ children, placeholder, value, onChange, error, disabled }) {
  const [showPassword, setShowPassword] = useState(false);
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
          type={showPassword ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          className="bg-transparent outline-none text-white placeholder:text-white/50 w-full disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="text-white/60 hover:text-white transition-colors p-1"
        >
          {showPassword ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>
      {error && (
        <p className="text-red-400 text-sm mt-1">{error}</p>
      )}
    </div>
  );
}

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: ''
  });
  
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isTokenValid, setIsTokenValid] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  // Validate token on mount
  useEffect(() => {
    const validateToken = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/users/reset-password/${token}`, {
          method: 'GET',
        });

        if (response.ok) {
          setIsTokenValid(true);
        } else {
          const data = await response.json();
          toast.error(data.message || 'Invalid or expired reset link');
          setTimeout(() => navigate('/forgot-password'), 3000);
        }
      } catch (err) {
        console.error('Error validating token:', err);
        toast.error('Failed to validate reset link');
        setTimeout(() => navigate('/forgot-password'), 3000);
      } finally {
        setIsValidating(false);
      }
    };

    if (token) {
      validateToken();
    } else {
      navigate('/forgot-password');
    }
  }, [token, navigate, API_BASE_URL]);

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
      newErrors.password = 'Password must contain uppercase, lowercase, and number';
    }
    
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/users/reset-password/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: formData.password,
          confirmPassword: formData.confirmPassword
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to reset password');
      }

      setIsSuccess(true);
      toast.success('Password reset successful!');
      
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err) {
      console.error('Error:', err);
      toast.error(err.message);
      setErrors({ submit: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800">
        <div className="text-center">
          <BiLoaderAlt className="w-12 h-12 animate-spin text-amber-400 mx-auto mb-4" />
          <p className="text-white/70">Validating reset link...</p>
        </div>
      </div>
    );
  }

  if (!isTokenValid) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800 px-4">
        <div className="text-center">
          <div className="p-4 bg-red-500/20 rounded-full inline-block mb-4">
            <span className="text-red-400 text-5xl">⚠️</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Invalid Reset Link</h2>
          <p className="text-white/70 mb-6">This password reset link is invalid or has expired.</p>
          <Link
            to="/forgot-password"
            className="inline-block bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold py-3 px-6 rounded-xl hover:from-amber-600 hover:to-orange-600 transition-all"
          >
            Request New Link
          </Link>
        </div>
      </div>
    );
  }

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
                  Reset Password
                </h1>
                <p className="text-white/70 text-base">
                  Enter your new password below
                </p>
              </div>

              {/* Form */}
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    New Password <span className="text-red-400">*</span>
                  </label>
                  <PasswordInput
                    placeholder="Enter new password"
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    error={errors.password}
                    disabled={isLoading}
                  >
                    <RiLockPasswordFill />
                  </PasswordInput>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Confirm Password <span className="text-red-400">*</span>
                  </label>
                  <PasswordInput
                    placeholder="Confirm new password"
                    value={formData.confirmPassword}
                    onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                    error={errors.confirmPassword}
                    disabled={isLoading}
                  >
                    <RiLockPasswordFill />
                  </PasswordInput>
                </div>

                {/* Password Requirements */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/80 text-sm font-medium mb-2">Password must contain:</p>
                  <ul className="space-y-1 text-white/60 text-xs">
                    <li>✓ At least 8 characters</li>
                    <li>✓ One uppercase letter</li>
                    <li>✓ One lowercase letter</li>
                    <li>✓ One number</li>
                  </ul>
                </div>

                {/* Submit Error */}
                {errors.submit && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <p className="text-red-400 text-sm">{errors.submit}</p>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  onClick={handleSubmit}
                  disabled={isLoading}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <BiLoaderAlt className="w-5 h-5 animate-spin" />
                      Resetting Password...
                    </>
                  ) : (
                    'Reset Password'
                  )}
                </button>
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
                  Password Reset Successful!
                </h2>
                
                <p className="text-white/80 mb-6">
                  Your password has been changed successfully.
                  <br />
                  Redirecting to login...
                </p>

                <Link
                  to="/login"
                  className="inline-block bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold py-3 px-6 rounded-xl hover:from-amber-600 hover:to-orange-600 transition-all"
                >
                  Go to Login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
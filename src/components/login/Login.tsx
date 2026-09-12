import { Link, useLocation, useNavigate } from "react-router-dom";
import React, { useState, useEffect } from "react";
import loginilu from "../../assets/images/illustrate.webp"
import { TiShoppingBag } from "react-icons/ti";
import { FcGoogle } from "react-icons/fc";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { MdOutlineMailOutline } from "react-icons/md";
import { RiLockPasswordFill } from "react-icons/ri";
import { BiLoaderAlt } from "react-icons/bi";
import { useLoginMutation } from "../../slices/usersApiSlice";
import { setCredentials } from "../../slices/authSlice";
import { useAppDispatch, useAppSelector } from "../../store";
import { toast } from 'react-toastify';
import Footer from "../../components/Footer/Footer";
import LegalConsentBox from "../legal/LegalConsentBox";
import LegalConsentModal from "../legal/LegalConsentModal";
import { useLegalConsent } from "../../hooks/useLegalConsent";
import type { FormErrors } from "../../types/domain";

// Only allow in-app navigation targets. Blocks open-redirect attempts like
// /login?redirect=https://evil.com or //evil.com (scheme-relative).
const internalPath = (value: string | null): string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";




// Modern Icon Button Component
const buttonVariants = {
  outline: "border-2 border-white/20 bg-white/5 hover:bg-white/10 backdrop-blur-md shadow-lg hover:shadow-xl text-white",
  solid: "bg-white text-gray-800 hover:bg-gray-100 shadow-lg hover:shadow-xl",
};

function IconButton({
  children,
  text,
  onClick,
  disabled,
  loading,
  variant = "outline",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  text: string;
  loading?: boolean;
  variant?: keyof typeof buttonVariants;
}) {
  const baseClasses = "w-full text-base font-medium rounded-xl flex items-center justify-center gap-3 px-4 py-3 transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
  
  const variants = buttonVariants;

  return (
    <button 
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${variants[variant]}`}
      {...props}
    >
      {loading ? (
        <BiLoaderAlt className="w-5 h-5 animate-spin" />
      ) : (
        <span className="text-xl">{children}</span>
      )}
      <span className="font-semibold">{text}</span>
    </button>
  );
}

// Modern Input Component with better accessibility
function IconInput({ 
  children, 
  placeholder, 
  type, 
  value, 
  onChange, 
  error, 
  label,
  required = false,
  disabled = false,
  ...props 
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  
  const inputType = type === "password" && showPassword ? "text" : type;

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-white/90 mb-2">
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
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
          type={inputType}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          required={required}
          className="bg-transparent outline-none text-white placeholder:text-white/50 w-full disabled:opacity-50"
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${placeholder}-error` : undefined}
          {...props} 
        />
        {type === "password" && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="text-white/60 hover:text-white transition-colors p-1"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <FaEyeSlash /> : <FaEye />}
          </button>
        )}
      </div>
      {error && (
        <p id={`${placeholder}-error`} className="text-red-400 text-sm mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

const Login = () => {
  // Redux setup
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [login, { isLoading }] = useLoginMutation();
  const { userInfo } = useAppSelector((state) => state.auth);
  
  // Get redirect parameter (sanitized to an in-app path to prevent open redirect)
  const { search } = useLocation();
  const sp = new URLSearchParams(search);
  const redirect = internalPath(sp.get("redirect"));
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false
  });
  
  const [errors, setErrors] = useState<FormErrors>({});
  const [oauthLoading, setOauthLoading] = useState({
    google: false,
    facebook: false,
    apple: false
  });

  const legal = useLegalConsent();

  // ✅ FIXED: Single useEffect for redirect logic with replace to prevent history issues
  useEffect(() => {
    if (userInfo) {
      // ⭐ Check if email is verified
      if (!userInfo.isEmailVerified) {
        navigate('/verify-email', { replace: true });
        return;
      }
      
      // Redirect based on user role
      if (userInfo.isAdmin === true || userInfo.role === 'admin') {
        navigate('/admin', { replace: true });
      } else {
        navigate(redirect, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInfo]);
  
  // Form validation
  const validateForm = () => {
    const newErrors: FormErrors = {};
    
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form input changes
  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    try {
      const res = await login({
        email: formData.email, 
        password: formData.password
      }).unwrap();
      
      dispatch(setCredentials({ ...res }));
      toast.success('Login Successful');
    } catch (err) {
      const errorMessage = (err as { data?: { message?: string }; error?: string }).data?.message || (err as { data?: { message?: string }; error?: string }).error || 'Login failed';
      toast.error(errorMessage);
      setErrors({ submit: errorMessage });
    }
  };
  const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');
  // Handle OAuth login
  const handleOAuthLogin = async (provider: keyof typeof oauthLoading) => {
    setOauthLoading(prev => ({ ...prev, [provider]: true }));

    if (provider === 'google') {
      if (!legal.bothAccepted) {
        setOauthLoading(prev => ({ ...prev, [provider]: false }));
        setErrors(prev => ({
          ...prev,
          oauth: 'Please read and accept the Terms of Service and Privacy Policy before continuing.'
        }));
        legal.openDoc('terms');
        return;
      }

      try {
        const consentToken = await legal.requestConsentToken();
        window.location.href = `${API_BASE_URL}/api/auth/google?consent=${encodeURIComponent(consentToken)}`;
        return;
      } catch (err) {
        setErrors(prev => ({ ...prev, oauth: (err as Error).message || 'Could not continue with Google. Please try again.' }));
        setOauthLoading(prev => ({ ...prev, [provider]: false }));
        return;
      }
    }

    // Other providers are not configured
    setOauthLoading(prev => ({ ...prev, [provider]: false }));
  };

  return (
    <>
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800 bg-[length:400%_400%] animate-gradient-cycle px-4"> 
        <div className="form-container flex flex-col-reverse lg:flex-row w-full max-w-6xl mx-auto shadow-2xl overflow-hidden rounded-3xl backdrop-blur-sm bg-white/5 border border-white/10">
          
          {/* Form Section */}
          <div className="form-section w-full lg:w-1/2 px-6 sm:px-10 py-10 bg-gradient-to-br from-slate-800/90 to-slate-700/90 backdrop-blur-xl">

            {/* Logo */}
            <div className="logo-wrap flex justify-center lg:justify-start gap-x-2 items-center mb-8">
              <div className="p-2 bg-amber-400/20 rounded-xl backdrop-blur-md">
                <TiShoppingBag className="text-amber-400 text-2xl" />
              </div>
              <span className="text-white font-bold text-xl">Bonwire Kente</span>
            </div>

            {/* Header */}
            <div className="text-center lg:text-left mb-8">
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
                Welcome Back
              </h1>
              <p className="text-white/70 text-lg">
                Sign in to your account to continue
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Email Input */}
              <IconInput 
                placeholder="Enter your email"
                type="email"
                label="Email Address"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                error={errors.email}
                required
                disabled={isLoading}
              >
                <MdOutlineMailOutline />
              </IconInput>

              {/* Password Input */}
              <IconInput 
                placeholder="Enter your password"
                type="password"
                label="Password"
                value={formData.password}
                onChange={(e) => handleInputChange('password', e.target.value)}
                error={errors.password}
                required
                disabled={isLoading}
              >
                <RiLockPasswordFill />
              </IconInput>

              {/* Remember Me & Forgot Password */}
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.rememberMe}
                    onChange={(e) => handleInputChange('rememberMe', e.target.checked)}
                    className="w-4 h-4 text-amber-400 bg-transparent border-white/30 rounded focus:ring-amber-400 focus:ring-2"
                    disabled={isLoading}
                  />
                  <span className="text-white/80 text-sm">Remember me</span>
                </label>
                <Link 
                  to="/forgot-password" 
                  className="text-amber-400 hover:text-amber-300 transition-colors text-sm font-medium"
                >
                  Forgot Password?
                </Link>
              </div>

              {/* Submit Error */}
              {errors.submit && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <p className="text-red-400 text-sm">{errors.submit}</p>
                </div>
              )}

              {/* Submit Button */}
              <button 
                type="submit" 
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <BiLoaderAlt className="w-5 h-5 animate-spin" />
                    Signing In...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-4 my-8">
              <div className="flex-1 h-px bg-white/20"></div>
              <span className="text-white/60 text-sm font-medium">Or continue with</span>
              <div className="flex-1 h-px bg-white/20"></div>
            </div>

            {/* OAuth Buttons */}
            <div className="w-full max-w-xs mx-auto space-y-4 mb-8">
              <IconButton 
                text="Google" 
                onClick={() => handleOAuthLogin('google')}
                loading={oauthLoading.google}
                disabled={isLoading}
              >
                <FcGoogle />
              </IconButton>

              {/* Legal acceptance is required to continue with Google */}
              <LegalConsentBox
                acceptedDocs={legal.acceptedDocs}
                bothAccepted={legal.bothAccepted}
                openDoc={legal.openDoc}
                disabled={isLoading}
              />
            </div>

            {/* OAuth Error */}
            {errors.oauth && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-6">
                <p className="text-red-400 text-sm">{errors.oauth}</p>
              </div>
            )}

            {/* Sign Up Link */}
            <p className="text-center text-white/70">
              New to Bonwire Kente?{' '}
              <Link 
                to={redirect ? `/register?redirect=${redirect}` : '/register'} 
                className="text-amber-400 hover:text-amber-300 font-semibold transition-colors"
              >
                Create Account
              </Link>
            </p>
          </div>

          {/* Illustration Section */}
          <div className="illustration-section w-full lg:w-1/2 bg-gradient-to-br from-amber-400 to-orange-500 shadow-2xl flex flex-col items-center justify-center p-8 relative overflow-hidden">
            
            {/* Background Pattern */}
            <div className="absolute inset-0 bg-gradient-to-br from-amber-300/20 to-transparent"></div>
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-32 translate-x-32"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24"></div>
            
            <div className="relative z-10 text-center">
              {/* Illustration */}
              <div className="mb-8">
                <img 
                  src={loginilu} 
                  alt="Welcome illustration" 
                  className="w-full max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg mx-auto drop-shadow-2xl" 
                />
              </div>

              {/* Content */}
              <div className="mb-8">
                <h2 className="text-white text-2xl sm:text-3xl font-bold mb-3">
                  Connect With Every Application
                </h2>
                <p className="text-white/90 text-lg leading-relaxed max-w-md mx-auto">
                  Everything you need in an easily customizable dashboard to grow your business.
                </p>
              </div>

              {/* Pagination Dots */}
              <div className="flex justify-center items-center gap-2">
                {[0, 1, 2, 3].map((_, index) => (
                  <div 
                    key={index}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      index === 0 ? 'bg-white w-8' : 'bg-white/50'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Legal Agreement Modal */}
      <LegalConsentModal
        activeDoc={legal.activeDoc}
        onClose={() => legal.setActiveDoc(null)}
        onAgree={legal.handleDocAgree}
      />

      <Footer />
    </>
  );
};

export default Login;
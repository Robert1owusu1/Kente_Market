import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FcGoogle } from "react-icons/fc";
import { FaApple, FaFacebook, FaEye, FaEyeSlash } from "react-icons/fa";
import { MdOutlineMailOutline, MdPersonOutline } from "react-icons/md";
import { RiLockPasswordFill } from "react-icons/ri";
import { BiLoaderAlt } from "react-icons/bi";
import { TiShoppingBag } from "react-icons/ti";
import Footer from "../../components/Footer/Footer";
import { useRegisterMutation } from "../../slices/usersApiSlice";
import { toast } from "react-toastify";
import { setCredentials } from "../../slices/authSlice.JS";
import { useDispatch } from "react-redux";



// Modern Icon Button Component
function IconButton({ children, text, onClick, disabled, loading, variant = "outline", ...props }) {
  const baseClasses = "w-full text-base font-medium rounded-xl flex items-center justify-center gap-3 px-4 py-3 transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
  
  const variants = {
    outline: "border-2 border-white/20 bg-white/5 hover:bg-white/10 backdrop-blur-md shadow-lg hover:shadow-xl text-white",
    solid: "bg-white text-gray-800 hover:bg-gray-100 shadow-lg hover:shadow-xl",
  };

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

// Password Strength Indicator Component
function PasswordStrengthIndicator({ password }) {
  const getPasswordStrength = (password) => {
    if (!password) return { score: 0, level: '', color: 'transparent', width: '0%' };
    
    let score = 0;
    const checks = [
      { test: /.{8,}/, label: 'At least 8 characters' },
      { test: /[a-z]/, label: 'Lowercase letter' },
      { test: /[A-Z]/, label: 'Uppercase letter' },
      { test: /[0-9]/, label: 'Number' },
      { test: /[^A-Za-z0-9]/, label: 'Special character' }
    ];
    
    checks.forEach(check => {
      if (check.test.test(password)) score++;
    });
    
    const levels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'];
    const widths = ['20%', '40%', '60%', '80%', '100%'];
    
    return {
      score,
      level: levels[score - 1] || 'Very Weak',
      color: colors[score - 1] || '#ef4444',
      width: widths[score - 1] || '20%',
      checks: checks.map(check => ({
        ...check,
        passed: check.test.test(password)
      }))
    };
  };

  const strength = getPasswordStrength(password);

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/70">Password strength:</span>
        <span className="text-xs font-medium" style={{ color: strength.color }}>
          {strength.level}
        </span>
      </div>
      <div className="w-full bg-white/20 rounded-full h-1.5">
        <div 
          className="h-1.5 rounded-full transition-all duration-300"
          style={{ 
            backgroundColor: strength.color, 
            width: strength.width 
          }}
        />
      </div>
      {password.length > 0 && (
        <div className="grid grid-cols-1 gap-1 text-xs">
          {strength.checks.map((check, index) => (
            <div 
              key={index} 
              className={`flex items-center gap-2 ${
                check.passed ? 'text-green-400' : 'text-white/50'
              }`}
            >
              <span className={`w-1 h-1 rounded-full ${
                check.passed ? 'bg-green-400' : 'bg-white/30'
              }`} />
              {check.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Modern Input Component with improvements
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
  showPasswordStrength = false,
  ...props 
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
          autoComplete={type === "password" ? "new-password" : "on"}
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
      
      {/* Password Strength Indicator */}
      {showPasswordStrength && type === "password" && (
        <PasswordStrengthIndicator password={value} />
      )}
      
      {error && (
        <p id={`${placeholder}-error`} className="text-red-400 text-sm mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

const Register = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [register, { isLoading: isRegistering }] = useRegisterMutation();

  // Form state
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    agreeToTerms: false,
  });

  const [errors, setErrors] = useState({});
  const [oauthLoading, setOauthLoading] = useState({
    google: false,
    facebook: false,
    apple: false,
  });
  const [showForm, setShowForm] = useState(false);

  // Enhanced validation
  const validateForm = () => {
    const newErrors = {};

    // Full name validation - improved
    const fullNameTrimmed = formData.fullName.trim();
    if (!fullNameTrimmed) {
      newErrors.fullName = "Full name is required";
    } else if (fullNameTrimmed.length < 2) {
      newErrors.fullName = "Full name must be at least 2 characters";
    } else if (fullNameTrimmed.length > 100) {
      newErrors.fullName = "Full name must be less than 100 characters";
    } else if (!/^[a-zA-Z\s'-]+$/.test(fullNameTrimmed)) {
      newErrors.fullName = "Full name can only contain letters, spaces, hyphens, and apostrophes";
    }

    // Email validation - improved
    const emailTrimmed = formData.email.toLowerCase().trim();
    if (!emailTrimmed) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      newErrors.email = "Please enter a valid email address";
    } else if (emailTrimmed.length > 255) {
      newErrors.email = "Email must be less than 255 characters";
    }

    // Password validation - enhanced
    if (!formData.password) {
      newErrors.password = "Password is required";
    } else {
      const password = formData.password;
      const validations = [
        { test: password.length >= 8, message: "Password must be at least 8 characters" },
        { test: /[a-z]/.test(password), message: "Password must contain at least one lowercase letter" },
        { test: /[A-Z]/.test(password), message: "Password must contain at least one uppercase letter" },
        { test: /[0-9]/.test(password), message: "Password must contain at least one number" },
        { test: password.length <= 128, message: "Password must be less than 128 characters" }
      ];

      const failedValidation = validations.find(v => !v.test);
      if (failedValidation) {
        newErrors.password = failedValidation.message;
      }
    }

    // Confirm password validation
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    // Terms validation
    if (!formData.agreeToTerms) {
      newErrors.agreeToTerms = "You must agree to the terms and conditions";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Input changes with real-time validation clearing
  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    
    // Clear errors for the field being edited
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
    
    // Clear general submit errors when user starts typing
    if (errors.submit) {
      setErrors((prev) => ({ ...prev, submit: "" }));
    }
  };

  // Enhanced submit handler

const handleSubmit = async (e) => {
  e.preventDefault();
  
  console.log("🔍 Form submission started");
  console.log("📝 Form data:", { 
    fullName: formData.fullName, 
    email: formData.email,
    passwordLength: formData.password.length,
    agreeToTerms: formData.agreeToTerms 
  });

  if (!validateForm()) {
    console.log("❌ Form validation failed:", errors);
    toast.error("Please fix the form errors before submitting");
    return;
  }

  // Parse name more carefully
  const nameParts = formData.fullName.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  // ✅ CLEAN APPROACH - Only send required fields during registration
  const userData = {
    firstName,
    lastName,
    email: formData.email.toLowerCase().trim(),
    password: formData.password,
    role: "customer",
    isActive: true,
  };
  // ❌ REMOVED: phone, address, city, state, zipCode, country nulls

  console.log("📤 Sending clean registration data:", { 
    ...userData, 
    password: "[HIDDEN " + userData.password.length + " chars]" 
  });

  try {
    const res = await register(userData).unwrap();
    
    console.log("✅ Registration successful:", res);
    
    // Store credentials
    dispatch(setCredentials(res));
    
    // ⭐ Show appropriate success message based on verification status
    if (res.isEmailVerified) {
      toast.success("Account created successfully! Welcome to Branding House!");
      navigate("/");  // Already verified (shouldn't happen for new users)
    } else {
      toast.success(res.message || "Account created! Please check your email for verification code.");
      navigate("/verify-email");  // ✅ Redirect to verification page
    }
    
  } catch (err) {
    console.error("❌ Registration failed:", err);
    
    // Enhanced error handling
    let errorMessage = "Registration failed. Please try again.";
    let specificErrors = {};
    
    if (err?.data?.message) {
      errorMessage = err.data.message;
      
      // Handle specific error types from improved User model
      if (errorMessage.toLowerCase().includes('email already exists')) {
        specificErrors.email = "This email is already registered. Please use a different email or try logging in.";
      } else if (errorMessage.toLowerCase().includes('validation failed')) {
        // Extract field-specific validation errors
        if (errorMessage.includes('First name')) {
          specificErrors.fullName = "Please enter a valid first name";
        }
        if (errorMessage.includes('email')) {
          specificErrors.email = "Please enter a valid email address";
        }
        if (errorMessage.includes('Password')) {
          specificErrors.password = "Password must be at least 8 characters";
        }
      } else if (errorMessage.toLowerCase().includes('password')) {
        specificErrors.password = errorMessage;
      }
    } else if (err?.status) {
      switch (err.status) {
        case 400:
          errorMessage = "Invalid registration data. Please check your information.";
          break;
        case 409:
          specificErrors.email = "Email already exists. Please use a different email.";
          errorMessage = "Email already exists";
          break;
        case 422:
          errorMessage = "Validation error. Please check your input.";
          break;
        case 500:
          errorMessage = "Server error. Please try again later.";
          break;
        default:
          errorMessage = `Registration failed (Error ${err.status})`;
      }
    } else if (err?.name === 'NetworkError' || err?.message?.includes('fetch')) {
      errorMessage = "Network error. Please check your connection and try again.";
    }
    
    // Set specific field errors or general error
    if (Object.keys(specificErrors).length > 0) {
      setErrors(prev => ({ ...prev, ...specificErrors }));
    } else {
      setErrors(prev => ({ ...prev, submit: errorMessage }));
    }
    
    toast.error(errorMessage);
  }
};
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';


  // OAuth handler - unchanged
  const handleOAuthLogin = (provider) => {
    setOauthLoading(prev => ({ ...prev, [provider]: true }));
    
    // Redirect to backend OAuth endpoint
    switch (provider) {
      case 'google':
        window.location.href = `${API_BASE_URL}/api/auth/google`;
        break;
      case 'facebook':
        window.location.href = `${API_BASE_URL}/api/auth/facebook`;
        break;
      case 'apple':
        // Apple Sign In not implemented yet
        toast.info('Apple Sign In coming soon!');
        setOauthLoading(prev => ({ ...prev, [provider]: false }));
        break;
      default:
        setOauthLoading(prev => ({ ...prev, [provider]: false }));
    }
  };
  const handleOAuthRegister = handleOAuthLogin;

  return (
    <>
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800 bg-[length:400%_400%] animate-gradient-cycle px-4">
        <div className="form-container flex flex-col w-full max-w-md mx-auto shadow-2xl overflow-hidden rounded-3xl backdrop-blur-sm bg-white/5 border border-white/10">
          
          {/* Form Section */}
          <div className="w-full px-6 sm:px-8 py-10 bg-gradient-to-br from-slate-800/90 to-slate-700/90 backdrop-blur-xl">
            
            {/* Logo */}
            <div className="logo-wrap flex justify-center gap-x-2 items-center mb-8">
              <div className="p-2 bg-amber-400/20 rounded-xl backdrop-blur-md">
                <TiShoppingBag className="text-amber-400 text-2xl" />
              </div>
              <span className="text-white font-bold text-xl">Branding House</span>
            </div>

            {/* Header */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-white mb-2">
                Create Account
              </h1>
              <p className="text-white/70 text-lg">
                Start your journey with us today
              </p>
            </div>

            {/* OAuth Buttons */}
            {!showForm && (
              <div className="space-y-4 mb-8">
                <IconButton 
                  text="Continue with Google" 
                  onClick={() => handleOAuthRegister('google')}
                  loading={oauthLoading.google}
                  disabled={isRegistering}
                >
                  <FcGoogle />
                </IconButton>
                <IconButton 
                  text="Continue with Facebook" 
                  onClick={() => handleOAuthRegister('facebook')}
                  loading={oauthLoading.facebook}
                  disabled={isRegistering}
                >
                  <FaFacebook className="text-blue-500" />
                </IconButton>
                <IconButton 
                  text="Continue with Apple" 
                  onClick={() => handleOAuthRegister('apple')}
                  loading={oauthLoading.apple}
                  disabled={isRegistering}
                >
                  <FaApple className="text-white" />
                </IconButton>
              </div>
            )}

            {/* OAuth Error */}
            {errors.oauth && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-6">
                <p className="text-red-400 text-sm">{errors.oauth}</p>
              </div>
            )}

            {/* Divider */}
            {!showForm && (
              <div className="flex items-center gap-4 my-8">
                <div className="flex-1 h-px bg-white/20"></div>
                <span className="text-white/60 text-sm font-medium">Or</span>
                <div className="flex-1 h-px bg-white/20"></div>
              </div>
            )}

            {/* Show Form Button */}
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-xl mb-6"
              >
                Sign up with Email
              </button>
            )}

            {/* Registration Form */}
            {showForm && (
              <form onSubmit={handleSubmit} className="space-y-6" noValidate>
                {/* Full Name Input */}
                <IconInput 
                  placeholder="Enter your full name"
                  type="text"
                  label="Full Name"
                  value={formData.fullName}
                  onChange={(e) => handleInputChange('fullName', e.target.value)}
                  error={errors.fullName}
                  required
                  disabled={isRegistering}
                  maxLength={100}
                >
                  <MdPersonOutline />
                </IconInput>

                {/* Email Input */}
                <IconInput 
                  placeholder="Enter your email"
                  type="email"
                  label="Email Address"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  error={errors.email}
                  required
                  disabled={isRegistering}
                  maxLength={255}
                >
                  <MdOutlineMailOutline />
                </IconInput>

                {/* Password Input with Strength Indicator */}
                <IconInput 
                  placeholder="Create a password"
                  type="password"
                  label="Password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  error={errors.password}
                  required
                  disabled={isRegistering}
                  showPasswordStrength={true}
                  maxLength={128}
                >
                  <RiLockPasswordFill />
                </IconInput>

                {/* Confirm Password Input */}
                <IconInput 
                  placeholder="Confirm your password"
                  type="password"
                  label="Confirm Password"
                  value={formData.confirmPassword}
                  onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                  error={errors.confirmPassword}
                  required
                  disabled={isRegistering}
                  maxLength={128}
                >
                  <RiLockPasswordFill />
                </IconInput>

                {/* Terms Agreement */}
                <div className="space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={formData.agreeToTerms}
                      onChange={(e) => handleInputChange('agreeToTerms', e.target.checked)}
                      className="w-4 h-4 text-amber-400 bg-transparent border-white/30 rounded focus:ring-amber-400 focus:ring-2 mt-0.5"
                      disabled={isRegistering}
                    />
                    <span className="text-white/80 text-sm leading-relaxed">
                      I agree to the{' '}
                      <Link to="/terms" className="text-amber-400 hover:text-amber-300 underline">
                        Terms of Service
                      </Link>
                      {' '}and{' '}
                      <Link to="/privacy" className="text-amber-400 hover:text-amber-300 underline">
                        Privacy Policy
                      </Link>
                    </span>
                  </label>
                  {errors.agreeToTerms && (
                    <p className="text-red-400 text-sm">{errors.agreeToTerms}</p>
                  )}
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
                  disabled={isRegistering}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
                >
                  {isRegistering ? (
                    <>
                      <BiLoaderAlt className="w-5 h-5 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </button>

                {/* Back to OAuth */}
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={isRegistering}
                  className="w-full text-white/70 hover:text-white text-sm transition-colors disabled:opacity-50"
                >
                  ← Back to other options
                </button>
              </form>
            )}

            {/* Login Link */}
            <p className="text-center text-white/70 mt-8">
              Already have an account?{' '}
              <Link 
                to="/login" 
                className="text-amber-400 hover:text-amber-300 font-semibold transition-colors"
              >
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
};

export default Register;
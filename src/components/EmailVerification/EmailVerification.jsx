import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { BiLoaderAlt } from 'react-icons/bi';
import { MdEmail, MdCheckCircle } from 'react-icons/md';
import { 
  useVerifyEmailMutation, 
  useResendOTPMutation,
  useGetVerificationStatusQuery 
} from '../../slices/usersApiSlice';
import { setCredentials } from '../../slices/authSlice.JS';

const EmailVerification = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { userInfo } = useSelector((state) => state.auth);

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes in seconds
  const [canResend, setCanResend] = useState(false);

  const [verifyEmail, { isLoading: isVerifying }] = useVerifyEmailMutation();
  const [resendOTP, { isLoading: isResending }] = useResendOTPMutation();
  const { data: verificationStatus, refetch } = useGetVerificationStatusQuery();

  // Redirect if already verified
  useEffect(() => {
    if (userInfo?.isEmailVerified) {
      navigate('/');
    }
  }, [userInfo, navigate]);

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) {
      setCanResend(true);
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // Format time display
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle OTP input
  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return; // Only numbers

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }

    // Auto-submit when all fields filled
    if (newOtp.every(digit => digit) && index === 5) {
      handleSubmit(newOtp.join(''));
    }
  };

  // Handle backspace
  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      document.getElementById(`otp-${index - 1}`)?.focus();
    }
  };

  // Handle paste
  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    if (!/^\d+$/.test(pastedData)) return;

    const newOtp = pastedData.split('');
    setOtp([...newOtp, ...Array(6 - newOtp.length).fill('')]);

    if (newOtp.length === 6) {
      handleSubmit(pastedData);
    }
  };

  // Submit OTP
  const handleSubmit = async (otpCode = null) => {
    const code = otpCode || otp.join('');

    if (code.length !== 6) {
      toast.error('Please enter the complete 6-digit code');
      return;
    }

    try {
      const result = await verifyEmail({ otp: code }).unwrap();
      
      // Update user info in Redux
      dispatch(setCredentials({
        ...userInfo,
        isEmailVerified: true
      }));

      toast.success(result.message || 'Email verified successfully!');
      
      // Redirect after success
      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (err) {
      console.error('Verification error:', err);
      toast.error(err?.data?.message || 'Invalid or expired OTP');
      setOtp(['', '', '', '', '', '']);
      document.getElementById('otp-0')?.focus();
      refetch(); // Refresh verification status
    }
  };

  // Resend OTP
  const handleResendOTP = async () => {
    if (!canResend && timeLeft > 0) {
      toast.error(`Please wait ${formatTime(timeLeft)} before resending`);
      return;
    }

    try {
      const result = await resendOTP().unwrap();
      toast.success(result.message || 'OTP sent successfully!');
      setTimeLeft(600); // Reset timer
      setCanResend(false);
      setOtp(['', '', '', '', '', '']);
      document.getElementById('otp-0')?.focus();
    } catch (err) {
      console.error('Resend error:', err);
      toast.error(err?.data?.message || 'Failed to resend OTP');
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-800 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-amber-400/20 rounded-full flex items-center justify-center">
              <MdEmail className="text-amber-400 text-4xl" />
            </div>
          </div>

          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              Verify Your Email
            </h1>
            <p className="text-white/70">
              We've sent a 6-digit code to
            </p>
            <p className="text-amber-400 font-semibold mt-1">
              {userInfo?.email}
            </p>
          </div>

          {/* OTP Input */}
          <div className="mb-6">
            <div className="flex justify-center gap-3 mb-4">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  id={`otp-${index}`}
                  type="text"
                  maxLength="1"
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={index === 0 ? handlePaste : undefined}
                  disabled={isVerifying}
                  className="w-12 h-14 text-center text-2xl font-bold bg-white/10 border-2 border-white/20 rounded-xl text-white focus:border-amber-400 focus:bg-white/20 transition-all outline-none disabled:opacity-50"
                />
              ))}
            </div>

            {/* Verification Status */}
            {verificationStatus && (
              <div className="text-center text-sm text-white/60">
                Attempts: {verificationStatus.verificationAttempts} / {verificationStatus.maxAttempts}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            onClick={() => handleSubmit()}
            disabled={isVerifying || otp.some(d => !d)}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold py-3 rounded-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center gap-2 mb-4"
          >
            {isVerifying ? (
              <>
                <BiLoaderAlt className="w-5 h-5 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <MdCheckCircle className="w-5 h-5" />
                Verify Email
              </>
            )}
          </button>

          {/* Resend OTP */}
          <div className="text-center">
            <p className="text-white/70 text-sm mb-2">
              Didn't receive the code?
            </p>
            
            {timeLeft > 0 && !canResend ? (
              <p className="text-amber-400 font-semibold">
                Resend in {formatTime(timeLeft)}
              </p>
            ) : (
              <button
                onClick={handleResendOTP}
                disabled={isResending}
                className="text-amber-400 hover:text-amber-300 font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
              >
                {isResending ? (
                  <>
                    <BiLoaderAlt className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Resend OTP'
                )}
              </button>
            )}
          </div>

          {/* Back to Login */}
          <div className="text-center mt-6">
            <button
              onClick={() => navigate('/login')}
              className="text-white/60 hover:text-white text-sm transition-colors"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailVerification;
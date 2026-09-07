import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { FaSpinner, FaCheckCircle } from 'react-icons/fa';
import { toast } from 'react-toastify';
import axios from 'axios';

const UnsubscribePage = () => {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleUnsubscribe = async () => {
    if (!email) {
      toast.error('No email provided');
      return;
    }
    setIsLoading(true);
    try {
      await axios.post('/api/subscribe/unsubscribe', { email });
      setSuccess(true);
      toast.success('You have been unsubscribed');
    } catch (err) {
      const apiErr = err as { response?: { data?: { message?: string } }; message?: string; error?: string } | undefined;
      toast.error(apiErr?.response?.data?.message || 'Failed to unsubscribe. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg max-w-md w-full p-8 text-center">
        <div className="text-5xl mb-4">✉️</div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Unsubscribe</h1>

        {success ? (
          <div className="py-6">
            <FaCheckCircle className="text-5xl text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
              You've been unsubscribed
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              You'll no longer receive our newsletter. We're sorry to see you go!
            </p>
            <Link
              to="/"
              className="inline-block px-6 py-3 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors"
            >
              Back to Home
            </Link>
          </div>
        ) : (
          <>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              We're sorry to see you go. Please confirm you'd like to unsubscribe this email:
            </p>
            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 mb-6 text-sm text-gray-700 dark:text-gray-300 break-all">
              {email || <span className="text-gray-400">No email provided</span>}
            </div>

            <button
              onClick={handleUnsubscribe}
              disabled={isLoading || !email}
              className="w-full px-6 py-3 bg-red-500 hover:bg-red-600 transition text-white rounded-lg font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <FaSpinner className="animate-spin" /> Unsubscribing...
                </>
              ) : (
                'Unsubscribe'
              )}
            </button>

            <div className="mt-4">
              <Link to="/" className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary">
                No, keep my subscription
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default UnsubscribePage;

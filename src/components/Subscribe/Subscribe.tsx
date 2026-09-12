import React, { useState } from 'react'
import Banner from '../../assets/website/orange-pattern.jpg'
import { FaSpinner, FaCheckCircle } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { useSubscribeNewsletterMutation } from '../../slices/miscApiSlice'

const BannerImg = {
  backgroundImage: `url(${Banner})`,
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  height: "100%",
  width: "100%",
};

const Subscribe = () => {
  const [email, setEmail] = useState('');
  const [success, setSuccess] = useState(false);
  const [subscribeNewsletter, { isLoading }] = useSubscribeNewsletterMutation();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error('Please enter your email address');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Please enter a valid email address');
      return;
    }
    try {
      await subscribeNewsletter({ email: trimmed }).unwrap();
      setSuccess(true);
      setEmail('');
      toast.success("You're subscribed! Watch your inbox for new Kente collections.");
    } catch (err) {
      toast.error((err as { data?: { message?: string } }).data?.message || 'Failed to subscribe. Please try again.');
    }
  };

  return (
    <div
      data-aos="zoom-in"
      className="mb-20 bg-gray-100 dark:bg-gray-800 text-white"
      style={BannerImg}
    >
      <div className="container backdrop-blur-sm py-10">
        <div className="space-y-6 max-w-xl mx-auto text-center">
          <h2 className="text-2xl sm:text-4xl font-semibold">
            Get Notified About New Kente Collections
          </h2>

          {success ? (
            <div className="flex items-center justify-center gap-2 text-green-300 bg-green-500/20 border border-green-500/40 rounded-md p-4">
              <FaCheckCircle />
              <span>You're all set! We'll notify you about new collections.</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-center gap-4">
              <input
                data-aos="fade-up"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 rounded-md text-gray-700 dark:text-white bg-white/90 dark:bg-gray-700/90 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                type="submit"
                data-aos="fade-up"
                disabled={isLoading}
                className="px-6 py-3 bg-orange-500 hover:bg-orange-600 transition text-white rounded-md shadow-md disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <FaSpinner className="animate-spin" /> Subscribing...
                  </>
                ) : (
                  'Subscribe'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default Subscribe

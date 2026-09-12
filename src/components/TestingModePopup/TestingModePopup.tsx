// Components/TestingModePopup/TestingModePopup.tsx
// One-time popup shown on entry: warns that the store is in testing mode (all
// data will be wiped on full deployment) and points users to Suggestions.
// Dismissal persists for the session via localStorage.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaLightbulb, FaTimes, FaSpinner } from 'react-icons/fa';

const STORAGE_KEY = 'testing_mode_popup_dismissed';

const TestingModePopup = () => {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    // Let the page settle before popping the modal
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  const close = () => {
    setLeaving(true);
    setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, '1');
      setVisible(false);
    }, 200);
  };

  const goToSuggestions = () => {
    setNavigating(true);
    localStorage.setItem(STORAGE_KEY, '1');
    setLeaving(true);
    setTimeout(() => {
      setVisible(false);
      navigate('/suggestions');
    }, 200);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity duration-200"
      style={{ opacity: leaving ? 0 : 1 }}
      onClick={() => !navigating && close()}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8 text-center transition-transform duration-200"
        style={{ transform: leaving ? 'scale(0.95)' : 'scale(1)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/40 mb-4">
          <FaLightbulb className="text-3xl text-amber-600 dark:text-amber-400" />
        </div>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          You're on the testing build
        </h2>

        <p className="text-gray-600 dark:text-gray-400 mt-3 text-sm leading-relaxed">
          This platform is currently in <strong>testing mode</strong>. Everything you try
          here — orders, accounts, designs — <strong>will be wiped</strong> when the store
          opens for real.
        </p>

        <p className="text-gray-600 dark:text-gray-400 mt-2 text-sm leading-relaxed">
          We're building this out in the open. Got an idea? Your feedback goes straight to
          the admin team through the{' '}
          <span className="font-semibold text-amber-600 dark:text-amber-400">Suggestions</span>{' '}
          page.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <button
            onClick={goToSuggestions}
            disabled={navigating}
            className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {navigating ? <FaSpinner className="animate-spin" /> : <FaLightbulb />} Give feedback
          </button>
          <button
            onClick={close}
            disabled={navigating}
            className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            <FaTimes /> Got it
          </button>
        </div>
      </div>
    </div>
  );
};

export default TestingModePopup;
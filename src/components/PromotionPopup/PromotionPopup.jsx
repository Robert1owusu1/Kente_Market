import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FaTimes } from 'react-icons/fa';
import { useGetActivePopupsQuery } from '../../slices/promotionsApiSlice';

const STORAGE_KEY = 'dismissed_promos';

const getDismissed = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
};

const PromotionPopup = () => {
  const { data: popups = [] } = useGetActivePopupsQuery();
  const [active, setActive] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!popups.length) return;

    const dismissed = getDismissed();
    const now = Date.now();

    // Find the highest-priority popup that hasn't been dismissed (or whose dismiss expired)
    const eligible = popups.find((p) => {
      if (!p.showAsPopup) return false;
      const d = dismissed[p.id];
      if (!d) return true;
      const hours = p.popupDismissedExpiryHours || 24;
      return now - d > hours * 3600 * 1000;
    });

    if (eligible) {
      setActive(eligible);
      // Small delay so it appears after page paint
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, [popups]);

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => {
      if (active) {
        const dismissed = getDismissed();
        dismissed[active.id] = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dismissed));
      }
      setActive(null);
    }, 300);
  };

  if (!active) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={dismiss}
      />

      {/* Modal */}
      <div
        className={`fixed inset-0 z-[101] flex items-center justify-center p-4 transition-all duration-300 ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
        onClick={(e) => e.target === e.currentTarget && dismiss()}
      >
        <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
          {/* Close button */}
          <button
            onClick={dismiss}
            className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/20 hover:bg-black/40 text-white flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <FaTimes size={14} />
          </button>

          {/* Image */}
          {active.image && (
            <div className="relative h-48 sm:h-56 overflow-hidden">
              <img
                src={active.image}
                alt={active.title}
                className="w-full h-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(to top, ${active.bgColor || '#f59e0b'}cc, transparent 60%)`,
                }}
              />
            </div>
          )}

          {/* Content */}
          <div className="p-6 text-center">
            {active.type && (
              <span
                className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-3"
                style={{
                  backgroundColor: active.bgColor || '#f59e0b',
                  color: active.textColor || '#fff',
                }}
              >
                {active.type}
              </span>
            )}
            <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-2">
              {active.title}
            </h3>
            {active.description && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">
                {active.description}
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {active.link && (
                <Link to={active.link} onClick={dismiss}>
                  <button
                    className="w-full sm:w-auto px-6 py-3 rounded-full font-semibold text-white shadow-lg transition-all hover:scale-105"
                    style={{
                      backgroundColor: active.bgColor || '#f59e0b',
                    }}
                  >
                    {active.linkText || 'Learn More'}
                  </button>
                </Link>
              )}
              <button
                onClick={dismiss}
                className="w-full sm:w-auto px-6 py-3 rounded-full font-semibold border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default PromotionPopup;

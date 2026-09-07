import React, { useState, useRef, useEffect } from 'react';
import { FaFlag, FaChevronDown } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useCreateReportMutation } from '../../slices/reportsApiSlice';

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'fake', label: 'Fake review' },
  { value: 'other', label: 'Other' },
] as const;

type ReportReason = (typeof REPORT_REASONS)[number];

const ReportReviewButton = ({ reviewId }: { reviewId?: number | string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmReason, setConfirmReason] = useState<ReportReason | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [createReport, { isLoading }] = useCreateReportMutation();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setConfirmReason(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleReasonSelect = (reason: ReportReason) => {
    setConfirmReason(reason);
  };

  const handleConfirm = async () => {
    try {
      await createReport({ reviewId, reason: confirmReason!.value }).unwrap();
      toast.success('Review reported successfully');
      setIsOpen(false);
      setConfirmReason(null);
    } catch (err) {
      toast.error((err as { data?: { message?: string } }).data?.message || 'Failed to report review');
    }
  };

  const handleCancel = () => {
    setConfirmReason(null);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => { setIsOpen(!isOpen); setConfirmReason(null); }}
        aria-label="Report review"
        title="Report this review"
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded transition-colors"
      >
        <FaFlag className="text-sm" />
        Report
        <FaChevronDown className="text-[10px]" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-xl border dark:border-gray-700 z-50">
          {confirmReason ? (
            <div className="p-4">
              <p className="text-sm text-gray-800 dark:text-white font-medium mb-3">
                Report as <span className="text-red-500">{confirmReason.label.toLowerCase()}</span>?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  disabled={isLoading}
                  className="flex-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded disabled:opacity-50"
                >
                  {isLoading ? 'Reporting...' : 'Confirm'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={isLoading}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 text-xs font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="py-1">
              <p className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                Why are you reporting this?
              </p>
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason.value}
                  onClick={() => handleReasonSelect(reason)}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {reason.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReportReviewButton;

// FILE LOCATION: src/Pages/Vendor/VendorPlanGate.tsx
// DESCRIPTION: Shown to an APPROVED vendor who has not yet paid for a plan.
//   Lists the available plans and starts Paystack checkout. The dashboard stays
//   locked behind this until payment lands (backend planGate.locked).
import { useState } from 'react';
import { toast } from 'react-toastify';
import { FaStore, FaCheck, FaSpinner, FaLock } from 'react-icons/fa';
import { useGetSelectablePlansQuery, useSubscribeToPlanMutation } from '../../slices/vendorsApiSlice';
import { formatCurrency } from '../../utils/formatCurrency';

const FEATURE_LABELS: Record<string, string> = {
  storefront: 'Public storefront page',
  analytics: 'Sales & traffic analytics',
  custom_requests: 'Accept custom orders',
  promotions: 'Run coupons & promotions',
  featured_eligible: 'Eligible for featured placement',
  international_shipping: 'Ship internationally',
  bulk_wholesale: 'B2B wholesale pricing',
  priority_support: 'Priority support',
};

const VendorPlanGate = ({ businessName }: { businessName?: string }) => {
  const { data: plans = [], isLoading } = useGetSelectablePlansQuery();
  const [subscribe, { isLoading: subscribing }] = useSubscribeToPlanMutation();
  const [pendingId, setPendingId] = useState<number | null>(null);

  const handlePay = async (planId: number) => {
    setPendingId(planId);
    try {
      const res = await subscribe({ planId }).unwrap();
      if (res.authorizationUrl) {
        window.location.href = res.authorizationUrl; // to Paystack checkout
      } else {
        toast.error('Could not start payment. Please try again.');
      }
    } catch (error) {
      const err = error as { data?: { message?: string } } | undefined;
      toast.error(err?.data?.message || 'Could not start payment');
      setPendingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
          <FaLock className="text-2xl text-primary" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Choose your plan to go live
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-xl mx-auto">
          {businessName ? `${businessName} is approved!` : 'Your store is approved!'} Pick a plan and pay to
          unlock your seller dashboard. Plans renew automatically — cancel anytime.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><FaSpinner className="animate-spin h-8 w-8 text-primary" /></div>
      ) : plans.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-10 text-center text-gray-500 dark:text-gray-400">
          No plans are available yet. Please check back shortly or contact support.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div key={plan.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col p-6">
              <div className="flex items-center gap-2 mb-1">
                <FaStore className="text-primary" />
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">{plan.name}</h2>
              </div>
              {plan.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{plan.description}</p>}
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(plan.price, plan.currency)}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">/{plan.billingInterval === 'annually' ? 'year' : 'month'}</span>
                {plan.commissionRate != null && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    {(plan.commissionRate * 100).toFixed(0)}% platform commission on sales
                  </p>
                )}
              </div>
              <ul className="space-y-2 mb-6 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <FaCheck className="text-emerald-500 mt-0.5 shrink-0" />
                    <span>{FEATURE_LABELS[f] || f}</span>
                  </li>
                ))}
                <li className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <FaCheck className="text-emerald-500 mt-0.5 shrink-0" />
                  <span>{plan.productLimit == null ? 'Unlimited products' : `Up to ${plan.productLimit} products`}</span>
                </li>
              </ul>
              <button
                onClick={() => handlePay(plan.id)}
                disabled={subscribing}
                className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-lg hover:bg-primary/90 font-semibold disabled:opacity-60"
              >
                {subscribing && pendingId === plan.id ? <FaSpinner className="animate-spin" /> : null}
                {subscribing && pendingId === plan.id ? 'Redirecting…' : 'Pay for this plan'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VendorPlanGate;

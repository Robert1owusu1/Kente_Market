// Pages/Vendor/VendorInsights.tsx
// Demand forecast + fulfilment scorecard for weavers. Backs the weekly digest
// ("what buyers are asking for") and the fulfilment score surfaced publicly.
import {
  FaChartLine, FaClipboardCheck, FaTrophy, FaFire, FaLightbulb,
  FaSpinner, FaBoxOpen,
} from 'react-icons/fa';
import { useGetVendorInsightsQuery, useGetVendorFulfilmentQuery, useGetMyVendorProfileQuery } from '../../slices/vendorsApiSlice';
import { formatCedi } from '../../utils/formatCurrency';

const VendorInsights = () => {
  const { data: profile } = useGetMyVendorProfileQuery() as {
    data?: { vendor?: { userId?: number | string } };
  };
  const vendorId = profile?.vendor?.userId;

  const {
    data: insights,
    isLoading,
    isError,
  } = useGetVendorInsightsQuery();
  const {
    data: fulfilment,
    isLoading: fulfilmentLoading,
  } = useGetVendorFulfilmentQuery(vendorId ?? 0, { skip: !vendorId });

  if (isLoading || fulfilmentLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-10 flex justify-center text-gray-400">
        <FaSpinner className="animate-spin h-8 w-8" />
      </div>
    );
  }

  if (isError || !insights) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-10 text-center text-gray-500 dark:text-gray-400">
        <FaBoxOpen className="mx-auto text-4xl mb-3 opacity-50" />
        <p>Not enough sales data yet — insights unlock once buyers start ordering from you.</p>
      </div>
    );
  }

  const demand = insights.demand || {};
  const topTypes = demand.topTypes || [];
  const topProducts = demand.topProducts || [];
  const focus = insights.focus;
  const hasData = demand.totalQty > 0;
  const maxTypeQty = Math.max(1, ...topTypes.map((t) => Number(t.quantity) || 0));
  const onTimeRate = Number(fulfilment?.onTimeRate || 0);
  // Backend already returns a percentage (0-100), not a fraction.
  const onTimePct = Math.round(onTimeRate);

  return (
    <div className="space-y-6">
      {/* Fulfilment scorecard */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          <FaClipboardCheck className="text-emerald-500" /> Delivery record
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Measured against each custom order's agreed deadline — the number shoppers see on your store.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{fulfilment && fulfilment.withDeadline > 0 ? `${onTimePct}%` : '—'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Delivered on time</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-gray-800 dark:text-white">{fulfilment?.fulfilled ?? '—'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Delivered orders</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-gray-800 dark:text-white">{fulfilment?.onTime ?? '—'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Met the deadline</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-gray-800 dark:text-white">{fulfilment?.avgDaysEarly ?? '—'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Avg days early</p>
          </div>
        </div>
      </div>

      {!hasData && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-8 text-center">
          <FaChartLine className="mx-auto text-4xl text-amber-400 mb-3" />
          <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Your demand forecast will appear here</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            We compare every marketplace sale by pattern type so you know which Kente to weave next.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* Focus callout */}
          {focus && (
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl p-6 text-white shadow">
              <div className="flex items-center gap-3 mb-2">
                <FaLightbulb className="text-xl" />
                <h3 className="font-bold">Your weaving focus</h3>
              </div>
              <p className="text-white/95 text-sm">{focus.category} drives {focus.share}% of marketplace sales right now.</p>
              <p className="text-white font-semibold mt-2">{insights.tip}</p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            {/* Top product types */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <FaTrophy className="text-amber-500" /> Top-selling Kente types
              </h3>
              <div className="space-y-4">
                {topTypes.map((t, i) => {
                  const pct = ((Number(t.quantity) || 0) / maxTypeQty) * 100;
                  return (
                    <div key={t.category}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          {i + 1}. {t.category}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400">
                          {formatCedi(t.revenue)} · {t.share}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top products */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <FaFire className="text-orange-500" /> Hot items this week
              </h3>
              {topProducts.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No product-level data yet.</p>
              ) : (
                <ul className="divide-y dark:divide-gray-700">
                  {topProducts.map((p) => (
                    <li key={p.productId} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-800 dark:text-white">{p.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {p.category}{p.patternName ? ` · ${p.patternName}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-gray-900 dark:text-white">{formatCedi(p.revenue)}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{p.quantity} sold</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            Data refreshes weekly and feeds the demand digest in your notifications.
          </p>
        </>
      )}
    </div>
  );
};

export default VendorInsights;
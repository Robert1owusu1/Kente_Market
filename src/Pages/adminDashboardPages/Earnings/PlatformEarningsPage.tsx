// FILE LOCATION: src/Pages/adminDashboardPages/Earnings/PlatformEarningsPage.tsx
// DESCRIPTION: Admin "Platform Earnings" view — the money the platform (owner +
//   partners) keeps: platform-product income + marketplace commission, over a
//   selectable window, with a daily chart. Read-only; data from
//   GET /api/admin/platform-revenue.
import { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { FaSpinner, FaCoins, FaBoxOpen, FaHandHoldingUsd, FaStar, FaCrown } from 'react-icons/fa';
import { useGetPlatformRevenueQuery } from '../../../slices/platformRevenueApiSlice';
import { formatCurrency } from '../../../utils/formatCurrency';

const BRAND = '#92400e';      // platform-product
const COMMISSION = '#10b981'; // commission

/** YYYY-MM-DD for `n` days before today (local). */
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

const PRESETS: { label: string; days: number }[] = [
  { label: '7 days', days: 6 },
  { label: '30 days', days: 29 },
  { label: '90 days', days: 89 },
];

const PlatformEarningsPage = () => {
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => today());

  const { data, isLoading, isFetching, isError, refetch } = useGetPlatformRevenueQuery({ from, to });

  const applyPreset = (days: number) => {
    setFrom(daysAgo(days));
    setTo(today());
  };

  const s = data?.summary;
  const currency = data?.currency || 'GHS';

  const chartData = useMemo(
    () => (data?.series || []).map((p) => ({
      date: p.date.slice(5), // MM-DD for a compact axis
      'Platform products': p.platformProduct,
      Commission: p.commission,
    })),
    [data?.series]
  );

  const money = (n: number | undefined) => formatCurrency(n ?? 0, currency);

  return (
    <div className="space-y-6">
      {/* Header + range controls */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Platform Earnings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            What the platform keeps — product income plus marketplace commission.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.days)}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-amber-50 dark:hover:bg-gray-700"
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="block mt-0.5 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            To
            <input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)}
              className="block mt-0.5 px-2 py-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
          </label>
        </div>
      </div>

      {isError && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg p-4 flex items-center justify-between">
          <span>Failed to load platform earnings.</span>
          <button onClick={() => refetch()} className="underline font-semibold">Retry</button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <FaSpinner className="animate-spin h-8 w-8 text-amber-700" />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <SummaryCard
              icon={<FaCoins />} tone="brand"
              label="Total earnings (booked)"
              value={money(s?.totalBooked)}
              sub={`${money(s?.totalReleased)} released`}
            />
            <SummaryCard
              icon={<FaHandHoldingUsd />} tone="emerald"
              label="Marketplace commission"
              value={money(s?.commissionBooked)}
              sub={`${money(s?.commissionHeld)} still in escrow`}
            />
            <SummaryCard
              icon={<FaBoxOpen />} tone="amber"
              label="Platform-product income"
              value={money(s?.platformProductNet)}
              sub={`${money(s?.platformProductGross)} gross − ${money(s?.platformProductRefunds)} refunds`}
            />
            <SummaryCard
              icon={<FaStar />} tone="brand"
              label="Featured listings"
              value={money(s?.featuredNet)}
              sub="Vendor placement fees"
            />
            <SummaryCard
              icon={<FaCrown />} tone="amber"
              label="Kente Club"
              value={money(s?.membershipNet)}
              sub="Membership fees"
            />
          </div>

          {/* Daily chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Daily earnings</h2>
            {chartData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-gray-400 text-sm">
                No earnings in this period.
              </div>
            ) : (
              <div className="h-72" aria-busy={isFetching}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gPP" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BRAND} stopOpacity={0.7} />
                        <stop offset="95%" stopColor={BRAND} stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gCM" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COMMISSION} stopOpacity={0.7} />
                        <stop offset="95%" stopColor={COMMISSION} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip
                      formatter={(value) => money(Number(value))}
                      contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, color: '#f9fafb' }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="Commission" stackId="1" stroke={COMMISSION} fill="url(#gCM)" />
                    <Area type="monotone" dataKey="Platform products" stackId="1" stroke={BRAND} fill="url(#gPP)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const toneMap: Record<string, string> = {
  brand: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  amber: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
};

const SummaryCard = ({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; tone: string;
}) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
    <div className="flex items-center gap-2 mb-2">
      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg ${toneMap[tone]}`}>{icon}</span>
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
    </div>
    <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
  </div>
);

export default PlatformEarningsPage;

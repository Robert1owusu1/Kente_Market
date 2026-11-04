// FILE LOCATION: src/Pages/adminDashboardPages/Plans/PlansPage.tsx
// DESCRIPTION: Admin vendor-plan management (Phase 2, Step 4). Set each plan's
//   price, commission, product limit, features and visibility, then activate it
//   (which creates the Paystack plan so vendors can subscribe).
import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { useGetAdminFeaturedConfigQuery, useUpdateAdminFeaturedConfigMutation } from '../../../slices/featuredApiSlice';
import { FaSpinner, FaCheckCircle, FaRegCircle, FaSave } from 'react-icons/fa';
import {
  useGetAdminPlansQuery,
  useUpdateAdminPlanMutation,
  useSetAdminPlanActiveMutation,
  useGetPlanSettingsQuery,
  useUpdatePlanSettingsMutation,
  type AdminPlan,
} from '../../../slices/plansApiSlice';

const ALL_FEATURES: { key: string; label: string }[] = [
  { key: 'storefront', label: 'Storefront' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'custom_requests', label: 'Custom orders' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'featured_eligible', label: 'Featured eligible' },
  { key: 'international_shipping', label: 'International shipping' },
  { key: 'bulk_wholesale', label: 'Wholesale' },
  { key: 'priority_support', label: 'Priority support' },
];

const PlanCard = ({ plan }: { plan: AdminPlan }) => {
  const [updatePlan, { isLoading: saving }] = useUpdateAdminPlanMutation();
  const [setActive, { isLoading: toggling }] = useSetAdminPlanActiveMutation();

  const [price, setPrice] = useState(String(plan.price));
  const [commission, setCommission] = useState(String(((plan.commissionRate ?? 0) * 100).toFixed(2)));
  const [productLimit, setProductLimit] = useState(plan.productLimit == null ? '' : String(plan.productLimit));
  const [isPublic, setIsPublic] = useState(plan.isPublic);
  const [features, setFeatures] = useState<string[]>(plan.features || []);

  useEffect(() => {
    setPrice(String(plan.price));
    setCommission(String(((plan.commissionRate ?? 0) * 100).toFixed(2)));
    setProductLimit(plan.productLimit == null ? '' : String(plan.productLimit));
    setIsPublic(plan.isPublic);
    setFeatures(plan.features || []);
  }, [plan]);

  const toggleFeature = (key: string) =>
    setFeatures((f) => (f.includes(key) ? f.filter((x) => x !== key) : [...f, key]));

  const handleSave = async () => {
    const rate = Number(commission) / 100;
    if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) {
      toast.error('Commission must be between 0% and 50%');
      return;
    }
    try {
      await updatePlan({
        id: plan.id,
        price: Number(price) || 0,
        commissionRate: rate,
        productLimit: productLimit === '' ? null : Number(productLimit),
        isPublic,
        features,
      }).unwrap();
      toast.success(`${plan.name} saved`);
    } catch (e) {
      const err = e as { data?: { message?: string } } | undefined;
      toast.error(err?.data?.message || 'Failed to save plan');
    }
  };

  const handleToggleActive = async () => {
    try {
      await setActive({ id: plan.id, active: !plan.isActive }).unwrap();
      toast.success(!plan.isActive ? `${plan.name} activated` : `${plan.name} deactivated`);
    } catch (e) {
      const err = e as { data?: { message?: string } } | undefined;
      toast.error(err?.data?.message || 'Failed to update plan status');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{plan.name}</h3>
          <p className="text-xs text-gray-400">/{plan.slug} · {plan.billingInterval}</p>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
          plan.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
          {plan.isActive ? 'Active' : 'Draft'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <label className="text-xs text-gray-500 dark:text-gray-400">
          Price ({plan.currency})
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
            className="block mt-1 w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          Commission %
          <input type="number" min="0" max="50" step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)}
            className="block mt-1 w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          Product limit (blank = ∞)
          <input type="number" min="0" value={productLimit} onChange={(e) => setProductLimit(e.target.value)}
            className="block mt-1 w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 mt-5">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Shown to vendors
        </label>
      </div>

      <div className="mb-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Features</p>
        <div className="flex flex-wrap gap-2">
          {ALL_FEATURES.map((f) => {
            const on = features.includes(f.key);
            return (
              <button key={f.key} type="button" onClick={() => toggleFeature(f.key)}
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${
                  on ? 'bg-primary/10 border-primary text-primary'
                     : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
                {on ? <FaCheckCircle /> : <FaRegCircle />} {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {!plan.paystackPlanCode && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
          Not yet on Paystack — set a price and activate to enable checkout.
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
          {saving ? <FaSpinner className="animate-spin" /> : <FaSave />} Save
        </button>
        <button onClick={handleToggleActive} disabled={toggling}
          className={`px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60 ${
            plan.isActive ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
          {toggling ? '…' : plan.isActive ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </div>
  );
};

const GateToggles = () => {
  const { data: settings } = useGetPlanSettingsQuery();
  const [updateSettings, { isLoading }] = useUpdatePlanSettingsMutation();

  const toggle = async (patch: { required?: boolean; bonwireVerificationRequired?: boolean }) => {
    try {
      await updateSettings(patch).unwrap();
      toast.success('Settings updated');
    } catch {
      toast.error('Failed to update settings');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
      <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" disabled={isLoading} checked={!!settings?.required}
          onChange={(e) => toggle({ required: e.target.checked })} />
        <span>
          <span className="font-semibold">Require vendors to pay for a plan</span>
          <span className="block text-xs text-gray-400">Approved stores stay locked until they subscribe.</span>
        </span>
      </label>
      <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" disabled={isLoading} checked={settings?.bonwireVerificationRequired ?? true}
          onChange={(e) => toggle({ bonwireVerificationRequired: e.target.checked })} />
        <span>
          <span className="font-semibold">Require Bonwire origin before approval</span>
          <span className="block text-xs text-gray-400">Admins must verify origin before a store can be approved.</span>
        </span>
      </label>
    </div>
  );
};

const FeaturedConfigCard = () => {
  const { data } = useGetAdminFeaturedConfigQuery();
  const [update, { isLoading }] = useUpdateAdminFeaturedConfigMutation();
  const [price, setPrice] = useState('');
  const [maxDays, setMaxDays] = useState('');
  useEffect(() => {
    if (data) { setPrice(String(data.pricePerDay)); setMaxDays(String(data.maxDays)); }
  }, [data]);

  const save = async (patch: { enabled?: boolean; pricePerDay?: number; maxDays?: number }) => {
    try { await update(patch).unwrap(); toast.success('Featured settings updated'); }
    catch (e) { toast.error((e as { data?: { message?: string } })?.data?.message || 'Failed to update'); }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Featured listings</h3>
          <p className="text-xs text-gray-400">Vendors on an eligible plan pay to feature a product. Fees are 100% platform revenue.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" disabled={isLoading} checked={!!data?.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          Enabled
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500 dark:text-gray-400">
          Price per day (GHS)
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
            className="block mt-1 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          Max days
          <input type="number" min="1" max="365" value={maxDays} onChange={(e) => setMaxDays(e.target.value)}
            className="block mt-1 px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <button disabled={isLoading} onClick={() => save({ pricePerDay: Number(price), maxDays: Number(maxDays) })}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-60">Save</button>
      </div>
    </div>
  );
};

const PlansPage = () => {
  const { data: plans = [], isLoading, isError } = useGetAdminPlansQuery();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Vendor Plans</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Set each plan's price and commission, choose features, then activate to let Bonwire weavers subscribe.
        </p>
      </div>

      <GateToggles />
      <FeaturedConfigCard />

      {isLoading ? (
        <div className="flex justify-center py-16"><FaSpinner className="animate-spin h-8 w-8 text-primary" /></div>
      ) : isError ? (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg p-4">Failed to load plans.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {plans.map((p) => <PlanCard key={p.id} plan={p} />)}
        </div>
      )}
    </div>
  );
};

export default PlansPage;

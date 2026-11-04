// FILE LOCATION: src/Pages/adminDashboardPages/KenteClub/KenteClubAdminPage.tsx
// DESCRIPTION: Admin management of Kente Club tiers (Phase 3, Step 10). Set each
//   tier's price + members discount, then activate (creates the Paystack plan).
import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { FaCrown, FaSpinner, FaSave } from 'react-icons/fa';
import {
  useGetAdminMembershipPlansQuery, useUpdateAdminMembershipPlanMutation,
  useSetAdminMembershipActiveMutation, type AdminMembershipPlan,
} from '../../../slices/kenteClubApiSlice';

const TierCard = ({ plan }: { plan: AdminMembershipPlan }) => {
  const [update, { isLoading: saving }] = useUpdateAdminMembershipPlanMutation();
  const [setActive, { isLoading: toggling }] = useSetAdminMembershipActiveMutation();
  const [price, setPrice] = useState(String(plan.price));
  const [discount, setDiscount] = useState(String(plan.discountPercent));
  useEffect(() => { setPrice(String(plan.price)); setDiscount(String(plan.discountPercent)); }, [plan]);

  const save = async () => {
    const d = Number(discount);
    if (!Number.isFinite(d) || d < 0 || d > 50) { toast.error('Discount must be 0–50%'); return; }
    try { await update({ id: plan.id, price: Number(price) || 0, discountPercent: d }).unwrap(); toast.success(`${plan.name} saved`); }
    catch (e) { toast.error((e as { data?: { message?: string } })?.data?.message || 'Failed to save'); }
  };
  const toggle = async () => {
    try { await setActive({ id: plan.id, active: !plan.isActive }).unwrap(); toast.success(!plan.isActive ? 'Activated' : 'Deactivated'); }
    catch (e) { toast.error((e as { data?: { message?: string } })?.data?.message || 'Failed'); }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2"><FaCrown className="text-amber-500" /><h3 className="font-bold text-gray-900 dark:text-white">{plan.name}</h3></div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${plan.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>{plan.isActive ? 'Active' : 'Draft'}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <label className="text-xs text-gray-500 dark:text-gray-400">Price ({plan.currency})
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="block mt-1 w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">Members discount %
          <input type="number" min="0" max="50" step="0.5" value={discount} onChange={(e) => setDiscount(e.target.value)} className="block mt-1 w-full px-2 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
      </div>
      {!plan.paystackPlanCode && <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">Set a price and activate to enable checkout.</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60">{saving ? <FaSpinner className="animate-spin" /> : <FaSave />} Save</button>
        <button onClick={toggle} disabled={toggling} className={`px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60 ${plan.isActive ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>{toggling ? '…' : plan.isActive ? 'Deactivate' : 'Activate'}</button>
      </div>
    </div>
  );
};

const KenteClubAdminPage = () => {
  const { data: plans = [], isLoading, isError } = useGetAdminMembershipPlansQuery();
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2"><FaCrown className="text-amber-500" /> Kente Club</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Set each tier's price and members-only discount, then activate to let customers join.</p>
      </div>
      {isLoading ? <div className="flex justify-center py-16"><FaSpinner className="animate-spin h-8 w-8 text-primary" /></div>
        : isError ? <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg p-4">Failed to load tiers.</div>
        : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">{plans.map((p) => <TierCard key={p.id} plan={p} />)}</div>}
    </div>
  );
};

export default KenteClubAdminPage;

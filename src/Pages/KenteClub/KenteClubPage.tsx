// FILE LOCATION: src/Pages/KenteClub/KenteClubPage.tsx
// DESCRIPTION: Kente Club membership page (Phase 3, Step 10). Join a tier to get
//   a members-only discount on every order; manage/cancel an active membership.
import { toast } from 'react-toastify';
import { FaCrown, FaSpinner, FaCheck, FaStar } from 'react-icons/fa';
import {
  useGetMembershipTiersQuery, useGetMyMembershipQuery,
  useSubscribeMembershipMutation, useCancelMembershipMutation,
} from '../../slices/kenteClubApiSlice';
import { formatCurrency } from '../../utils/formatCurrency';

const KenteClubPage = () => {
  const { data: tiers = [], isLoading } = useGetMembershipTiersQuery();
  const { data: mine } = useGetMyMembershipQuery();
  const [subscribe, { isLoading: subscribing }] = useSubscribeMembershipMutation();
  const [cancel, { isLoading: cancelling }] = useCancelMembershipMutation();

  const active = mine?.active;

  const join = async (planId: number) => {
    try {
      const res = await subscribe({ planId }).unwrap();
      if (res.authorizationUrl) window.location.href = res.authorizationUrl;
    } catch (e) {
      toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not start checkout');
    }
  };

  const doCancel = async () => {
    if (!window.confirm('Cancel your Kente Club membership? You will keep your benefits until the current period ends.')) return;
    try { await cancel().unwrap(); toast.success('Membership cancelled'); }
    catch (e) { toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not cancel'); }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full mb-3"><FaCrown className="text-2xl text-amber-600" /></div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Kente Club</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-xl mx-auto">
          Join the club for a members-only discount on every order, plus early access to new drops. Cancel anytime.
        </p>
      </div>

      {active && mine?.membership && (
        <div className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/20 dark:to-gray-800 border border-amber-200 dark:border-amber-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FaStar className="text-amber-500" />
            <div>
              <div className="font-semibold text-gray-900 dark:text-white">You're a {mine.membership.planName} member</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {mine.discountPercent}% off every order{mine.membership.status === 'past_due' ? ' · payment issue — please update your card' : ''}
              </div>
            </div>
          </div>
          <button onClick={doCancel} disabled={cancelling} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            {cancelling ? 'Cancelling…' : 'Cancel membership'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><FaSpinner className="animate-spin h-8 w-8 text-amber-600" /></div>
      ) : tiers.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-10 text-center text-gray-500 dark:text-gray-400">Kente Club is opening soon. Check back shortly.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((t) => (
            <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex flex-col">
              <div className="flex items-center gap-2 mb-1"><FaCrown className="text-amber-500" /><h2 className="text-lg font-bold text-gray-900 dark:text-white">{t.name}</h2></div>
              {t.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t.description}</p>}
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(t.price, t.currency)}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">/{t.billingInterval === 'annually' ? 'year' : 'month'}</span>
              </div>
              <ul className="space-y-2 mb-6 flex-1 text-sm text-gray-700 dark:text-gray-300">
                <li className="flex items-center gap-2"><FaCheck className="text-emerald-500" /> <strong>{t.discountPercent}% off</strong> every order</li>
                <li className="flex items-center gap-2"><FaCheck className="text-emerald-500" /> Early access to new drops</li>
                <li className="flex items-center gap-2"><FaCheck className="text-emerald-500" /> Member badge</li>
              </ul>
              <button onClick={() => join(t.id)} disabled={subscribing || active}
                className="w-full flex items-center justify-center gap-2 bg-amber-600 text-white py-3 rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-50">
                {active ? 'Already a member' : subscribing ? 'Redirecting…' : `Join ${t.name}`}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default KenteClubPage;

// Pages/Vendor/VendorReferrals.tsx
// Sellers are ambassadors too (REFERRAL_SYSTEM_DESIGN.md R1): a seller who
// brings a NEW customer to the platform earns the referral reward on that
// customer's purchases — including purchases from the seller's own store.
// The reward is paid by the platform out of its commission, so it never
// reduces the seller's normal payout. Links carry ?ref=CODE; the server keeps
// attribution (the client never sends a referrer id).
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaCopy, FaGift, FaSpinner, FaStore } from 'react-icons/fa';
import { useGetMyReferralsQuery } from '../../slices/referralsApiSlice';

const money = (v: number) => `GH₵${(Number(v) || 0).toFixed(2)}`;

const VendorReferrals = ({ storeSlug }: { storeSlug?: string | null }) => {
  const { data, isLoading, isError } = useGetMyReferralsQuery();
  if (isLoading) return <div className="py-10 flex justify-center"><FaSpinner className="animate-spin text-2xl text-primary" /></div>;
  if (isError || !data) return <p className="text-gray-600 dark:text-gray-300">Could not load your referral link.</p>;

  const origin = data.link.replace(/\/\?ref=.*$/, '');
  const storeLink = storeSlug ? `${origin}/store/${encodeURIComponent(storeSlug)}?ref=${data.code}` : null;
  const pending = data.commissions
    .filter((c) => c.status === 'pending' || c.status === 'under_review')
    .reduce((s, c) => s + c.amount, 0);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copied');
    } catch {
      toast.info(text);
    }
  };
  const rateText = data.rate !== null ? `${(data.rate * 100).toFixed(2).replace(/\.?0+$/, '')}%` : 'a reward';

  const LinkRow = ({ label, value }: { label: string; value: string }) => (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input readOnly aria-label={label} value={value} className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white text-sm" />
        <button onClick={() => copy(value)} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:opacity-90"><FaCopy /> Copy</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FaGift className="text-primary" /> Refer Customers</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Bring your customers to Kente Market with your link. When a new customer signs up through it, you earn {rateText} of
          the product price on their paid, completed orders for {data.windowDays === 365 ? '1 year' : `${data.windowDays} days`} —
          including orders from your own store. The reward is paid by the platform from its commission; your sale payout is not reduced.
        </p>
        {!data.enabled && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">The referral programme is not active yet. Your links will start earning once it is.</p>}
        {data.suspended && <p className="mt-2 text-sm text-red-700 dark:text-red-300">Your referral account is suspended. Contact support.</p>}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 space-y-4">
        {storeLink && <LinkRow label="Your store, with your referral code" value={storeLink} />}
        <LinkRow label="Kente Market home page, with your referral code" value={data.link} />
        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <FaStore /> Ask customers to open the link and sign up on <strong>their own phone</strong> — sign-ups made on a device you use are not credited (this protects against self-referral).
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([['Customers signed up', String(data.referredCount)], ['Available', money(data.wallet.balance)], ['Pending', money(pending)], ['Total earned', money(data.wallet.totalEarned)]] as const).map(([label, v]) => (
          <div key={label} className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{v}</p>
          </div>
        ))}
      </div>

      <Link to="/referrals" className="inline-block px-4 py-2 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-sm">
        Withdraw, history and payout account
      </Link>
    </div>
  );
};

export default VendorReferrals;

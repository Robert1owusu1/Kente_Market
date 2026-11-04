// FILE LOCATION: src/Pages/Referrals/CreatorApplicationCard.tsx
// DESCRIPTION: Self-service "Become a Creator" application (Phase 3, Step 6).
//   Approved creators earn a higher, negotiated rate on sales they drive. This
//   sits on the Refer & Earn page and feeds the admin review queue.
import { useState } from 'react';
import { toast } from 'react-toastify';
import { FaStar, FaSpinner, FaCheckCircle, FaClock } from 'react-icons/fa';
import {
  useGetMyCreatorApplicationQuery,
  useApplyAsCreatorMutation,
} from '../../slices/referralsApiSlice';

const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'X / Twitter', 'WhatsApp'];

// `isCreator` = the user is already an approved creator (super ambassador tier).
const CreatorApplicationCard = ({ isCreator, rate }: { isCreator: boolean; rate: number | null }) => {
  const { data } = useGetMyCreatorApplicationQuery();
  const [apply, { isLoading }] = useApplyAsCreatorMutation();
  const app = data?.application;

  const [platforms, setPlatforms] = useState<string[]>([]);
  const [audienceSize, setAudienceSize] = useState('');
  const [niche, setNiche] = useState('');
  const [pitch, setPitch] = useState('');

  const togglePlatform = (p: string) =>
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const submit = async () => {
    if (platforms.length === 0 && !pitch.trim()) {
      toast.error('Tell us where you create and why you want to promote Bonwire');
      return;
    }
    try {
      await apply({
        platforms,
        audienceSize: audienceSize ? Number(audienceSize) : undefined,
        niche: niche || undefined,
        pitch: pitch || undefined,
      }).unwrap();
      toast.success('Application submitted! We will be in touch.');
    } catch (e) {
      const err = e as { data?: { message?: string } } | undefined;
      toast.error(err?.data?.message || 'Could not submit application');
    }
  };

  // Already a creator.
  if (isCreator) {
    return (
      <div className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/20 dark:to-gray-800 rounded-xl shadow-md p-5 border border-amber-200 dark:border-amber-800">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <FaStar className="text-amber-500" /> You're a Bonwire Creator
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          You earn {rate != null ? `${(rate * 100).toFixed(2).replace(/\.?0+$/, '')}%` : 'your creator rate'} on sales you
          drive. Share your link above everywhere your audience is.
        </p>
      </div>
    );
  }

  // Pending review.
  if (app && app.status === 'pending') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 border border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <FaClock className="text-amber-500" /> Creator application under review
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Thanks! Our team is reviewing your application. You'll be notified once it's approved.
        </p>
      </div>
    );
  }

  // Not a creator — show the form (also covers a rejected re-application).
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 border border-gray-100 dark:border-gray-700">
      <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <FaStar className="text-amber-500" /> Become a Bonwire Creator
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 mb-4">
        Have an audience? Apply to earn a higher commission on every sale you drive — paid from our platform fee, not the weaver's.
      </p>

      {app && app.status === 'rejected' && app.reviewNote && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">Previous application not approved: {app.reviewNote}</p>
      )}

      <div className="space-y-4">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Where do you create?</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" onClick={() => togglePlatform(p)}
                className={`text-xs px-3 py-1.5 rounded-full border ${
                  platforms.includes(p) ? 'bg-primary/10 border-primary text-primary'
                                        : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Total audience size
            <input type="number" min="0" value={audienceSize} onChange={(e) => setAudienceSize(e.target.value)}
              placeholder="e.g. 12000"
              className="block mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            Your niche
            <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. African fashion"
              className="block mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </label>
        </div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block">
          Why do you want to promote Bonwire Kente?
          <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} rows={3}
            className="block mt-1 w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
        </label>
        <button onClick={submit} disabled={isLoading}
          className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-60">
          {isLoading ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
          {app && app.status === 'rejected' ? 'Re-apply' : 'Apply to be a creator'}
        </button>
      </div>
    </div>
  );
};

export default CreatorApplicationCard;

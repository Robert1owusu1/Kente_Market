// FILE LOCATION: src/Pages/AllProducts/GroupBuyProgress.tsx
// DESCRIPTION: Group-buy campaign progress on the product page (follow-up).
//   Shows pledged-vs-target and the deadline; refund-if-missed is explained.
import { FaUsers } from 'react-icons/fa';
import { useGetGroupBuyStatusQuery } from '../../slices/productsApiSlice';

const GroupBuyProgress = ({ productId }: { productId: number | string }) => {
  const { data } = useGetGroupBuyStatusQuery(productId);
  if (!data || !('target' in data)) return null;

  const pct = data.target > 0 ? Math.min(100, Math.round((data.committed / data.target) * 100)) : 0;
  const resolved = data.status === 'succeeded' || data.status === 'failed';
  const deadline = new Date(data.deadline).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="mb-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3">
      <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300 flex items-center gap-2">
        <FaUsers /> Group buy
        {data.status === 'succeeded' && <span className="text-emerald-600 dark:text-emerald-400">· funded 🎉</span>}
        {data.status === 'failed' && <span className="text-gray-500">· didn’t reach target</span>}
      </p>
      <div className="mt-2 h-2.5 w-full rounded-full bg-indigo-100 dark:bg-indigo-950 overflow-hidden">
        <div className="h-full bg-indigo-600" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-1.5">
        {data.committed} of {data.target} pledged{data.remaining > 0 ? ` · ${data.remaining} to go` : ''}
        {!resolved && ` · ends ${deadline}`}
      </p>
      {!resolved && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          You pay now and are automatically refunded if the target isn’t reached by the deadline.
        </p>
      )}
    </div>
  );
};

export default GroupBuyProgress;

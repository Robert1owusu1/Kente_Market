// FILE LOCATION: src/Pages/Vendor/FeatureProductButton.tsx
// DESCRIPTION: Vendor action to pay to feature a product (Phase 3, Step 8).
//   Only shows when featured listings are enabled. Requires the vendor's plan
//   to include featured eligibility (enforced server-side; a 403 is surfaced).
import { toast } from 'react-toastify';
import { FaStar, FaSpinner } from 'react-icons/fa';
import {
  useGetFeaturedConfigQuery, useCreateFeaturedPurchaseMutation,
} from '../../slices/featuredApiSlice';

const FeatureProductButton = ({ productId, isFeatured }: { productId: number; isFeatured?: boolean }) => {
  const { data: config } = useGetFeaturedConfigQuery();
  const [purchase, { isLoading }] = useCreateFeaturedPurchaseMutation();

  if (!config?.enabled || !(config.pricePerDay > 0)) return null;

  const onClick = async () => {
    const input = window.prompt(
      `Feature this product for how many days? (1–${config.maxDays})\nPrice: GHS ${config.pricePerDay.toFixed(2)} per day.`,
      '7'
    );
    if (input === null) return;
    const days = Math.floor(Number(input));
    if (!Number.isInteger(days) || days < 1 || days > config.maxDays) {
      toast.error(`Enter a number of days between 1 and ${config.maxDays}`);
      return;
    }
    if (!window.confirm(`Feature for ${days} day(s) = GHS ${(config.pricePerDay * days).toFixed(2)}. Continue to payment?`)) return;
    try {
      const res = await purchase({ productId, days }).unwrap();
      if (res.authorizationUrl) window.location.href = res.authorizationUrl;
    } catch (e) {
      toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not start featured payment');
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={`p-2 rounded-lg ${isFeatured ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'}`}
      title={isFeatured ? 'Featured — extend' : 'Feature this product'}
    >
      {isLoading ? <FaSpinner className="animate-spin" /> : <FaStar />}
    </button>
  );
};

export default FeatureProductButton;

import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import type { RootState } from '../store';
import {
  useGetMyWishlistQuery,
  useAddToWishlistMutation,
  useRemoveFromWishlistMutation,
} from '../slices/wishlistApiSlice';

type ApiError = { status?: number | string; data?: { message?: string } };

/**
 * Wishlist state + toggle for product cards and the product page.
 * One cached GET /api/wishlist (skipped for guests) answers "is this saved?"
 * for every card on the page, so the heart can show its real state and a
 * second tap removes the item. Guests get a log-in nudge instead of a 401.
 */
export const useWishlistToggle = () => {
  const userInfo = useSelector((state: RootState) => state.auth?.userInfo);
  const { data: items } = useGetMyWishlistQuery(undefined, { skip: !userInfo });
  const [addToWishlist, { isLoading: adding }] = useAddToWishlistMutation();
  const [removeFromWishlist, { isLoading: removing }] = useRemoveFromWishlistMutation();

  const savedIds = new Set((items || []).map((i) => String(i.productId)));
  const isSaved = (productId: number | string) => savedIds.has(String(productId));

  const toggle = async (productId: number | string) => {
    if (!userInfo) {
      toast.info('Please log in to save favourites');
      return;
    }
    if (adding || removing) return;
    try {
      if (isSaved(productId)) {
        await removeFromWishlist(productId).unwrap();
        toast.success('Removed from your wishlist');
      } else {
        await addToWishlist({ productId }).unwrap();
        toast.success('Saved to your wishlist');
      }
    } catch (err) {
      const e = err as ApiError;
      if (e?.status === 401 || e?.status === '401') toast.info('Please log in to save favourites');
      else toast.error(e?.data?.message || 'Could not update your wishlist');
    }
  };

  return { isSaved, toggle };
};

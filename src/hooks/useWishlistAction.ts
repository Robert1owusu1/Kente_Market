import { toast } from 'react-toastify';
import { useAddToWishlistMutation } from '../slices/wishlistApiSlice';

type ApiError = { status?: number | string; data?: { message?: string } };

/**
 * Save a product to the signed-in user's wishlist with user feedback.
 * The backend insert is INSERT IGNORE, so repeated taps are idempotent and
 * a guest gets a friendly nudge instead of a raw 401.
 */
export const useWishlistAction = () => {
  const [addToWishlist] = useAddToWishlistMutation();

  const saveToFavorites = async (productId: number | string | undefined) => {
    if (productId === undefined || productId === null || productId === '') {
      toast.error('This product cannot be saved');
      return;
    }
    try {
      await addToWishlist({ productId }).unwrap();
      toast.success('Saved to your wishlist');
    } catch (err) {
      const e = err as ApiError;
      if (e?.status === 401 || e?.status === '401') {
        toast.info('Please log in to save favorites');
      } else {
        toast.error(e?.data?.message || 'Could not save to your wishlist');
      }
    }
  };

  return saveToFavorites;
};

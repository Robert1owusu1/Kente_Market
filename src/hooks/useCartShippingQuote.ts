import { useMemo } from 'react';
import { useGetShippingQuoteQuery } from '../slices/shippingFeesApiSlice';

type CartLineLike = { id?: unknown; product?: unknown; productId?: unknown; quantity?: unknown };

/**
 * The delivery fee the server will charge for this cart (each seller's parcel
 * at that seller's fee, or the platform default). `shipping` is null while the
 * quote loads or if it fails; callers show their own estimate meanwhile.
 */
export const useCartShippingQuote = (cartItems: CartLineLike[], countryCode = 'GH', region?: string, enabled = true) => {
  const items = useMemo(
    () => cartItems
      .map((i) => ({ productId: (i.id ?? i.product ?? i.productId) as number | string, qty: Number(i.quantity) || 1 }))
      .filter((i) => i.productId !== undefined && i.productId !== null && i.productId !== ''),
    [cartItems],
  );
  const { data, isFetching } = useGetShippingQuoteQuery(
    { countryCode, region, items },
    { skip: !enabled || items.length === 0 },
  );
  return {
    supported: data?.supported ?? null,
    message: data?.message,
    shipping: typeof data?.chargeableShippingGHS === 'number' ? data.chargeableShippingGHS : null,
    groups: data?.shippingGroups ?? [],
    loading: isFetching,
  };
};

// utils/productDisplay.ts — pure display helpers for product cards (kept out
// of the component file: react-refresh/only-export-components).

export interface ProductCardData {
  id: number | string;
  title?: string;
  name?: string;
  img?: string;
  image?: string;
  price: number | string;
  originalPrice?: number | string | null;
  original_price?: number | string | null;
  rating?: number | string | null;
  reviews?: number | string | null;
  stock?: number | string | null;
  in_stock?: number | string | null;
  vendorBusinessName?: string | null;
  vendorStatus?: string | null;
  madeToOrder?: boolean | number | null;
  isRentable?: boolean | number | null;
}

/** Units on hand, or null when the API did not say. */
export const stockOnHand = (p: ProductCardData): number | null => {
  const raw = p.in_stock ?? p.stock;
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Sale price only when the original is a real number strictly above price. */
export const saleInfo = (p: ProductCardData): { original: number; percentOff: number } | null => {
  const price = Number(p.price);
  const original = Number(p.originalPrice ?? p.original_price);
  if (!Number.isFinite(price) || !Number.isFinite(original) || original <= price || price <= 0) return null;
  return { original, percentOff: Math.round(((original - price) / original) * 100) };
};

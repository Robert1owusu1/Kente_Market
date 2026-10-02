// utils/cartMapping.ts — pure cart shape helpers (split out of
// Context/CartContext.tsx: react-refresh/only-export-components forbids
// function exports alongside components).
import type { CartItem } from '../Context/CartContext';

export const normalizeColors = (item: CartItem): CartItem => {
  if (Array.isArray(item.colors) && item.colors.length > 0) return item;
  // Prefer the confirmed selection; fall back to the first available option.
  // ("default" is a placeholder some card payloads pass when a product has no
  // color options — never surface it as an order color.)
  const picked =
    item.selectedColor && item.selectedColor !== "default"
      ? item.selectedColor
      : item.colorsAvailable?.[0];
  if (picked) return { ...item, colors: [picked] };
  return { ...item, colors: item.colors ?? [] };
};

// Server cart lines (backend/routes/cartRoutes.js sanitizeItems) use
// {product, name, qty, image}; the client uses {id, title, quantity, img}.
// Remap them on load — without this a cart restored from the server has
// `quantity: undefined`, so every count/total renders "NaN" and checkout
// validation misreads the line.
export const remapServerLine = (item: CartItem): CartItem => {
  const raw = item as unknown as Record<string, unknown>;
  // Already client-shaped (id + quantity present) — nothing to do.
  if (raw.id !== undefined && raw.quantity !== undefined) return item;
  if (raw.product === undefined && raw.qty === undefined) return item;
  return {
    ...item,
    id: (raw.product ?? raw.id) as number | string,
    title: (raw.name ?? raw.title ?? "") as string,
    img: (raw.image ?? raw.img) as string | undefined,
    price: Number(raw.price) || 0,
    quantity: Math.max(1, Number(raw.qty ?? raw.quantity) || 1),
    selectedColor: (raw.selectedColor ?? raw.color ?? null) as string | null,
    selectedSize: (raw.selectedSize ?? raw.size ?? null) as string | null,
  };
};

export const migrateCartItem = (item: CartItem): CartItem => {
  let next = remapServerLine(item);
  if (next.yards === undefined && (next.selectedSize || next.size)) {
    next = { ...next, yards: next.selectedSize || next.size };
  }
  return normalizeColors(next);
};

// utils/cartItem.ts
// The one shape a catalog product takes when it goes into the cart. Shared by
// the product page and the AI try-on result so "Add to Cart" from either place
// adds the identical item.
import type { CartPayload } from "../Context/CartContext";
import type { Product } from "../types/domain";
import { yardOptionsFor } from "./yards";

export const toCartItem = (product: Product, yards: string, quantity: number): CartPayload => ({
  ...product,
  // Strip variant choices: the buyer's only decision is the yardage.
  colors: [],
  colorsAvailable: [],
  sizes: [],
  yards,
  yardsAvailable: yardOptionsFor(product),
  threadTypes: product.threadTypes,
  dominantThread: product.dominantThread,
  quantity,
});

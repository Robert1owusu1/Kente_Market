// utils/cartItem.ts
// The one shape a catalog product takes when it goes into the cart. Shared by
// the product page and the AI try-on result so "Add to Cart" from either place
// adds the identical item.
import type { CartPayload } from "../Context/CartContext";
import type { Product } from "../types/domain";
import { pieceYards } from "./yards";

export const toCartItem = (product: Product, quantity: number): CartPayload => ({
  ...product,
  // Kente is sold as the seller's packaged piece: the buyer's only decision
  // is how many. No colour, size or length is chosen; `yards` is the piece
  // length the seller set, carried for display.
  colors: [],
  colorsAvailable: [],
  sizes: [],
  yards: pieceYards(product),
  yardsAvailable: [],
  threadTypes: product.threadTypes,
  dominantThread: product.dominantThread,
  quantity,
});

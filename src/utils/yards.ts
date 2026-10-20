// Kente is sold as the seller's packaged PIECE — commonly 6 yards for one
// price — like GTP wax print: the buyer chooses only how many pieces, never a
// length, colour or size. `product.yards` is the piece length the seller set
// (shown to the buyer as information). A different length is a custom order,
// where yardage IS chosen, in even lengths (DEFAULT_EVEN_YARDS).
//
// Legacy rows stored a list of lengths in `yardsAvailable`/`sizes`; those are
// no longer read or offered as choices.

/** Even lengths a buyer can request in a custom order. */
export const DEFAULT_EVEN_YARDS = ["2", "4", "6", "8", "10", "12"];

/** The length of one piece in yards as the seller set it, or null if unknown. */
export const pieceYards = (product: { yards?: unknown } | null | undefined): number | null => {
  const n = Number(product?.yards);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "6 yards" — or null when the seller has not set a length. */
export const pieceLengthLabel = (product: { yards?: unknown } | null | undefined): string | null => {
  const n = pieceYards(product);
  return n === null ? null : `${n} ${n === 1 ? "yard" : "yards"}`;
};

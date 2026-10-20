// FILE LOCATION: backend/utils/yards.js
// DESCRIPTION: Kente is sold by the yard in EVEN lengths only (2, 4, 6, 8, …).
//   Legacy product rows stored clothing sizes ("S"/"M"/"L") in `sizes`; those
//   are never valid yardage. Shared by the admin and vendor product write
//   paths so a bypassed frontend can't sneak odd/non-numeric sizes in.

/**
 * True when `sizes` is an array containing a value that is not a positive,
 * even integer (i.e. invalid kente yardage). Non-arrays are left alone so
 * legacy string payloads keep their existing behaviour.
 */
export const hasInvalidYards = (sizes) =>
  Array.isArray(sizes) &&
  sizes.some((s) => {
    const n = Number(s);
    return !Number.isInteger(n) || n <= 0 || n % 2 !== 0;
  });

export const INVALID_YARDS_MESSAGE =
  'Available yards must be even numbers (e.g. 2, 4, 6, 8, 10, 12)';

// Kente is sold as the seller's packaged piece — commonly 6 yards for one
// price — and the buyer chooses only how many pieces. `product.yards` is that
// piece length (information for the buyer, not a choice); `sizes` is legacy.

export const MAX_PIECE_YARDS = 100;

/** Error message for an invalid piece length, or null (absent is allowed). */
export const pieceLengthError = (yards) => {
  if (yards === undefined || yards === null || yards === '') return null;
  const n = Number(yards);
  return Number.isFinite(n) && n > 0 && n <= MAX_PIECE_YARDS
    ? null
    : `Length per piece must be more than 0 and at most ${MAX_PIECE_YARDS} yards (e.g. 6)`;
};

const nonEmptyList = (v) => Array.isArray(v) && v.some((x) => String(x ?? '').trim() !== '');

/**
 * What a seller must tell buyers about a Kente piece: a description, its
 * dominant colours and its thread. On create every one is required; on
 * update (`partial`) only the fields being changed are checked, so they
 * cannot be blanked.
 * @returns {string|null}
 */
export const kenteDetailsError = (body, { partial = false } = {}) => {
  const has = (k) => body[k] !== undefined;
  if ((!partial || has('description')) && !(typeof body.description === 'string' && body.description.trim())) {
    return 'Add a description of the piece';
  }
  if ((!partial || has('colors')) && !nonEmptyList(body.colors)) {
    return 'List the dominant colours of the piece';
  }
  if ((!partial || has('threadTypes')) && !nonEmptyList(body.threadTypes)) {
    return 'List the thread the piece is woven with';
  }
  return null;
};

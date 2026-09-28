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

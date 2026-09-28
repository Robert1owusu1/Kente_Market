// Kente cloth is sold by the yard in EVEN lengths only: 2, 4, 6, 8, 10, 12, …
// Buyers never choose a colour or a clothing size — the cloth is pre-designed —
// so yardage is the single variant they pick. Legacy rows sometimes stored
// clothing sizes ("S", "M", "L", "One Size") in `sizes`; buyer-facing flows
// must never surface those as yardage.

/** The standard ladder every cloth offers when the product row has no (valid) yard data. */
export const DEFAULT_EVEN_YARDS = ["2", "4", "6", "8", "10", "12"];

const isEvenYard = (value: string): boolean => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n % 2 === 0;
};

/** Keep only positive, even-integer yard values from any field shape (array, CSV string, single value). */
export const evenYardsFrom = (value: unknown): string[] => {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(",")
      : value === undefined || value === null
        ? []
        : [value];
  return [
    ...new Set(
      list
        .map((v) => String(v).trim())
        .filter((v) => v !== "" && isEvenYard(v))
    ),
  ];
};

/** Yard options for a product: its own even yards (`yardsAvailable` or `sizes`), else the standard ladder. */
export const yardOptionsFor = (
  product: { yardsAvailable?: unknown; sizes?: unknown } | null | undefined
): string[] => {
  const fromYards = evenYardsFrom(product?.yardsAvailable);
  if (fromYards.length > 0) return fromYards;
  const fromSizes = evenYardsFrom(product?.sizes);
  if (fromSizes.length > 0) return fromSizes;
  return DEFAULT_EVEN_YARDS;
};

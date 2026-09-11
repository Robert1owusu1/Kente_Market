// utils/imageUrl.ts
// Resolves asset URLs stored as relative paths (/uploads/...) to absolute URLs.
// The frontend (Vercel) and API (Render) are hosted on different origins, so a
// relative "/uploads/x.jpg" would resolve against the frontend origin and 404.
import { Base_URL } from "../constant";

export const resolveImageUrl = (src?: string | null): string | undefined => {
  if (!src) return undefined;
  const trimmed = src.trim();
  if (!trimmed) return undefined;
  // Already absolute (http/https), a data: URI, or a fragment — leave as-is.
  if (/^(https?:)?\/\//i.test(trimmed) || /^data:/i.test(trimmed) || trimmed.startsWith("#")) {
    return trimmed;
  }
  // Same-origin static assets resolved via the API origin when one is configured.
  if (trimmed.startsWith("/uploads/") && Base_URL) {
    return `${Base_URL}${trimmed}`;
  }
  if (trimmed.startsWith("/images/") && Base_URL) {
    return `${Base_URL}${trimmed}`;
  }
  return trimmed;
};
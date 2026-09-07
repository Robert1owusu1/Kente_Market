export const sanitizeString = (str: unknown): string => {
  if (!str) return '';
  return String(str).trim();
};

export const sanitizeInput = (input: unknown): string => {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/<[^>]*>/g, '').substring(0, 255);
};

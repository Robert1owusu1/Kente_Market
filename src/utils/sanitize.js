export const sanitizeString = (str) => {
  if (!str) return '';
  return String(str).trim();
};

export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/<[^>]*>/g, '').substring(0, 255);
};

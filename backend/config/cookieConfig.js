// config/cookieConfig.js
// Cookie SameSite setting. Default is 'lax' (recommended for single-origin and
// still CSRF-resistant). When the frontend and API run on DIFFERENT origins
// (e.g. Vercel SPA + Render API), browsers will NOT attach cookies to cross-site
// fetch() calls unless SameSite=None (and Secure), so login/OAuth would silently
// break. Set COOKIE_SAME_SITE=none for that topology.
const SAME_SITE_VALUES = new Set(['lax', 'strict', 'none']);

export const cookieSameSite = () => {
  const value = (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase();
  return SAME_SITE_VALUES.has(value) ? value : 'lax';
};
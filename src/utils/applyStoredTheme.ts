// utils/applyStoredTheme.ts — imported FIRST by main.tsx.
//
// index.html used to hard-code <html class="dark">, and the saved theme was
// only applied after React mounted the navbar. Every light-theme visitor (the
// default) therefore started each page load in dark mode and then faded to
// light (all colours transition over 200ms) — a flash of wrong colours, and
// near-white text on white panels while it lasted. Applying the saved theme
// before the first render removes the flash. (An inline <script> in
// index.html would be blocked by the production CSP, script-src 'self'.)
try {
  const dark = localStorage.getItem("theme") === "dark";
  document.documentElement.classList.toggle("dark", dark);
} catch {
  document.documentElement.classList.remove("dark");
}

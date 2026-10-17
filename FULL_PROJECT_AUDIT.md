# Full Project Audit — UI/UX, responsiveness, accessibility, functional (2026-10-14)

Earlier security, payment and data-integrity audits remain authoritative and
unchanged: `SECURITY_FINDINGS.md`, `LOCAL_SECURITY_AND_BUG_TRACKER.md`,
`PRODUCTION_READINESS_TRACKER.md`, `FINAL_PRODUCTION_READINESS_REPORT.md`,
`LIVE_PENTEST_REPORT.md`, the AI try-on reports. This audit adds the
front-end, responsive and accessibility view, plus the functional bugs found
along the way. Fixes and status: `BUG_FIX_TRACKER.md`.

## 1. Method

**Repository inspection.** Git state captured before any edit (full diff and a
tarball of untracked files saved outside the repo), so this pass's changes
are separable from earlier uncommitted work; that earlier work (AI try-on)
was preserved. Read: README, existing reports and trackers, `src/App.tsx`
route table (46 routes), shared components, `src/index.css` theme, product /
cart / checkout / order flows, the server cart route.

**Stack actually used.** React 19 + Vite + Tailwind v4 (v3-compatible theme
layer), RTK Query + a Cart context, react-router, react-slick, AOS,
react-toastify; Express + mysql2 (MySQL/TiDB), Paystack, Sentry (optional).

**Runtime evidence.** A disposable stack on this machine: MySQL 8.4 on
127.0.0.1:33717 (data in the session scratchpad), the API with every
`backend/.env` value shadowed by placeholders (dotenv `injected env (0)`),
outbound HTTP blocked, mock AI provider, and a production `vite build`
served by `vite preview`. Seeded: a customer, two approved vendors, an admin,
12 products (sale, sold out, low stock, very long title, pending, non-wearable).
No production or shared database, no Paystack call, no paid AI call.

**Crawler.** Headless Chrome 153 (Playwright 1.60) visited **39 routes** —
26 as a guest, 10 as a customer, 1 as a vendor, 2 as an admin — at the **9
required viewports** (320×568 … 1440×900): 351 page loads per run. Per page
it recorded:
- elements extending past the viewport. `body { overflow-x: hidden }` masks
  page scroll, so overflow is measured per element; content inside an
  intentional horizontal scroller is excluded;
- interactive elements smaller than 24×24 CSS px (WCAG 2.5.8);
- console errors, page errors, API responses ≥ 400;
- axe-core 4.10.2 WCAG 2.0/2.1/2.2 A+AA violations (at 375 and 1280);
- full-page screenshots at 375, 768, 1280.

Runs: **baseline** (code before this pass), **after** (first fixes), **after2**
(final). Comparison in `MOBILE_RESPONSIVENESS_REPORT.md` and
`ACCESSIBILITY_REPORT.md`.

## 2. Findings summary

| Category | Confirmed | Fixed | Open |
|---|---|---|---|
| Functional bugs (B-*) | 17 | 17 | 0 (D-1…D-3 need decisions) |
| Accessibility defects (A-*) | 8 groups | 8 (A-06 partly; see R-1) | R-1, R-2 |
| Mobile layout (part of B-*) | 5 | 5 | — |
| Remaining structural items (R-*) | 5 | — | 5 |

No P0 (security, payment, data integrity) and no P1 (blocks shopping or
paying) issues were found in this pass. The money paths had already been
hardened and tested (995 backend tests). The worst issues were P2.

## 3. Findings (evidence → root cause)

Every row has reproduction evidence from the crawler, a screenshot, or a
failing test against the old code. IDs match `BUG_FIX_TRACKER.md`.

### Product discovery
- **B-01 Product page unreachable from grids on touch screens.** Evidence: the
  card's only link to `/product/:id` was an eye icon in an `opacity-0
  group-hover:opacity-100` overlay; the title and image were not links (axe
  `link-name`, 11 nodes; `button-name`, 12 nodes on `/products`). Repro: open
  `/products` on a phone, try to open a product. Root cause: three hand-copied
  cards (`AllProducts`, `TopProducts`, `Products`).
- **B-02 Sold-out items addable.** `/product/5` (stock 0): the card shows "Sold
  out", yet its full-width Add to Cart is enabled. Root cause: only the hover
  icon checked stock.
- **B-03 Fabricated details.** "Cotton", "3-5 days" and "1 days" on every card
  without that data; "#1/#2/#3 Best Seller" assigned by list index; "Top
  Selling Kente Cloth For You" and "Top Products for you" on lists ordered by
  `featured` / rating (`Product.findFeatured` / `findTrending`), never sales.
- **B-04 Wrong sale badge.** `(originalPrice as number) > (price as number)`
  on strings returned by the API — `"900.00" > "1500.00"` is true.
- **B-05 Missing cart image from the trending strip.** The handler wrote
  `image`; the cart renders `img`.

### Cart and checkout
- **B-06 (CART-1) Server cart dropped images.** `sanitizeItems` read only
  `item.image`; a cart restored on another device had no thumbnails
  (reproduced in the browser walkthrough; the stored JSON had `"image": null`).
- **B-07 No add-to-cart feedback** on any entry point.
- **B-08 `/cart` overflowed at 320/360px.** Crawler: item list and summary
  right edge 375px at a 320px viewport; screenshot shows Remove and totals
  clipped. Root cause: `grid gap-6 lg:grid-cols-3` with no mobile column
  definition → implicit track sized to min-content (359px). A second cause (a
  non-wrapping quantity/subtotal/remove row) surfaced in the first re-crawl.
- **B-16 Checkout direct-URL path omitted yards** (cart → checkout, the normal
  path, was correct). The backend accepts `yards = NULL` (decision D-1).
- Not a defect: `priceRange` initialises to 0–1000 but an effect resets it to
  the real min/max on load. Payment buttons are guarded by `isProcessing`;
  payment verification is server-side (unchanged).

### Layout (signed-in, small phones)
- **B-09** header row 351px wide at 320 (menu button clipped).
- **B-10** `/certificates` Check button at x=417 for widths ≤ 390 (`flex-1`
  input without `min-w-0`). Same pattern in two admin colour inputs.
- **B-11** `/profile` mobile header: long email pushed the menu button out.

### Accessibility (baseline axe, 375 + 1280 snapshots)
| Rule | Impact | Nodes | Pages | Cause |
|---|---|---|---|---|
| aria-prohibited-attr | serious | 292 | 37 | footer `aria-label` on `<span>` (unconfigured social links), on every page |
| color-contrast | serious | 341 | 39 | brand amber as text on white (1.9:1); white on amber (1.9–2.6:1); amber-600/yellow-500 text |
| button-name | critical | 24 | 1 | icon-only card buttons |
| link-name | serious | 22 | 1 | icon-only card links |
| listitem | serious | 30 | 3 | slick dots in a `<div>`; legal pages' bare `<li>` |
| aria-hidden-focus | serious | 8 | 1 | links focusable inside hidden hero slides |
| select-name / label | critical | 6 | 2 | unlabelled sort/filter/payout controls |
| scrollable-region-focusable | serious | 4 | 2 | legal read-to-accept panel not keyboard-scrollable |

Code-level findings axe does not cover:
- five `<h1>` on the homepage (one per slide);
- the autoplaying hero had no pause control (WCAG 2.2.2);
- the mobile menu toggle had no `aria-expanded` and removed its focus outline;
- no global `:focus-visible` style;
- `prefers-reduced-motion` was ignored by the global `*` transition and by
  hover transforms. AOS already skipped reduced-motion users, which is good
  existing practice.

### Theming
- **Dark-mode flash on every load (pre-existing).** `index.html` hard-coded
  `<html class="dark">`; the saved theme was applied only after React mounted
  the navbar. Measured: body text was `rgb(229,231,235)` (dark-mode grey) when
  content appeared and `rgb(31,41,55)` two seconds later. Light-theme users
  (the default) saw a fade from dark colours on every navigation load. Fixed
  in `utils/applyStoredTheme.ts`. A fix as an inline script would be blocked
  by the production CSP. This also means the **baseline contrast numbers
  include some readings taken mid-fade**.

### Code health
- Debug `console.log` of the full product array on every `/products` load;
  "Showing N products" debug text on the homepage.
- 6 empty `.tsx` files; an unused demo catalogue (`allProductsData`, the
  origin of the earlier try-on bug).
- 27 overlay/modal implementations; 5 declare `aria-modal`; no shared focus
  management (R-2).
- No `dangerouslySetInnerHTML` anywhere (good).
- Every focus-outline removal except one (the menu toggle) had a ring
  replacement.

### Verified OK (no defect found)
- No console errors, page errors or failed API calls on any of the 39 routes,
  for any role, in any run.
- Vendor and admin dashboards: no overflow at any viewport; remaining issue is
  contrast only.
- `/vendor/apply` redirects guests to `/login` (intended).
- Checkout pay buttons disable during processing; the server is the
  authority on totals and payment status (unchanged).

## 4. Security notes for this pass
- No authentication, authorisation, payment, refund, payout or tenant-isolation
  code was modified.
- The one backend change, `routes/cartRoutes.js`, *narrows* what is stored:
  an image must be a site-relative path or an http(s) URL. The value is
  display-only and never fetched server-side.
- No new dependency was added to the project (`axe-core` was installed only in
  the session scratchpad for auditing).

## 5. Not covered
- Real Paystack, email and OAuth flows (blocked by design).
- Vendor/admin *workflows* (create product, process orders) were not driven
  end-to-end in the browser this pass. Their pages were crawled for layout,
  errors and accessibility.
- Screen-reader testing with an actual reader (NVDA/VoiceOver) — only
  automated and code-level checks.
- iOS Safari / real devices: Chromium emulation only.

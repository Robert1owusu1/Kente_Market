# Bug Fix Tracker — UI/UX, responsive & accessibility pass (2026-10-14)

Scope: the full-project audit in `FULL_PROJECT_AUDIT.md`. Earlier trackers
(`LOCAL_SECURITY_AND_BUG_TRACKER.md`, `PRODUCTION_READINESS_TRACKER.md`,
`SECURITY_FINDINGS.md`) are unchanged and still authoritative for their items.

Status values: **FIXED (tested)** — regression test added and passing ·
**FIXED (browser-verified)** — layout fix confirmed by the before/after crawl, no
unit test (layout is not observable in jsdom) · **OPEN** · **DECISION** (business call).

Severity: P0 security/payment/data · P1 blocks shopping/paying · P2 significant
usability/correctness · P3 minor.

## Confirmed bugs

| ID | Sev | Where | Defect | Root cause | Fix | Regression test | Status |
|---|---|---|---|---|---|---|---|
| B-01 | P2 | `/products`, homepage Featured + Highly rated grids | No visible way to open a product from a grid on touch screens; the only link was an eye icon in a hover-only overlay | Three copy-pasted card implementations, all with title/image not linked | One shared `components/ProductCard`; image and title link to `/product/:id` | `ProductCard.test.tsx` "title is a visible link" | FIXED (tested) |
| B-02 | P2 | `/products` cards | "Add to Cart" stayed enabled on sold-out products (only the hover icon was disabled) | Bottom button never checked stock | Disabled + "Sold out" label when stock is 0 | `ProductCard.test.tsx` "sold-out product cannot be added" | FIXED (tested) |
| B-03 | P2 | All product grids, homepage | Fabricated information: "Cotton" and "3-5 days"/"1 days" defaults, "#1/#2/#3 Best Seller" badges by list position, "Top Selling Kente Cloth For You", "Top Products for you", "loved … worldwide", generic "Perfect for custom printing" description | Display fallbacks invented values; badges/copy claimed sales data the lists are not ordered by (featured / rating) | Card shows only real fields; section copy says "Featured pieces" / "Highly rated Kente" | `ProductCard.test.tsx` "never invents …" | FIXED (tested) |
| B-04 | P2 | Homepage trending strip | "Save ₵X" badge shown whenever an original price existed, comparing price **strings** (`"900.00" > "1500.00"`) | String comparison, no `original > price` check on the badge | `utils/productDisplay.saleInfo` compares numbers; badge only for real sales | `ProductCard.test.tsx` "saleInfo compares numbers" | FIXED (tested) |
| B-05 | P2 | Homepage trending → cart | Items added from the trending strip had no thumbnail in the cart | Handler wrote `image`, cart renders `img` | All entry points use `utils/cartItem.toCartItem` | `utils/__tests__/cartItem.test.ts` | FIXED (tested) |
| B-06 | P2 | Server cart sync (`routes/cartRoutes.js`) — tracked as CART-1 | Thumbnails vanished when a cart was restored on another device/session | Server read only `item.image`; client lines carry `img` | Accept `image ?? img`, keep only `/path` or http(s) | `backend/tests/cartSanitize.test.js` (fails on old code) | FIXED (tested) |
| B-07 | P2 | Every add-to-cart | No confirmation of add-to-cart (only the navbar count changed; nothing announced to screen readers) | No feedback in `CartContext.addToCart` | Toast (global live region), de-duplicated per product | `Context/__tests__/cartAddFeedback.test.tsx` | FIXED (tested) |
| B-08 | P2 | `/cart` at 320–360px | Remove buttons and right-aligned totals cut off | Grid with no explicit columns on mobile: implicit track sized to min-content (359px) | `grid-cols-1` (minmax(0,1fr)) | before/after crawl (MOBILE_RESPONSIVENESS_REPORT §3) | FIXED (browser-verified) |
| B-09 | P2 | Header, signed-in, 320px | Menu button pushed off-screen | Wordmark `whitespace-nowrap` + action group could not fit | Wordmark visually hidden below 360px (kept for screen readers), action group `shrink-0` | crawl | FIXED (browser-verified) |
| B-10 | P3 | `/certificates` ≤390px; admin Promotions colour inputs | "Check" button off-screen | `flex-1` input without `min-w-0` keeps its intrinsic width | `min-w-0` on the inputs, `shrink-0` button | crawl | FIXED (browser-verified) |
| B-11 | P3 | `/profile` mobile header | Long email pushed the account-menu button off-screen | Truncation container lacked `min-w-0` | `min-w-0 flex-1` + `shrink-0` 44px button | crawl | FIXED (browser-verified) |
| B-12 | P3 | `/products` | Floating "+" button with no action, no label, covering content | Leftover UI | Removed | `ProductCard`/axe crawl (no unnamed buttons) | FIXED (browser-verified) |
| B-13 | P3 | Homepage "View all products" | Button nested in a link; hover overlay covered the label | Invalid nesting + absolutely positioned overlay | Single styled link | crawl | FIXED (browser-verified) |
| B-14 | P3 | Hero slider | CTA `<button>` nested inside `<Link>` (invalid, double tab stop) | — | Styled links | crawl (axe) | FIXED (browser-verified) |
| B-15 | P3 | `/products`, homepage | Debug output: full product array logged to console on every load; "Showing N products" debug line | Leftover debugging | Removed | — | FIXED |
| B-16 | P3 | Checkout opened by direct URL | Order created on that path omitted yards (vendor gets no yardage). Normal cart → checkout path was correct | Fallback payload differed from `CartPage` | Same variant fields as the cart page | not unit-tested (1,800-line page); see D-1 | FIXED |
| B-17 | P3 | Repository | 6 empty `.tsx` files and the unused demo catalogue (`allProductsData`, origin of the earlier try-on bug) | Dead code | Deleted (tracked; recoverable from git) | typecheck/build | FIXED |

## Accessibility defects (detail in `ACCESSIBILITY_REPORT.md`)

| ID | Impact | Fixed |
|---|---|---|
| A-01 | critical — unnamed icon buttons/links on product cards | ✅ |
| A-02 | critical — unlabelled selects/inputs (`/products`, `/referrals`, `/certificates`) | ✅ |
| A-03 | serious — hero slider: focusable hidden slides, inoperable dots, no pause, 5 `<h1>` | ✅ |
| A-04 | serious — footer `aria-label` on `<span>` (every page) | ✅ |
| A-05 | serious — legal pages: bare `<li>`, unfocusable scroll region (blocked keyboard users from the read-to-accept gate) | ✅ |
| A-06 | serious — colour contrast in the shopping journey | ✅ partial (see R-1) |
| A-07 | mobile menu toggle: no `aria-expanded`, focus outline removed | ✅ |
| A-08 | no global visible focus style; reduced-motion ignored by transitions | ✅ |

## Open / remaining

| ID | Sev | Item | Why open |
|---|---|---|---|
| R-1 | P2 | Brand amber used as text (`text-primary`, 159 uses in 46 files) and white text on amber (~90) still fail AA outside the fixed journey (dashboards, account pages) | Global override would darken amber on the dark footer and break it; needs per-component pass |
| R-2 | P2 | 27 overlay/modal implementations, 5 with `aria-modal`; no shared focus trap | Needs a shared `Modal` and migration of 27 call sites |
| R-3 | P3 | `/products` puts two hero blocks before the first product (mobile: products start ~1.5 screens down) | Design change, not done this pass |
| R-4 | — | `product.gallery` stored by the API but no UI to set or show it | Missing feature, not a bug |
| R-5 | P3 | Unknown stock: listing treated as sold out, details as in stock (API always sends stock, so not observed) | Low impact; documented |

## Decisions needed

| ID | Question |
|---|---|
| D-1 | Should the backend **reject** order lines without yards for non-custom products? Today it stores `yards = NULL`. |
| D-2 | Listing/homepage "Add to Cart" adds the first offered length (usually 2 yards) without asking. Keep, or send buyers to the product page to choose? |
| D-3 | Testimonial content (TRY-11) and which social links to publish (`VITE_SOCIAL_*`; unconfigured ones are now hidden). |

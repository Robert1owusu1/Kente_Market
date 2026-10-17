# UI/UX Improvement Report (2026-10-14)

What changed in the interface in this pass, why, and what was deliberately not
changed. Bug IDs refer to `BUG_FIX_TRACKER.md`.

This was **not** a ground-up redesign. The existing visual identity (amber/gold
Kente palette, sand neutrals, rounded cards, dark mode) was kept. The work
focused on making the shopping journey correct, honest and usable on phones,
and on design primitives that let the rest of the app converge later.

## 1. Existing design system (audited)

- Tailwind v4 with a theme in `src/index.css` (`@theme`): brand `primary`
  `#fea928`, `primary-dark` `#ed8900`, `gold`, `sand-*`, `night-*`, a pinned v3
  palette, an `xs` breakpoint, a v3-compatible `.container`.
- No component classes for buttons; each screen hand-wrote gradients, so button
  styles varied widely (gradient pills, flat, outline, white-on-amber).
- Brand amber was used both as a **background** and as a **text colour on
  white**. Amber text on white is 1.9:1 and white text on amber is 1.9–2.6:1 —
  both fail WCAG AA. This was the single largest contrast cause (see
  `ACCESSIBILITY_REPORT.md`).

## 2. Design primitives added (`src/index.css`)

| Primitive | What | Rule it encodes |
|---|---|---|
| `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-dark` | One button shape (44px min height, radius-lg, semibold) in three intents | Primary = amber background with **near-black text** (7.4:1), never white on amber |
| Global `:focus-visible` | 2px `primary-dark` outline, 2px offset | Every focusable element has a visible focus indicator unless it draws its own ring |
| `prefers-reduced-motion` | Neutralises transitions and animations app-wide | The global `*` colour transition and hover transforms now respect the user's setting |

Applied in: product cards, hero, product page (Try It On, yard chips,
customise), referrals, `/products` retry buttons, homepage "View all".

Not done: a full token migration (spacing/typography scales, replacing the 159
`text-primary` text usages and ~90 white-on-amber controls). Recorded as R-1.

## 3. Product discovery

**Shared `ProductCard` (`src/components/ProductCard/ProductCard.tsx`)** replaces
three diverged copies (`/products`, homepage Featured, homepage Highly rated):

- whole-card navigation: image and title link to the product (B-01);
- consistent 4:5 image with `object-cover`, explicit width/height (no layout
  shift), lazy loading except the first row;
- text status badges (Sold out, % off, Only N left, Made to order, Rentable),
  never colour alone;
- vendor line with "Verified" only when the vendor status is approved;
- rating shown only when the product has one; price with the original price
  struck through only for a real sale (B-03, B-04);
- always-visible 40px wishlist button and a full-width Add to Cart that becomes
  "Sold out" and disabled at zero stock (B-02);
- no hover-only controls, no translate/scale hover animation (motion-safe zoom
  on the image only).

**Honest copy**: "Best Products / Top Products for you / #1 Best Seller / Top
Selling Kente Cloth For You / loved worldwide" replaced with "Featured pieces",
"Popular pieces" (fallback list), "Highly rated Kente". Neither list is
ordered by sales, and nothing is personalised.

**Add-to-cart feedback**: a toast now confirms every add (B-07).

`/products`: labelled sort/filter controls, dead floating "+" removed, debug
logging removed (its 2-column phone grid was already right and is unchanged).
Homepage Featured and Highly rated grids went from 1 column to 2 on phones,
matching `/products`.

## 4. Product details

- Price in high-contrast text instead of amber-on-white.
- Selected yard chip: dark chip with white text (was white on amber).
- Try It On / checking state use the primary button; low-stock and "Verified"
  text darkened to AA.
- Unchanged: layout, yards-only purchase model, stock messaging.

## 5. Homepage

- Hero slider: real link buttons (no `<button>` inside `<Link>`), visible
  active dot, pause/play control, one `<h1>`.
- Featured and Highly rated sections use the shared card; headings reduced from
  `text-5xl` to `text-2xl…4xl` so products appear sooner on phones.
- "View all products" fixed (label was covered by its own hover overlay).
- Not changed: section order, testimonials (content decision D-3), newsletter.

## 6. Cart, header, account

- Cart page no longer overflows at 320–360px (B-08).
- Signed-in header fits at 320px (B-09); mobile menu toggle is a 44px control
  with state announced.
- Profile mobile header and certificates form fit on small phones (B-10, B-11).
- Footer shows only configured social links; Subscribe buttons readable.

## 7. Not changed (deliberately)

- Checkout, payment, refund, payout and commission UI — financially sensitive;
  only the direct-URL yards omission (B-16) was fixed.
- Vendor and admin dashboards — crawled (no overflow, no console errors, no
  failed requests); contrast remains (R-1). No redesign attempted.
- Testimonials and marketing content — need owner input (D-3, TRY-11).

## 8. Files

`src/index.css`, `src/components/ProductCard/ProductCard.tsx` (new),
`src/utils/productDisplay.ts` (new), `src/utils/cartItem.ts`,
`src/Pages/AllProducts/AllProducts.tsx`, `src/Pages/AllProducts/productDetails.tsx`,
`src/components/TopProducts/TopProducts.tsx`, `src/components/Products/Products.tsx`,
`src/components/Hero/Hero.tsx`, `src/components/Footer/Footer.tsx`,
`src/components/Navbar/Navbar.tsx`, `src/components/Subscribe/Subscribe.tsx`,
`src/components/Testimonials/Testimonials.tsx`, `src/components/reviews/ProductReviews.tsx`,
`src/components/legal/LegalDocument.tsx`, `src/Context/CartContext.tsx`,
`src/Pages/CartPage/CartPage.tsx`, `src/Pages/CheckoutPage/checkout.tsx`,
`src/Pages/Certificates/MyCertificates.tsx`, `src/Pages/Referrals/ReferralsPage.tsx`,
`src/Pages/UserProfile/UserProfile.tsx`,
`src/Pages/adminDashboardPages/Promotions/PromotionsPage.tsx`,
`backend/routes/cartRoutes.js`.

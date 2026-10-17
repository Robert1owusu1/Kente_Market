# Mobile Responsiveness Report (2026-10-14/15)

## 1. How it was tested

Headless Chrome 153 (Playwright 1.60) against a production `vite build`
served locally, real API and a disposable MySQL with seeded data
(`FULL_PROJECT_AUDIT.md` §1). **39 routes** — 26 guest, 10 customer,
1 vendor, 2 admin — at all **9 required viewports**:

| 320×568 | 360×800 | 375×812 | 390×844 | 430×932 | 768×1024 | 1024×768 | 1280×800 | 1440×900 |
|---|---|---|---|---|---|---|---|---|

= 351 page loads per run. Runs: **baseline** (before), **after**, **after2**
(full re-crawl of the near-final build), then **after3/after4** (targeted
re-crawls of the routes touched by the last fixes, all 9 viewports).

Overflow is measured **per element**: `body { overflow-x: hidden }` hides
horizontal page scroll, so content pushed off-screen is clipped silently
rather than scrollable. Every visible element whose box extends past the
viewport is reported, unless it sits inside an intentional horizontal
scroller. Screenshots were taken at 375, 768 and 1280.

Chromium emulation only — no real devices, no iOS Safari.

## 2. Results

| Measure | Baseline | Final |
|---|---|---|
| Route × viewport combinations with off-screen content | 15 (11 routes) | **0** on every re-verified route (see §3 for the AOS note) |
| Console errors / page errors | 0 | 0 |
| Failed API responses | 0 | 0 |
| Pages that never finished loading | 3 (load-related, transient) | 0 |

Interactive elements under 24×24 px: about 105–111 per mobile viewport in
both runs. The total rose slightly (+5 per viewport) because the hero dots
became real, named buttons (they were unfocusable `div`s before) and are now
counted. The dots are 24×24 in the final build. The remaining small items are
mostly the "Give feedback" link in the testing-mode banner, the 18px search
icon buttons, and inline text links.

## 3. Issues found and fixed

| ID | Route / component | Viewports (baseline) | Root cause | Fix | Verified |
|---|---|---|---|---|---|
| B-08 | `/cart` | 320, 360 | (1) Layout grid had no mobile column definition, so its implicit track sized to the item's min-content (359px). (2) The quantity / subtotal / remove row did not wrap | `grid-cols-1`; `flex-wrap` on the row | after3: no overflow at any viewport; screenshot |
| B-09 | Signed-in header (all customer pages) | 320 (after first fix: 360) | Logo wordmark (`whitespace-nowrap`) + cart + bell + theme toggle + menu need 351–365px | Wordmark visually hidden below 375px (still announced to screen readers). The first attempt (`shrink-0` on the action group) moved the overflow to 360 and was reverted | after3: `/profile`, `/cart`, `/orders`, `/certificates` clean at all 9 viewports. `/wishlist`, `/messages`, `/referrals`, `/custom-requests`, `/customize`, `/ai-tryon` use the same header but were not re-crawled after the last change |
| B-10 | `/certificates` verify form | 320–390 | `flex-1` input without `min-w-0` keeps its intrinsic width; button pushed to x=417 | `min-w-0` input, `shrink-0` button (same fix on 2 admin colour inputs) | after2/after3 |
| B-11 | `/profile` mobile header | 320 | Truncation container without `min-w-0`; long email pushed the menu button out | `min-w-0 flex-1`, 44px `shrink-0` button | after3 |
| — | Homepage product grids | all phones | Featured / Highly rated grids were 1 column on phones (a full-width card per screen) | 2 columns, matching `/products` | screenshots |
| B-12 | `/products` floating "+" | all | Fixed-position dead button over content | removed | after2 |

## 4. Not a defect / known measurement artefacts

- **`/aboutus` at 768–1440**: AOS `fade-left/right` elements are reported
  while their slide-in transform is still finishing (`aos-animate`). AOS is
  disabled below 768px and for reduced-motion users (existing behaviour).
  Not a layout bug; left unchanged.
- The vendor and admin dashboards had no overflow at any viewport in any run.

## 5. Remaining limitations

- `/products` places two hero blocks (page intro, "Authentic Kente From
  Ghana" towns) before the first product; on a 375px phone the first product
  starts about 1.5 screens down. A design change, not done (R-3).
- Touch targets: the testing-mode banner's "Give feedback" link (16px tall)
  and the search icon buttons (18px) are below 24px; inline text links are
  exempt. Not changed.
- Modals: 27 overlay implementations. The ones exercised (cart remove dialog)
  fit the viewport (`max-h-[calc(100dvh-2rem)]`, scrollable), but they were
  not audited individually (R-2).
- Mobile keyboard overlap and real-device safe areas were not tested
  (emulation only).

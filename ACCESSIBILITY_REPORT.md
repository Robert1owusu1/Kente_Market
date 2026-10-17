# Accessibility Report (2026-10-14/15)

Target: WCAG 2.2 AA where reasonably applicable. Method and environment:
`FULL_PROJECT_AUDIT.md` §1.

## 1. What was checked

- **Automated:** axe-core 4.10.2, rule tags wcag2a/aa, wcag21a/aa, wcag22aa,
  on all 39 routes (guest, customer, vendor, admin) at 375px and 1280px, in
  the baseline and final builds. Pages were measured once content had
  rendered.
- **Touch targets:** every interactive element measured against 24×24 px
  (2.5.8) at all 9 viewports.
- **Code review:** heading structure, landmarks, focus visibility, keyboard
  operation of custom widgets (slider, menus, scroll panels), reduced motion,
  form labelling, status announcements, colour-only status.
- **Not done:** testing with a real screen reader (NVDA / VoiceOver /
  TalkBack), manual keyboard walkthroughs of vendor/admin workflows, real
  devices. Automated tools find a fraction of accessibility issues; this
  report does not claim conformance.

## 2. Results (axe violation nodes, summed over the 375 + 1280 snapshots of all 39 routes)

| Rule | Impact | Baseline nodes (pages) | Final nodes (pages) |
|---|---|---|---|
| aria-prohibited-attr | serious | 292 (37) | 0 |
| color-contrast | serious | 341 (39) | 0 on re-verified pages* |
| button-name | critical | 24 (1) | 0 |
| link-name | serious | 22 (1) | 0 |
| listitem | serious | 30 (3) | 0 |
| aria-hidden-focus | serious | 8 (1) | 0 |
| select-name | critical | 4 (2) | 0 |
| label | critical | 2 (1) | 0 |
| scrollable-region-focusable | serious | 4 (2) | 0 |
| target-size | serious | 0 | 5 on `/` at 375 only (see §4) |
| link-in-text-block | serious | 0 | 0 (appeared once mid-pass; fixed) |
| **Total** | | **727** | **≈5** |

\* The full final re-crawl (after2) left 12 contrast nodes on 7 pages. Those
7 pages were fixed and re-crawled (after3/after4) with 0 contrast nodes.
Every other route already had 0 in after2. One intermittent contrast node on
`/` at 1280px appeared in a targeted re-crawl and did not reproduce on an
immediate re-run (consistent with measuring during a slide transition); it is
not counted as fixed.

**Baseline caveat:** `index.html` started every page in dark mode for 0.2s
(see §3, A-09), so some baseline contrast readings were taken mid-fade. The
direction of the result is not in doubt, but the exact baseline count is
approximate.

## 3. Improvements (IDs as in `BUG_FIX_TRACKER.md`)

| ID | WCAG | Change |
|---|---|---|
| A-01 | 4.1.2 | Product card icon buttons/links named; card controls visible without hover (shared `ProductCard`) |
| A-02 | 1.3.1, 4.1.2 | Labels on `/products` sort and filters, `/referrals` payout form (no longer placeholder-only), `/certificates` input |
| A-03 | 2.2.2, 2.4.3, 1.3.1, 2.5.8 | Hero slider: pause/play control; links in hidden slides removed from tab order; dots are named 24px buttons in a real list; one `<h1>` per page (other slides use `<h2>`) |
| A-04 | 4.1.2 | Footer: unconfigured social "tiles" (`aria-label` on `<span>`) no longer rendered |
| A-05 | 1.3.1, 2.1.1 | Legal pages: string items grouped into real `<ul>`s; the read-to-accept panel is a focusable, named region. Keyboard users can now scroll it — previously they could not reach the bottom and so could not accept |
| A-06 | 1.4.3 | Contrast — see §5 |
| A-07 | 4.1.2, 2.4.7 | Mobile menu toggle: 44px, `aria-expanded`, `aria-controls`, visible focus; panel is a labelled `navigation` (it was a non-modal `role="dialog"`); Escape returns focus to the toggle |
| A-08 | 2.4.7, 2.3.3 | Global `:focus-visible` outline; `prefers-reduced-motion` neutralises all transitions/animations (incl. the global `*` colour transition and hover transforms) |
| A-09 | 1.4.3 (flash) | Pre-existing: `<html class="dark">` was hard-coded, so light-theme users saw a dark-mode fade on every load. The theme is now applied before first render (`utils/applyStoredTheme.ts`) |
| — | 4.1.3 | Add-to-cart confirmation via the global toast live region (previously silent) |
| — | 1.4.1 | Stock and sale states shown as text badges ("Sold out", "Only 2 left", "20% off"), not colour alone |

## 4. Open accessibility items

| Item | Detail |
|---|---|
| target-size (axe) on hero dots at 375px | axe reports "24px by 19px, partially obscured". Measured: button and list item are 24×24; `elementsFromPoint` at the lower part of each dot returns the dot button as topmost; centres are 32px apart (passes 2.5.8's spacing exception even if the target were smaller). Recorded as a probable axe false positive, not resolved. |
| Remaining small targets | Testing-mode banner "Give feedback" link (16px tall), header search icon buttons (18px). |
| Modals (R-2) | 27 overlay implementations; 5 declare `aria-modal`; no shared focus trap or focus restore. Needs a shared `Modal` and migration. |
| Dark mode contrast | The final crawl ran in light mode (the default). Dark mode was not crawled. |
| Screen reader / keyboard walkthrough | Not performed with real assistive technology. |

## 5. Colour contrast approach

Root cause: the brand amber `#fea928` was used as **text** on white (1.9:1)
and as a **background under white text** (1.9–2.6:1).

- `index.css` (light mode only): `.text-primary` renders as amber-700 (5.0:1).
  The footer — a dark surface in both themes — is excluded. An audit found no
  other light-mode dark surface carrying `text-primary`.
- `index.css`: an element with `bg-primary` / `bg-secondary` / `from-primary`
  and `text-white` gets near-black text (7.4:1+), the same rule as the new
  `.btn-primary`.
- Pattern replacements: `text-amber-600 dark:text-amber-400` →
  `text-amber-700 …` (19 sites), amber/yellow text and buttons on the about,
  museum, vendor directory, storefront and suggestions pages, the product
  page, cart Remove, profile, vendor dashboard header.
- Brand amber remains the background colour of primary actions; dark mode
  keeps `#fea928`.

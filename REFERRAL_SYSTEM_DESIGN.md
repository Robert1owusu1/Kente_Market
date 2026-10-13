# Referral (Ambassador) Commission System — Design

Status: **rules approved by the owner on 2026-10-12** (session `566deb7e`, answers recorded verbatim in §9).
Implementation status lives in `LOCAL_SECURITY_AND_BUG_TRACKER.md` (REF-* rows).
Paystack stays in TEST mode. Nothing here is deployed.

## 1. Approved business rules

| # | Rule |
|---|---|
| R1 | Every registered user gets a referral link (an "ambassador"). Admin can promote a user to **super ambassador** with a personal rate, set the **standard** ambassador rate, and suspend an ambassador. |
| R1a | **Sellers are ambassadors too** (added 2026-10-12): a seller who brings a new customer earns the referral reward on that customer's qualifying purchases, **including purchases from the seller's own store**. Paid by the platform from its commission; the seller's sale payout is unchanged. Seller dashboard → "Refer Customers" gives a store link and a home link carrying the code. |
| R2 | Commission is earned only on a **verified, paid** order that later **completes successfully**. Registrations, clicks, abandoned/failed/pending payments earn nothing. |
| R3 | **Funding:** the platform pays the referral out of its own commission. Seller payouts never change because of a referral. |
| R4 | **Base:** the seller's list price of the goods (`price × qty`), never VAT or shipping. |
| R5 | **Cap:** per line, referral ≤ what is left of the platform commission after any admin-coupon share (never below 0). The platform must never lose money because of a referral. |
| R6 | **Coupons:** an **admin** coupon is funded by the platform (seller income protected: seller gets `price × (1 − platform rate)`); a **seller** coupon is funded by the seller (platform fee protected: platform gets `price × platform rate`). |
| R7 | Admin cannot set an admin coupon or a referral rate above the platform commission; enforced at save time (against the global rule) **and** capped at checkout per item (rules can be lower for some products). |
| R8 | **Platform-owned products** earn referrals too; they carry a notional platform commission (the rate the commission rules give that product) that caps the referral. |
| R9 | **Attribution:** first link wins; code captured from the link and kept for 30 days through navigation/login; bound permanently when a **new** account is created. Existing customers cannot be referred. Self-referral blocked. |
| R10 | **Window (admin setting):** every paid order within **30 days** or **1 year** of the referred customer's signup qualifies. |
| R11 | **Anti-abuse:** a user cannot create another account with their own link — block signups from a device the referrer has used and email aliases of the referrer's address; flag (admin review) commissions where the buyer shares a payment card/MoMo, phone or delivery address with the referrer. |
| R12 | **Lifecycle:** pending at verified payment → available when the order's escrow is released (order completed) → paid (only by a verified Paystack transfer) / spent (store credit). Full refund cancels; partial refund reduces proportionally to the refunded goods' list value; if already withdrawn/spent, the reversal is a negative balance offset against future earnings. |
| R13 | **Using earnings:** withdraw via Paystack transfer, **or** pay for a **whole** order (goods + VAT + shipping) with earnings. An order paid with earnings is **final: no refund at all**; the seller is paid through normal escrow; the money can never be withdrawn back. |

## 2. Worked numbers (the owner's examples)

GH₵1,000 item, platform 20 % (GH₵200), referral 4 % (GH₵40):

| Case | Customer pays (goods) | Seller gets | Platform keeps | Referrer |
|---|---|---|---|---|
| No coupon | 1,000 | 800 | 160 | 40 |
| Admin coupon 10 % (−100) | 900 | **800** (protected) | 200 − 100 − 40 = **60** ("6 %") | 40 |
| Seller coupon 10 % (−100) | 900 | 1,000 − 100 − 200 = **700** ("70 %") | 200 − 40 = 160 | 40 |
| Admin coupon 18 % (−180) | 820 | 800 | 200 − 180 − **20** = 0 | **20** (capped, R5) |

## 3. Accounting model (per line)

```
P   = price × qty                    (seller list value; referral base)
r   = platform rate (commission rules: product > vendor > category > global)
F   = round2(P × r)                  platform commission (gross)
Da  = admin-coupon share   = D_admin × F / ΣF   (split by commission, so Da ≤ F)
Ds  = seller-coupon share  = D_seller × P / ΣP  (seller coupons only exist on single-seller carts)
customer pays for goods    = P − Da − Ds
seller payout              = P − F − Ds
platform net (escrow fee)  = F − Da
referral                   = min(refRate × P, F − Da), floored at 0
platform after referral    = F − Da − referral  ≥ 0
```
Escrow allocation per vendor: `amount = Σ(P − Da − Ds)`, `platformFee = Σ(F − Da)`, `payoutAmount = Σ(P − F − Ds)`
(`amount = platformFee + payoutAmount`). Checkout caps: admin coupon ≤ ΣF; seller coupon ≤ Σ(P − F).

## 4. Data model (migration `migrateReferrals.js`, additive)

- `users`: `referralCode` (unique), `referredBy`, `referredAt`, `ambassadorTier` (`standard`/`super`),
  `ambassadorRate` (super override), `ambassadorSuspended`.
- `orders.commissionSnapshot` (JSON): per-line P, r, F, Da, Ds frozen when escrow is allocated.
- `referral_commissions`: one row per qualifying order, `UNIQUE(orderId)`; base, rate, cap, amount,
  `reversedAmount`, status `pending | under_review | available | cancelled | reversed`, review reasons.
- `referral_wallets` + `referral_ledger` (append-only; unique `dedupeKey`): earn, reverse, withdraw,
  withdraw-return, spend. Balance may go negative (debt) only through reversals.
- `referral_withdrawals`: Paystack transfer attempts (`kente_rtr_` references), states mirror vendor payouts.
- `user_devices`: hashed device id per user (anti-abuse).
- Settings (`settings` table): `referral.enabled`, `referral.standardRate`, `referral.windowDays` (30 | 365).
- Status changes are journaled in `financial_events`; admin actions in `admin_audit_log`.

## 5. Flows

1. Link `/?ref=CODE` → SPA calls `POST /api/referrals/visit` → server validates code, sets httpOnly cookie
   (30 days) **only if none exists** (first link wins).
2. Registration (email or Google signup) → server reads cookie, validates referrer, anti-abuse checks →
   binds `referredBy`. Never trusts a client-supplied referrer id.
3. Verified payment → paid side-effect step `referralRecorded` creates the commission (pending, or
   under_review when an abuse signal fires). Idempotent: `UNIQUE(orderId)` + marker.
4. Escrow release / order completion job → pending → available, wallet credited once (ledger dedupe).
5. Refund / cancel / partial vendor refund → `adjustReferralForRefund(orderId)` recomputes the target amount
   and posts the delta once.
6. Withdraw → claim balance under row lock → Paystack transfer → webhook/reconciler settles.
7. Pay with earnings → whole order total debited under row lock → order paid → normal side effects.

## 6. Defaults chosen by the engineer (please confirm)

- An order paid **with referral earnings** does not earn a referral commission for the buyer's referrer
  (prevents money circling between accounts).
- Minimum withdrawal GH₵10; withdrawals require a verified email and a Paystack recipient (MoMo/bank).
- IP address is recorded but never blocks signups on its own (Ghanaian mobile networks share IPs).

## 7. Known limits

Device and email checks raise the cost of self-referral but cannot stop a determined person using a new
device, new email and a different payment method. Those cases surface only through review signals and
admin judgement.

## 8. Open decisions

- Consumer-law review of R13 ("no refund at all" for orders paid with earnings).
- Tax treatment of referral earnings (withholding, reporting).
- Whether suspended ambassadors forfeit available earnings.

## 9. Owner's answers (verbatim, 2026-10-12)

- Funding: "Platform funds, capped at its commission".
- Base: "commission should not include the VAT and the Shipping fee it should come from the actual product price set by the seller … the referrer commission should not be more than the platform commission and also all commissions will be release when there is a succesfull complete order".
- Attribution: "the first one but admin needs to be able to set if it should work on every purchase for one year or 30 days and also a user can't use their own link to create another account and also some will try to use different e-mail but on the same device to just earn so if there will be a way to fix it".
- Payable/refund: "After escrow release; reverse on refund".
- Coupons: "if admin sets coupons it affects its platform % and if the seller sets a coupon it affects the sellers income so the platform own comes first before the seller own … if the main admin sets we protect the sellers income but if the seller sets we protect the platform fee as well".
- Cap: "admin should not set coupon or referal comision above the platform fee they set the platform should not run out of money".
- Referrers: "every registerd user gets a link … some people will be having super ambassadors where the admin will change their ambassador role for them admin can change their comission and also set comission for the normal ambassadors".
- Payout: "both 1 and 2 … you can use your earnings to purchase a product if your earnings are upto the price of the product and also withdraw … if they use their earnings to buy the money goes direct to the seller and they can't withdraw it back".
- Store-credit refund: "Whole order; no refund at all".
- Platform products: "platform products should be attached with the platform comission and referals as well. We use this as a marketing strategy".
- Sellers as referrers: "if a seller refere a buyer let the seller recieve they reward its a market strategy we are using the buyers to drag their customers to the platform".

## 10. Report (the owner's §10 questions, after implementation)

**A. Flow.** Link `/?ref=CODE` → `POST /api/referrals/visit` sets an httpOnly 30-day cookie (first link wins) →
new account (email or Google signup) is bound to the referrer if all checks pass → the customer's order is
paid and the **backend** verifies it (webhook / verify / recovery) → the paid side-effect step
`referralRecorded` creates one `pending` commission (or `under_review` on an abuse signal) → when the
order's escrow is released to the seller (order completed) a job moves it to `available` and credits the
referrer's wallet → the referrer withdraws via Paystack or pays a whole order with it.

**B. Rate configuration.** Admin → Referrals: standard rate (feature OFF until a rate is set and the
programme is switched on), per-user super-ambassador rate, window 30 days / 1 year. Every rate is validated
server-side to be ≤ the global platform commission; each line is additionally capped at the platform
commission left after any admin coupon. Platform commission itself: Admin → Commissions (product > vendor >
category > global).

**C. Attribution.** Server-side only: signed httpOnly cookie → `users.referredBy` set once, at account
creation, only for an account with no orders. Self, same canonical email (Gmail dots/+tags), same device
(keyed hash of an httpOnly device cookie) are refused. Client-supplied referrer ids are never accepted.

**D. Base.** Seller list price × qty (`P`); never VAT or shipping; same before/after coupons (§2).

**E. Interaction.** Funded by the platform out of `F − Da`; seller payouts never change because of a
referral. Admin coupons come out of the platform commission (seller protected); seller coupons out of the
seller's proceeds (platform fee protected). No double deduction: the escrow allocation never contains the
referral; the referral is a separate wallet liability.

**F. Refunds.** Full refund/cancel → commission `cancelled` (not yet credited) or `reversed` (credited; the
wallet is debited and may go negative = debt offset against future earnings). Per-vendor partial refund →
commission recomputed without that vendor's lines (owner example: 40 → 24). One ledger row per target
amount; repeated refund paths change nothing. The original amount stays on the row; every change is in
`referral_ledger` + `financial_events`.

**G. Duplication.** `UNIQUE(orderId)` on `referral_commissions`; marker `referralRecorded`; wallet ledger
`UNIQUE(dedupeKey)` for earn / reverse / withdraw / return / spend; promotion and refunds take the
commission row lock. Tested with duplicate webhooks, repeated verification and 10 concurrent workers.

**H. Decisions still needed** — see §8 and §6 (engineer defaults to confirm).

## 11. Required tests → where they are

All in `backend/tests/referralSystem.test.js` (24 tests, disposable DB, Paystack stubbed) unless noted.

| # | Requirement | Test |
|---|---|---|
| 1 | Registration alone | "1 + 10 + 12" |
| 2 | Link click alone | "2: a link click alone…" + `src/components/Referral/__tests__/ReferralCapture.test.tsx` |
| 3, 4, 5, 15 | Abandoned / failed / pending / cancelled | "3 + 4 + 5 + 15" |
| 6, 16, 17 | Verified purchase, server values, reconciliation | "6 + 16 + 17", "Scenario G…" |
| 7, 8, 9 | Duplicate webhook, repeated verify, concurrency | "7 + 8 + 9" |
| 10 | Invalid codes | "1 + 10 + 12", pure "tampered or foreign capture tokens" |
| 11 | Unauthorized rate/balance edits | "11: …" (HTTP 403/401, validation) + admin UI test (no balance/paid controls) |
| 12 | Self-referral | "1 + 10 + 12" (self, alias, device) |
| 13 | Full refund | "13: …", "refund while pending…" |
| 14 | Partial refund | "14: …" |
| 18 | Paid needs evidence | "18 + 20: …" (mismatch → review; reconciler from Paystack data) |
| 19 | Referrer data isolation | "19: …" + `ReferralsPage.test.tsx` |
| 20 | Failure + retry | "18 + 20" (timeout keeps funds reserved), "20: … safety-net job" |

Mutation checks (each guard removed → suite fails, then restored byte-for-byte): paid-only, per-line cap,
same-device, email alias, completion gate, transfer evidence, earnings-paid finality, window.

# KENTE MARKET — FINAL PRODUCTION READINESS AND COMPLETION MISSION

## ROLE

Act as the principal software engineer, application security engineer,
payment systems engineer, database migration engineer, QA lead, and
production-readiness owner for Kente Market.

This is an existing, substantial, multi-vendor e-commerce application.
It has already been developed and modified by multiple AI coding models.

Your responsibility is to take the EXISTING CODEBASE, understand the
actual current implementation, identify unfinished tasks and defects
left by previous models, implement the necessary fixes, validate the
integrated result, and prepare the application for a controlled
production release.

Do not treat this as a greenfield project.

Do not replace functioning systems merely because you prefer a different
architecture.

Do not perform a superficial audit and stop after writing a report.

You are expected to inspect, implement, test, and verify the work.

However, do not claim that the application is production-ready unless
the available evidence supports that conclusion.

The priorities are correctness, security, financial integrity,
tenant isolation, reliability, maintainability, and preserving existing
business requirements.

==================================================
1. NON-NEGOTIABLE SAFETY AND CHANGE CONTROL
==================================================

You may inspect and modify local project files and run appropriate local
tests.

You MUST NOT, without my separate explicit approval:

- Push commits to GitHub.
- Commit changes.
- Deploy to Vercel, Render, or any other environment.
- Run migrations against production or shared databases.
- Change production environment variables or secrets.
- Make real Paystack charges, refunds, transfers, or withdrawals.
- Use real customer accounts or real customer information in tests.
- Run destructive tests against the live website.
- Delete databases, migrations, backups, user data, or project files.
- Reset Git branches or use destructive Git commands.
- Discard, overwrite, or revert existing user changes.
- Disable security controls to make tests pass.
- Replace failing tests with weaker tests simply to obtain a green result.
- Hide, skip, or silently downgrade existing test failures.
- Make external network requests to payment providers as part of testing.

Never print, expose, commit, or copy secrets into reports. If credentials
are found in files, identify the affected locations without reproducing
the secret values.

Do not read or transmit production customer data.

Before any potentially destructive local operation, explain the risk and
use a disposable test environment wherever possible.

If a necessary action could affect a shared database, production system,
external service, or user-owned changes, stop and ask for approval.

Do not stop working merely because a test database is unavailable.
Continue safe static analysis, unit tests, mock-based integration tests,
and other independent work. Record any validation that could not be
completed.

==================================================
2. FIRST: ESTABLISH THE REAL CURRENT STATE
==================================================

Before changing code:

1. Confirm the repository root.
2. Inspect the current Git branch, HEAD, working-tree status, staged
   changes, unstaged changes, and untracked files.
3. Identify the actual frontend, backend, database, test frameworks,
   build tools, deployment configuration, and package managers.
4. Read the project instructions, README files, package scripts,
   architecture documentation, existing audit reports, remediation
   reports, TODO/FIXME notes, migration files, and relevant CI workflows.
5. Identify work left by all previous coding models and agents.
6. Inspect the current implementation rather than assuming previous
   reports are completely accurate.
7. Establish a baseline for tests, typechecking, linting, and builds
   before changing code.
8. Record pre-existing failures separately from newly introduced failures.
9. Determine which changes are already implemented, partially implemented,
   duplicated, superseded, or still missing.
10. Preserve all current work, including uncommitted changes.

Previously reported Git details included branch
`fix/global-production-integration` and HEAD `2df4428`.

These are historical reference points, NOT assumptions. Verify the
actual repository state first.

Create an internal task inventory and a durable file named:

`PRODUCTION_READINESS_TRACKER.md`

For each task, record:
- Task identifier.
- Original finding or requirement.
- Affected files and components.
- Current implementation status.
- Risk and priority.
- Required fix.
- Tests required.
- Actual test results.
- Remaining blockers.
- Final disposition.

Use the existing project reports as evidence and historical context.
Do not delete or silently rewrite previous findings or reports.

If a previous report is contradicted by the actual code, document the
contradiction and follow the verified implementation.

==================================================
3. COMPLETE THE PREVIOUS PAYMENT AND ESCROW WORK
==================================================

The previous engineering sessions covered payment lifecycle recovery,
Paystack webhook processing, refunds, escrow, shipping, international
checkout, and database schema consistency.

Audit and complete all of these areas.

A. PAYMENT LIFECYCLE AND RECOVERY

Verify:

- Payment initiation and order creation.
- Server-side amount calculation.
- Payment verification.
- Webhook signature verification.
- Duplicate webhook handling.
- Out-of-order webhook handling.
- Idempotent order payment transitions.
- Paid-order side effects.
- Stock reservation and restoration.
- Coupon consumption and reversal.
- Platform revenue records.
- Payment event and transaction journaling.
- Recovery of interrupted payment processing.
- Recovery after database errors.
- Recovery after process crashes.
- Correct behavior when the provider response is unknown.
- Reconciliation of unmatched successful charges.
- Duplicate customer confirmation emails.
- Recovery job scheduling and distributed locking.
- Bounded scans and database query performance.

Previously reported components include:

- `backend/Services/paymentReconciliationService.js`
- `backend/Services/paystackservices.js`
- `backend/controllers/orderController.js`
- `backend/controllers/returnController.js`
- `backend/routes/paymentRoutes.js`
- `backend/utils/cleanupJobs.js`
- `backend/utils/refundClaim.js`
- `backend/tests/paymentRecovery.test.js`
- `src/utils/paymentRef.ts`

These paths are starting points, not a complete inventory. Search for
all related implementations and call sites.

Confirm that repeated callbacks or recovery attempts cannot:
- Create duplicate orders.
- Charge customers twice.
- Consume stock repeatedly.
- Consume coupons repeatedly.
- Record revenue repeatedly.
- Send duplicate confirmation emails.
- Mark a failed or cancelled order as paid without valid evidence.
- Lose track of a confirmed payment because a database write failed.

Do not assume a provider timeout means that the transaction failed.
Design recovery around uncertainty and provider-side verification.

B. REFUND SAFETY

Verify:

- Refund requests are authorized.
- Refund amounts are calculated server-side.
- Partial and full refunds are supported consistently.
- Refunds cannot exceed the eligible amount.
- Concurrent refund requests cannot spend the same balance twice.
- Refund claims are idempotent.
- Provider acceptance followed by a local database failure is recoverable.
- A held claim is reconciled rather than blindly retried.
- Provider-confirmed pending refunds are not treated as completed.
- Unknown provider outcomes do not cause automatic duplicate refunds.
- Terminal orders cannot bypass amount or currency validation.
- Long provider references cannot break claim storage.
- Refund journals, order state, customer-visible state, and revenue
  records remain consistent.
- Refunds restore stock only according to the actual order policy.
- Refund and cancellation flows correctly interact with escrow.

Review `buildRefundClaim()` and every caller. Check reference length,
collision resistance, database constraints, vendor identifiers, and
backward compatibility.

Review `reconcileStaleRefundClaims()` and `reconcileUnmatchedCharges()`.
Verify their scheduling, retry behavior, locking, alerting, and recovery
logic.

Do not automatically issue a new refund when provider state is unknown.

C. ESCROW AND SELLER WALLETS

Verify:

- Escrow allocations are created correctly.
- Allocations cannot be released before their release conditions.
- Cancelled, refunded, unpaid, or otherwise ineligible orders cannot
  release escrow.
- Voided allocations cannot later be released.
- Available seller balances can be clawed back safely when appropriate.
- Concurrent releases and withdrawals are transactionally safe.
- Wallet balances and ledger entries reconcile.
- Idempotency prevents duplicate credits and debits.
- Retry behavior is safe after a crash between ledger writes and state
  transitions.
- Withdrawal eligibility is validated server-side.
- Sellers cannot withdraw more than their available balance.
- Administrative actions cannot bypass financial invariants.
- Reservation expiry correctly handles escrow allocations.
- Partially processed or ambiguous financial operations are surfaced
  for reconciliation rather than silently guessed.

Review the actual escrow service, wallet service, withdrawal endpoints,
release jobs, administrative controls, and all relevant database
transactions.

Do not claim that Paystack itself provides escrow functionality unless
the implemented architecture and provider agreement support that claim.
Distinguish internal ledger holds from actual custody or regulated
escrow services.

D. PAYMENT AND ACCOUNTING INVARIANTS

Verify that these values are consistent:

- Product subtotal.
- Shipping.
- Taxes.
- Discounts.
- Gross amount.
- Amount actually charged.
- Refund amount.
- Seller proceeds.
- Platform commission.
- Referral or ambassador commission.
- Payment processing fees.
- Platform revenue.
- Escrow allocation.
- Seller available balance.

Document the precise accounting equations used by the existing business
logic.

Use integer minor currency units or an appropriately precise monetary
representation. Avoid unsafe floating-point calculations for financial
decisions.

Confirm the same rules are enforced by checkout, payment verification,
webhooks, refunds, administrative payment actions, reconciliation jobs,
and seller payouts.

Do not invent new commission percentages or silently change the
established business model.

==================================================
4. INTERNATIONAL CHECKOUT AND SHIPPING
==================================================

Kente Market must support its intended Ghana-first business while
allowing eligible customers abroad to purchase products.

Verify:

- Ghanaian and international delivery addresses.
- Supported countries and currencies.
- Server-authoritative currency conversion.
- FX rate availability and failure behavior.
- FX rate freshness and auditability.
- Consistent free-shipping thresholds.
- Quote-versus-booked shipping consistency.
- Per-product and per-vendor shipping rules.
- Shipping quantity calculations.
- Country and delivery-zone restrictions.
- Missing shipping-rate behavior.
- Tax calculation and disclosure.
- Checkout totals cannot be manipulated by the client.
- Currency and amount cannot change silently between checkout and payment.
- International orders cannot use unsupported shipping services.
- Existing orders retain the correct historical amounts and currency.
- Provider amount limits and currency restrictions are handled safely.

Previously reported areas include:

- `shippingService.js`
- `internationalCheckoutController.js`
- `migrateExchangeRates.js`
- `migrateShippingCarriersRates.js`
- `branding_house.sql`

Find every implementation and schema definition involved.

Previously reported behavior included:
- `SHIPPING_TABLES_MISSING` when shipping tables are absent.
- `SHIPPING_FX_UNAVAILABLE` when usable FX rates are unavailable.
- No unsafe static fallback for unavailable exchange rates.
- GHS-normalized free-shipping threshold comparisons.

Verify the actual behavior. Preserve fail-safe handling for missing
rates, stale FX data, and unavailable shipping tables.

Do not invent exchange rates, shipping prices, taxes, or provider
capabilities.

Do not make a production database migration.

Verify migration/schema consistency using a disposable database where
available.

==================================================
5. MULTI-TENANT SECURITY AND AUTHORIZATION
==================================================

This is a multi-vendor platform. Tenant isolation is a release-critical
requirement.

Audit every major API domain for:

- Broken object-level authorization.
- Insecure direct object references.
- Cross-vendor data access.
- Cross-tenant customer data exposure.
- Unauthorized administrative operations.
- Missing ownership checks.
- Vendor suspension bypasses.
- Role escalation.
- Authentication bypasses.
- Session and token problems.
- CSRF protections where applicable.
- XSS.
- SQL injection.
- Unsafe file upload and deletion.
- Path traversal.
- Mass assignment.
- Improper validation.
- Rate-limit bypasses.
- Account enumeration.
- Password reset flaws.
- OAuth state and callback flaws.
- Insecure logging.
- Sensitive data exposure.
- Unsafe error responses.
- Race conditions affecting authorization or business state.

Review all relevant areas, including:

- Customer accounts.
- Vendor registration and management.
- Products and inventory.
- Orders and order items.
- Cart and checkout.
- Returns and refunds.
- Escrow and withdrawals.
- Coupons and promotions.
- Reviews.
- Admin operations.
- Staff permissions.
- Notifications.
- Shipping.
- Uploaded media.
- Search and filtering.
- Any custom-order or custom-request workflows.
- Any referral or ambassador features.

Do not rely only on frontend route guards. Enforce authorization on
the server and validate tenant ownership at the data-access boundary.

Review known historical findings, including:
- Paid-order state resurrection.
- Escrow release guards.
- Suspended-vendor products remaining orderable.
- OAuth state handling.
- Staff logout and authorization behavior.
- Login lockout behavior.
- Cross-tenant file operations.
- Payment reference and amount validation.
- Refund and order state consistency.

These are historical findings to verify, not a declaration that the
current code still contains each vulnerability.

Add regression tests for confirmed defects.

Never exploit the live website during this task.

==================================================
6. FRONTEND, BACKEND, AND API INTEGRATION
==================================================

Trace important customer and vendor workflows end to end.

Verify:

- Signup, login, logout, and password recovery.
- Vendor onboarding and approval.
- Product creation and management.
- Product variants and stock.
- Cart operations.
- Checkout and address management.
- Payment initiation and confirmation.
- Order history and order status.
- Cancellation and returns.
- Refund status.
- Seller earnings and withdrawals.
- Administrative operations.
- International checkout.
- Shipping selection.
- Notifications and emails.
- File and image uploads.
- Mobile-responsive behavior.
- Loading, empty, and error states.
- Authentication expiration.
- API response consistency.
- Frontend handling of retries and duplicate submissions.

Review frontend payment reference storage, including namespaced keys
such as `pendingPaymentRef:order:7` and
`pendingPaymentRef:custom:7`.

Confirm order IDs and custom-request IDs cannot collide in browser
storage.

Check whether any legacy storage values must be handled safely. Do not
restore ambiguous legacy behavior if it can associate a payment with
the wrong transaction.

Avoid unrelated redesigns or feature expansion.

Preserve the existing product design and business requirements unless
a change is necessary for correctness, accessibility, or security.

==================================================
7. DATABASE, MIGRATIONS, AND DATA INTEGRITY
==================================================

Inspect:

- The complete migration history.
- Fresh-install schema creation.
- Existing-install upgrade paths.
- Schema definitions and ORM models.
- Foreign keys and unique constraints.
- Indexes.
- Transaction boundaries.
- Locking behavior.
- Nullable fields and defaults.
- JSON field compatibility.
- Numeric precision.
- Existing production data compatibility.
- Migration idempotency.
- Migration ordering.
- Rollback or recovery procedures.
- Seed-data safeguards.
- Differences between test and deployment schemas.

Check the previously reported exchange_rates, shipping tables,
payment-processing state, platform revenue fields, payment side-effect
tracking, refund claim fields, and all other schema additions.

Do not assume that a table in `branding_house.sql` is automatically
created in an existing production database.

Do not assume that a migration is safe merely because it is idempotent.

For each necessary migration, document:
- The exact schema change.
- Why it is required.
- Whether it locks or rewrites tables.
- Whether it is safe with existing records.
- Whether it requires application downtime.
- Required deployment ordering.
- Backup and recovery considerations.
- Post-migration verification queries.
- Rollback or forward-recovery strategy.

You may run migrations ONLY against a disposable local test database
that you have positively identified.

Never run migrations against production or a shared TiDB database.

==================================================
8. TESTING AND QUALITY GATES
==================================================

Establish a baseline, then implement and execute the most comprehensive
safe local test suite possible.

Inspect all package scripts and test configurations first.

Run appropriate:

- Unit tests.
- Integration tests.
- API tests.
- Payment lifecycle tests.
- Signed-webhook tests using fake secrets.
- Refund recovery tests.
- Escrow and wallet concurrency tests.
- Tenant-isolation tests.
- Authorization regression tests.
- International shipping and FX tests.
- Database migration tests.
- Frontend component tests.
- Frontend payment-reference tests.
- Linting.
- Typechecking.
- Production frontend build.
- Backend syntax checks.
- Dependency and secret scanning using tools already available.
- CI-equivalent checks.

Use mocked provider APIs and disposable test databases.

Do not send real payment-provider requests.

Previously reported historical results include:

- A full test suite reaching 658/658 tests.
- `paymentRecovery.test.js` passing 14/14.
- `paymentLateCharge.test.js` passing 11/11.
- `refundDoubleSpend`, `refundGuard`, `refundRestore`, and
  `partialRefunds` passing 22/22.
- A payment lifecycle group passing 48/48.
- Frontend payment-reference tests passing 9/9.
- A `refundReconcile.test.js` test intermittently failing because an
  administrative alert query used `LIMIT 5` without deterministic
  ordering.
- A backend typecheck reporting errors involving `staleRate` in
  `shippingService.js` and `migratePaymentProcessingState.js`.

These are historical reports. Reproduce and verify them in the current
repository before relying on them.

In particular, investigate the alert-selection issue. Fix the underlying
determinism problem if confirmed, using an appropriate deterministic
query and suitable tests. Do not simply rerun until the test passes.

Fix genuine baseline and newly introduced defects whenever safe.

If an error is truly unrelated, document why it is unrelated and what
would be required to resolve it. Do not label a defect pre-existing
without evidence.

Do not:
- Disable tests.
- Weaken assertions.
- Hide failures.
- Remove coverage to obtain a passing result.
- Claim a test passed when it was not executed.
- Treat a mocked provider as proof of real provider integration.
- Treat unit tests as proof of production database compatibility.

Record commands, exit codes, test counts, failures, and relevant output
in the final report.

Repeat flaky or concurrency-sensitive tests enough to investigate
their behavior rather than merely obtaining one green run.

==================================================
9. PRODUCTION CONFIGURATION AND OPERATIONS
==================================================

Review production configuration without changing the real deployment.

Check:

- Environment variable validation.
- Missing and unsafe defaults.
- Secret management.
- CORS configuration.
- Cookie security.
- HTTPS assumptions.
- Session/token expiry.
- Rate limiting.
- Request-size limits.
- File upload restrictions.
- Database connection handling.
- Connection pool limits.
- Graceful shutdown.
- Error handling.
- Logging and redaction.
- Health checks.
- Readiness checks.
- Background job startup and locking.
- Job retry behavior.
- Duplicate job execution.
- Monitoring and alerting.
- Dependency vulnerabilities.
- Build reproducibility.
- CI/CD safeguards.
- Backup and recovery procedures.
- Deployment configuration for Vercel, Render, and other actual services.
- Environment parity between local, staging, and production.

Review the actual provider integrations and their documented API
assumptions. Do not guess at Paystack capabilities.

Make sure critical payment and recovery jobs do not silently fail.
Make sure health endpoints do not disclose secrets or internal details.

Verify that startup and recovery processes cannot perform expensive,
unbounded scans or unexpectedly mutate large amounts of existing data.

Do not expose credentials or reproduce their values in reports.

Produce an environment-variable inventory containing names, purpose,
required/optional status, and the environment in which each is needed.
Never include actual secret values.

==================================================
10. DEPENDENCIES AND SECURITY SCANNING
==================================================

Inspect frontend and backend dependencies, lockfiles, scripts, and
available security tooling.

Identify:
- Known vulnerable dependencies.
- Abandoned or incompatible packages.
- Unexpected install scripts.
- Secrets accidentally committed.
- Unsafe dependency versions.
- Duplicate or conflicting dependencies.
- Runtime/build version mismatches.

Prefer minimal, compatible, tested upgrades.

Do not blindly upgrade the entire dependency tree.

Do not regenerate lockfiles unnecessarily.

If an upgrade changes application behavior or major-version APIs,
implement and test the necessary compatibility changes.

Distinguish confirmed vulnerabilities from tool warnings and
unverified hypotheses.

==================================================
11. WORKING METHOD: DO NOT STOP AFTER THE AUDIT
==================================================

Work in controlled phases.

PHASE A — INVENTORY
Inspect the codebase and produce a task tracker.

PHASE B — BASELINE
Run safe checks and record pre-existing failures.

PHASE C — IMPLEMENTATION
Fix verified critical and high-risk defects first. Then resolve medium
and low-risk production-readiness issues.

PHASE D — REGRESSION TESTS
Add or update tests for every material bug fix.

PHASE E — INTEGRATION
Test interactions between payment, orders, refunds, escrow, wallets,
shipping, inventory, accounting, and tenant authorization.

PHASE F — FULL VALIDATION
Run the full safe suite, lint, typechecks, builds, migrations against
a disposable database, and additional targeted tests.

PHASE G — FINAL REVIEW
Review the entire diff for regressions, accidental changes, secrets,
missing migrations, untested paths, and incomplete work.

PHASE H — HANDOVER
Produce a release-readiness report and a step-by-step staging and
production runbook.

After each phase, update `PRODUCTION_READINESS_TRACKER.md`.

Continue from phase to phase. Do not stop after inventory or after
fixing the first few defects.

If context or time becomes limited, save the current state, record the
exact remaining work, and continue in subsequent sessions. Do not
pretend unfinished tasks are complete.

When work can be safely completed locally, complete it instead of
merely recommending that someone else do it.

If you encounter a blocker, continue independent tasks and explain the
specific blocker.

Prefer small, understandable changes with focused regression tests.

Avoid large rewrites unless the existing architecture cannot meet a
verified requirement.

==================================================
12. DEFINITION OF DONE
==================================================

The task is complete only when:

1. All known previous-model tasks have been inventoried.
2. Each task has a verified disposition.
3. Critical and high-severity confirmed defects have been fixed and
   regression-tested, or explicitly identified as blockers requiring
   external action.
4. Payment, refund, escrow, and wallet invariants have been reviewed
   across all relevant code paths.
5. Tenant isolation and server-side authorization have been tested.
6. International shipping, FX, and checkout calculations have been
   validated.
7. Required migrations and schema differences are documented and
   tested on a disposable database.
8. The complete applicable test suite has been executed and results
   recorded.
9. Linting, typechecking, and production builds have been run.
10. Remaining warnings, failures, limitations, and unverified
    provider assumptions are documented.
11. The full diff has been reviewed.
12. No changes have been committed, pushed, deployed, or applied to
    production.
13. A staging validation plan and production deployment runbook exist.
14. The final verdict accurately reflects the evidence.

Use these verdicts:

- NO-GO: A critical defect, major financial-integrity problem,
  serious security issue, or unresolved release-blocking failure remains.
- CONDITIONAL GO: Local checks are promising, but material external
  validation, migrations, provider verification, or other release gates
  remain incomplete.
- GO FOR STAGING VALIDATION: Local engineering gates pass sufficiently
  to justify controlled staging tests, but production approval has not
  yet been granted.
- PRODUCTION-READY CANDIDATE: All defined engineering gates pass and
  remaining external release steps are explicitly documented. This is
  not a guarantee that the live environment has been validated.

Never issue an unconditional production approval solely because
automated tests pass.

==================================================
13. REQUIRED DELIVERABLES
==================================================

Maintain and produce:

1. `PRODUCTION_READINESS_TRACKER.md`
   Complete inventory of previous work, findings, fixes, and outstanding
   tasks.

2. `FINAL_PRODUCTION_READINESS_REPORT.md`
   Actual work performed, files changed, verified defects, test evidence,
   residual risks, and final verdict.

3. `STAGING_VALIDATION_RUNBOOK.md`
   Safe staging setup, migration validation, provider sandbox checks,
   end-to-end scenarios, rollback criteria, and acceptance criteria.

4. `PRODUCTION_DEPLOYMENT_RUNBOOK.md`
   Human-controlled deployment order, backups, migration procedure,
   configuration checklist, health checks, monitoring, and recovery plan.
   Do not execute the deployment.

5. `DATABASE_MIGRATION_REVIEW.md`
   Migration inventory, schema discrepancies, ordering, risk assessment,
   and verification/rollback procedures.

6. `SECURITY_FINDINGS.md`
   Confirmed findings, severity, evidence, affected code, remediation,
   and unresolved security risks. Do not include secrets or customer PII.

7. Automated regression tests for verified fixes.

Do not overwrite historical reports. Reference them and preserve their
original contents.

==================================================
14. FINAL EXECUTION INSTRUCTIONS
==================================================

Start by inspecting the real repository state.

Do not immediately rewrite files.

Build the inventory, establish the baseline, and identify the highest-risk
unfinished tasks.

Then begin implementing and validating the fixes.

Keep a clear record of every material change and the test that supports
it.

Do not ask me to approve routine, safe local code fixes individually.
Use engineering judgment within the boundaries above.

Ask before actions involving production, shared infrastructure, real
payments, destructive changes, or irreversible operations.

If a requested feature cannot be safely completed because its business
rules or provider capabilities are unknown, document the exact missing
decision rather than inventing behavior.

The final objective is a coherent, tested, maintainable Kente Market
release candidate—not merely a long audit report or a large collection
of code changes.

Begin with Phase A and proceed through all phases that can be safely
completed.
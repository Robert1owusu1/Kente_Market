// FILE LOCATION: backend/scripts/test-batch.mjs
// DESCRIPTION: Run the backend test suite in 3 domain batches (gentle on a
//   low-RAM host — one batch at a time). Batch 1 and 2 are explicit lists;
//   Batch 3 is "everything else" so new test files are always covered.
//   Usage:  node scripts/test-batch.mjs 1|2|3        (or: npm run test:batch1)
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.join(here, '..', 'tests');

// --- Batch 1: payments, money, escrow, refunds, auth & security core ---
const BATCH1 = [
  'money', 'commissionEngine', 'escrowLogic', 'escrowCancellationRefund', 'settlement',
  'platformRevenue', 'paidSideEffects', 'idempotency', 'deadlockRetry', 'finalVerificationRaces',
  'rb01-checkout-rollback', 'rb02-escrow-retry', 'rb03-payment-paid-flip', 'rb04-inventory-double-restore',
  'paymentCurrencyContract', 'paymentHardeningSchema', 'paymentLateCharge', 'paymentLifecycleRecovery',
  'paymentRecovery', 'paystackReferenceGuard', 'adminMarkPaidRace', 'webhookPoolOccupancy',
  'partialRefunds', 'refundDoubleSpend', 'refundGuard', 'refundLifecycle', 'refundReconcile', 'refundRestore',
  'returnRefundOutcome', 'recoveryFairness', 'withdrawalConcurrency', 'payoutLifecycle', 'payoutAdminPolicy',
  'authHardening', 'authSessionRevocation', 'loginLockout', 'loginTiming', 'csrfToken',
  'oauthEmailVerification', 'oauthStateGate', 'otpResend', 'purposeTokenSession', 'registrationOracle', 'metricsAuth',
];

// --- Batch 2: vendors, plans, catalog, fulfilment, shipping, try-on, stock ---
const BATCH2 = [
  'vendorApprovalGate', 'vendorIsolation', 'vendorOriginGate', 'vendorVisibility', 'vendorShipping',
  'vendorSubscriptionLifecycle', 'planAccess', 'creatorProgram', 'storefrontPermission',
  'staffAuthStatus', 'staffManagementGate',
  'productModeration', 'productPriceValidation', 'productSearch', 'kentePieceSelling', 'reviewPurchaseGate',
  'deliveryResponsibility', 'shippingFees', 'tracking',
  'customRequestCheckout', 'customRequestCheckoutHandler',
  'exchangeRates', 'internationalCheckout', 'internationalCheckoutUnified', 'internationalFxThreshold', 'intlQuoteMatchesBooking',
  'stockIntegrity', 'stockLedger', 'stockRace', 'reservation',
  'tryOnFashnAdapter', 'tryOnGenerateFlow', 'tryOnHttp', 'tryOnJobRepository', 'tryOnProviderAdapter',
  'tryOnSsrf', 'tryOnUploadSecurity', 'uploadGate', 'uploadValidation', 'profileUploadStorage', 'storageS3',
];

const batch = String(process.argv[2] || '').trim();
if (!['1', '2', '3'].includes(batch)) {
  console.error('Usage: node scripts/test-batch.mjs 1|2|3');
  process.exit(2);
}

const allFiles = readdirSync(testsDir).filter((f) => f.endsWith('.test.js')).map((f) => f.replace(/\.test\.js$/, ''));
const inB1 = new Set(BATCH1);
const inB2 = new Set(BATCH2);
// Warn about any listed name that no longer exists (keeps the lists honest).
for (const [n, set] of [['1', BATCH1], ['2', BATCH2]]) {
  for (const name of set) if (!allFiles.includes(name)) console.warn(`  (batch ${n}: "${name}" has no matching test file)`);
}

let names;
if (batch === '1') names = BATCH1.filter((n) => allFiles.includes(n));
else if (batch === '2') names = BATCH2.filter((n) => allFiles.includes(n));
else names = allFiles.filter((n) => !inB1.has(n) && !inB2.has(n)); // Batch 3 = everything else

const files = names.map((n) => `tests/${n}.test.js`);
console.log(`\n▶ Test batch ${batch}: ${files.length} suites\n`);

const res = spawnSync(
  process.execPath,
  ['--import', './tests/helpers/testDbGuard.mjs', '--test', '--test-concurrency=2', ...files],
  { cwd: path.join(here, '..'), stdio: 'inherit' }
);
process.exit(res.status ?? 1);

// FILE: backend/controllers/tryOnController.js
// DESCRIPTION: AI Virtual Try-On HTTP handlers. Thin: all provider work is
//              behind Services/tryOn (adapter registry, job service, garment
//              resolver, private result store). See AI_TRYON_ARCHITECTURE.md.
//
// Trust model:
//   - modelImage is the customer's photo; it must arrive inline (data: URI)
//     and is decoded, magic-byte-checked, pixel-capped and re-encoded
//     (EXIF/GPS stripped) before it reaches any provider. It is never stored.
//   - the garment is NEVER client-supplied. The caller sends a productId; the
//     server resolves image/title/category/vendor from its own catalog row
//     (approved product, approved vendor, wearable, usable image). Any other
//     body field (garment image, vendor id, price, category) is ignored.
//   - jobs, their results and their status are owner-only; another user's
//     job id answers exactly like a missing one.

import expressAsyncHandler from "express-async-handler";
import { TryOnInputError } from "../utils/tryOnImage.js";
import { TryOnServiceError } from "../Services/tryOn/errors.js";
import { getProviderReadiness } from "../Services/tryOn/providers/index.js";
import { loadTryOnProduct } from "../Services/tryOn/garment.js";
import {
  createTryOnJob as createJob,
  getTryOnJobForUser,
  readTryOnResult,
  handleTryOnWebhook,
  toPublicJob,
} from "../Services/tryOn/tryOnJobService.js";

// Re-exported for the security suites, which drive these predicates directly.
export {
  assertFetchableImageUrl,
  loadTryOnProduct,
  resolveGarmentForTryOn,
} from "../Services/tryOn/garment.js";

/** New jobs are accepted only when the kill switch is on AND the configured
 *  provider passes its configuration checks. */
export const isTryOnEnabled = () => getProviderReadiness().ready;

/**
 * Answer a known try-on error with its own status and safe message. Errors
 * are answered here rather than thrown to errorMiddleware because that
 * replaces every 5xx message with a generic one, and "the provider is out of
 * capacity" (502/503/504) is information the customer needs.
 */
const sendKnownError = (res, err) => {
  if (err instanceof TryOnServiceError) {
    if (err.retryAfterSeconds) res.set("Retry-After", String(err.retryAfterSeconds));
    return res.status(err.httpStatus).json({ message: err.message, code: err.code });
  }
  if (err instanceof TryOnInputError) {
    return res.status(err.statusCode).json({ message: err.message });
  }
  return null;
};

const handled = (fn) => expressAsyncHandler(async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (sendKnownError(res, err) === null) throw err;
  }
});

/**
 * Public capability check so the UI can hide the try-on entry points.
 * GET /api/tryon/status
 */
export const status = expressAsyncHandler(async (_req, res) => {
  res.json({ enabled: isTryOnEnabled() });
});

/**
 * Can this product be tried on? Drives the product page's "Try It On" button
 * so an unsupported product is explained up front instead of failing after
 * the customer has uploaded a photo.
 * GET /api/tryon/product/:productId
 * 200 { productId, enabled, eligible, reason } — 404 when not visible.
 */
export const getProductTryOnEligibility = expressAsyncHandler(async (req, res) => {
  const enabled = isTryOnEnabled();
  try {
    const product = await loadTryOnProduct(req.params.productId);
    res.json({ productId: product.productId, enabled, eligible: true, reason: null });
  } catch (err) {
    if (!(err instanceof TryOnInputError)) throw err;
    if (err.statusCode === 422) {
      return res.json({
        productId: Number(req.params.productId),
        enabled,
        eligible: false,
        reason: err.message,
      });
    }
    res.status(err.statusCode);
    throw err;
  }
});

/**
 * Start a try-on for one product.
 * POST /api/tryon/jobs { productId, modelImage, consent: true, idempotencyKey }
 * 202 { job } when a job was created; 200 { job } when the idempotency key
 * was already used (the original job, nothing spent).
 */
export const createTryOnJob = handled(async (req, res) => {
  const { productId, modelImage, consent, idempotencyKey } = req.body || {};
  if (productId === undefined || productId === null || productId === "") {
    throw new TryOnInputError("productId is required");
  }
  if (!modelImage) throw new TryOnInputError("modelImage is required");
  const { job, created } = await createJob({
    userId: req.user.id,
    productId,
    modelImage,
    consent,
    idempotencyKey,
  });
  res.status(created ? 202 : 200).json({ job: toPublicJob(job) });
});

/**
 * Owner-only job status (reconciles with the provider when a poll is due).
 * GET /api/tryon/jobs/:id
 */
export const getTryOnJob = handled(async (req, res) => {
  const job = await getTryOnJobForUser(req.params.id, req.user.id);
  res.set("Cache-Control", "private, no-store");
  res.json({ job: toPublicJob(job) });
});

/**
 * Owner-only result image bytes.
 * GET /api/tryon/jobs/:id/result
 */
export const getTryOnJobResult = handled(async (req, res) => {
  const bytes = await readTryOnResult(req.params.id, req.user.id);
  res.set({
    "Content-Type": "image/jpeg",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  });
  res.status(200).send(bytes);
});

/**
 * Provider completion callback. Mounted with a raw body parser in server.js
 * (the signature covers the exact bytes). Unauthenticated by design; the
 * signature is the authentication.
 * POST /api/tryon/webhooks/:provider
 */
export const tryOnWebhook = expressAsyncHandler(async (req, res) => {
  const code = await handleTryOnWebhook(req.params.provider, req.body, req.headers);
  res.status(code).json({ received: code === 200 });
});

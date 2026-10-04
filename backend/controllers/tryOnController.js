// FILE: backend/controllers/tryOnController.js
// DESCRIPTION: AI Virtual Try-On controller - proxies to Replicate (IDM-VTON)

import axios from "axios";
import expressAsyncHandler from "express-async-handler";
import pool from "../config/db.js";
import { AI_TRYON_DAILY_LIMIT } from "../config/businessConfig.js";

// In-memory prediction store (simple; replace with DB in production)
const predictions = new Map();

const REPLICATE_API_URL = "https://api.replicate.com/v1";

// Bound the in-memory store so a flood of generate calls can never grow memory
// unbounded. Old entries are dropped after 2h and a hard FIFO cap is enforced.
const MAX_PREDICTIONS = 1000;
const PREDICTION_TTL_MS = 2 * 60 * 60 * 1000;
const prunePredictions = () => {
  const now = Date.now();
  for (const [id, p] of predictions) {
    if (now - p.createdAt > PREDICTION_TTL_MS) predictions.delete(id);
  }
  while (predictions.size > MAX_PREDICTIONS) {
    const oldest = predictions.keys().next().value;
    predictions.delete(oldest);
  }
};

// Atomically reserve one try-on credit for the user today. Returns true if the
// user is still under the daily limit, false if they are exhausted (i.e. it
// consumes the credit and reports spend. Never refunds on failed predictions -
// the credit is consumed the moment a model goes to run).
const reserveTryOnCredit = async (userId) => {
  const today = new Date().toISOString().slice(0, 10);
  await pool.execute(
    `INSERT INTO ai_tryon_usage (userId, usage_date, count)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE count = count + 1`,
    [userId, today]
  );
  const [[row]] = await pool.execute(
    `SELECT count FROM ai_tryon_usage WHERE userId = ? AND usage_date = ?`,
    [userId, today]
  );
  return (row?.count || 0) <= AI_TRYON_DAILY_LIMIT;
};

/**
 * Generate an AI virtual try-on
 * POST /api/tryon/generate
 * Body: { modelImage, garmentImage, garmentName, category }
 */
/** Feature flag: the AI try-on is OFF unless the operator has explicitly set
 *  AI_TRYON_ENABLED=true AND configured a token. This used to be enabled by
 *  default (the check was `!== 'false'`), which contradicted its own comment
 *  and meant any deployment that set a Replicate token silently started
 *  spending money on inference for anyone who signed up. */
export const isTryOnEnabled = () =>
  process.env.AI_TRYON_ENABLED === 'true' && !!process.env.REPLICATE_API_TOKEN;

/**
 * Validate an image reference before handing it to a third-party fetcher.
 *
 * Replicate resolves and downloads `human_img` / `garm_img` from THEIR network
 * position, so an unvalidated user-supplied URL turns this endpoint into
 * delegated SSRF: a caller could aim Replicate's fetcher at loopback, a cloud
 * metadata endpoint, or an internal-only service and read the response back
 * through the generated image.
 *
 * Two shapes are accepted:
 *   - `data:image/...;base64,...` - inline bytes, so there is no network fetch
 *     and therefore no SSRF. This is what the photo upload and camera capture
 *     produce, and the decoded size is capped below.
 *   - `https://<public host>/...` - a real URL, restricted to public hosts so
 *     it cannot resolve to loopback, RFC1918, CGNAT, or instance metadata.
 *
 * Product images legitimately come from the API's own upload host, so there is
 * no host allow-list by default; set AI_TRYON_ALLOWED_HOSTS to narrow it.
 */
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

const isPrivateHostname = (hostname) => {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  // Cloud instance metadata endpoints.
  if (h === "169.254.169.254" || h === "metadata.google.internal" || h === "metadata.goog") {
    return true;
  }
  // Any IPv6 literal, and any IPv4 literal. A hostname can be an IP without a
  // TLD, so these have to be rejected here rather than by the protocol check.
  if (h.includes(":")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 0 || a === 10 || a === 127) return true;        // 0/8, 10/8, 127/8
  if (a === 169 && b === 254) return true;                  // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;         // 172.16/12
  if (a === 192 && b === 168) return true;                  // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;        // 100.64/10 CGNAT
  return false;
};

const extraAllowedHosts = () =>
  (process.env.AI_TRYON_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

const assertFetchableImageUrl = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  if (value.startsWith("data:")) {
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
      throw new Error(`${field} must be a base64-encoded png, jpeg, webp or gif image`);
    }
    const approxBytes = Math.floor(((value.length - value.indexOf(",") - 1) * 3) / 4);
    if (approxBytes > MAX_INLINE_IMAGE_BYTES) {
      throw new Error(`${field} exceeds the 5MB inline image limit`);
    }
    return value;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid https URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${field} must be an https URL`);
  }
  if (url.username || url.password) {
    throw new Error(`${field} must not contain credentials`);
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error(`${field} must be a publicly reachable image URL`);
  }
  const allowed = extraAllowedHosts();
  if (allowed.length > 0 && !allowed.includes(url.hostname.toLowerCase())) {
    throw new Error(`${field} is not on the allowed host list`);
  }
  return url.toString();
};

/**
 * Public capability check so the UI can hide the try-on entry points when the
 * backend has not enabled the feature.
 * GET /api/tryon/status
 */
export const status = expressAsyncHandler(async (_req, res) => {
  res.json({ enabled: isTryOnEnabled() });
});

export const generateTryOn = expressAsyncHandler(async (req, res) => {
  const { modelImage, garmentImage, garmentName, category } = req.body;

  if (!isTryOnEnabled()) {
    res.status(503);
    throw new Error("AI try-on is not enabled. Configure REPLICATE_API_TOKEN / AI_TRYON_ENABLED.");
  }

  if (!modelImage || !garmentImage) {
    res.status(400);
    throw new Error("modelImage and garmentImage are required");
  }

  // Validate BEFORE reserving a credit, so a rejected SSRF attempt does not
  // burn one of the user's daily try-ons.
  let safeModelImage;
  let safeGarmentImage;
  try {
    safeModelImage = assertFetchableImageUrl(modelImage, "modelImage");
    safeGarmentImage = assertFetchableImageUrl(garmentImage, "garmentImage");
  } catch (err) {
    res.status(400);
    throw err;
  }

  // Enforce the per-user daily cost limit.
  const allowed = await reserveTryOnCredit(req.user.id);
  if (!allowed) {
    res.status(429);
    throw new Error(
      `You have reached the daily limit of ${AI_TRYON_DAILY_LIMIT} try-ons. Please try again tomorrow.`
    );
  }

  try {
    // Replicate IDM-VTON (cuuupid/idm-vton) virtual try-on.
    // NOTE: IDM-VTON is CC BY-NC-SA (non-commercial) - fine for dev/testing,
    // but for production either get a commercial license or swap providers.
    const replicateResp = await axios.post(
      `${REPLICATE_API_URL}/predictions`,
      {
        // Current latest version of cuuupid/idm-vton (verified live).
        version: "0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
        input: {
          human_img: safeModelImage,
          garm_img: safeGarmentImage,
          garment_des: garmentName || "Authentic Kente cloth",
          category: category || "upper_body",
          seed: Math.floor(Math.random() * 100000),
        },
      },
      {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const predictionId = replicateResp.data?.id;
    if (predictionId) {
      predictions.set(predictionId, {
        userId: req.user.id,
        status: "processing",
        url: `https://api.replicate.com/v1/predictions/${predictionId}`,
        output: null,
        createdAt: Date.now(),
      });
      prunePredictions();
      return res.status(202).json({
        status: "processing",
        predictionId,
        message: "Try-on is processing. Poll /api/tryon/status/:id for the result.",
      });
    }

    res.status(500);
    throw new Error("Replicate did not return a prediction id.");
  } catch (error) {
    console.error("Try-On generation error:", error.message);
    res.status(error.response?.status || 502);
    throw new Error(
      error.response?.data?.detail ||
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Failed to generate try-on. Please try again."
    );
  }
});

/**
 * Get try-on status
 * GET /api/tryon/status/:id
 */
export const getTryOnStatus = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const prediction = predictions.get(id);

  if (!prediction || prediction.userId !== req.user.id) {
    res.status(404);
    throw new Error("Prediction not found");
  }
  prunePredictions();

  try {
    // For Replicate predictions, fetch live status
    if (prediction.url && process.env.REPLICATE_API_TOKEN) {
      const statusResp = await axios.get(prediction.url, {
        headers: {
          Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
        },
        timeout: 30000,
      });

      const data = statusResp.data;
      const status = {
        status: data.status,
        output: data.output,
        message: data.status === "succeeded" ? "Try-on complete!" : undefined,
      };
      if (data.output) predictions.set(id, { ...prediction, status: "succeeded", output: data.output });
      return res.json(status);
    }

    // Fallback to stored status
    res.json({
      status: prediction.status || "processing",
      output: prediction.output,
    });
  } catch (error) {
    console.error("Try-On status error:", error.message);
    res.json({
      status: "processing",
      output: null,
      message: "Still processing...",
    });
  }
});

export default { generateTryOn, getTryOnStatus };

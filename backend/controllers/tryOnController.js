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
export const generateTryOn = expressAsyncHandler(async (req, res) => {
  const { modelImage, garmentImage, garmentName, category } = req.body;

  if (!modelImage || !garmentImage) {
    res.status(400);
    throw new Error("modelImage and garmentImage are required");
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
    if (!process.env.REPLICATE_API_TOKEN) {
      res.status(503);
      throw new Error(
        "AI try-on service is not configured. Set REPLICATE_API_TOKEN in the backend .env file."
      );
    }

    // Replicate IDM-VTON (cuuupid/idm-vton) virtual try-on.
    // NOTE: IDM-VTON is CC BY-NC-SA (non-commercial) - fine for dev/testing,
    // but for production either get a commercial license or swap providers.
    const replicateResp = await axios.post(
      `${REPLICATE_API_URL}/predictions`,
      {
        // Current latest version of cuuupid/idm-vton (verified live).
        version: "0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985",
        input: {
          human_img: modelImage,
          garm_img: garmentImage,
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

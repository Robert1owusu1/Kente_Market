import axios from "axios";

// Use the Vite proxy by default (empty base -> same origin, /api proxied to
// backend) so cookies work and it functions from LAN devices too.
const API_URL = import.meta.env.VITE_API_URL || "";

const tryOnService = {
  /**
   * Generate an AI virtual try-on using Replicate (IDM-VTON) via backend proxy
   * @param {string} modelImage - base64 or URL of the person's photo
   * @param {string} garmentImage - base64 or URL of the kente garment image
   * @param {string} garmentName - name/description of the garment
   * @param {string} category - optional category (e.g. "Kente Wraps")
   * @returns {Promise<{output: string}>} - generated try-on image URL
   */
  async generateTryOn(modelImage, garmentImage, garmentName, category = "") {
    try {
      const response = await axios.post(`${API_URL}/api/tryon/generate`, {
        modelImage,
        garmentImage,
        garmentName,
        category,
      }, {
        timeout: 120000,
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      console.error("AI Try-On generation error:", error);
      throw error;
    }
  },

  /**
   * Check try-on generation status
   * @param {string} predictionId - prediction ID from generateTryOn
   * @returns {Promise<object>} - prediction status
   */
  async getTryOnStatus(predictionId) {
    try {
      const response = await axios.get(`${API_URL}/api/tryon/status/${predictionId}`, {
        timeout: 30000,
        withCredentials: true,
      });
      return response.data;
    } catch (error) {
      console.error("Try-On status check error:", error);
      throw error;
    }
  },

  /**
   * Poll until the try-on is ready
   * @param {string} predictionId
   * @param {number} intervalMs
   * @param {number} maxAttempts
   * @returns {Promise<string>} - output image URL
   */
  async pollForResult(predictionId, intervalMs = 5000, maxAttempts = 24) {
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      const status = await this.getTryOnStatus(predictionId);
      if (status.status === "succeeded") {
        return status.output;
      }
      if (status.status === "failed") {
        throw new Error("AI try-on generation failed. Please try again.");
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error("Try-on generation timed out. Please try again.");
  },
};

export default tryOnService;

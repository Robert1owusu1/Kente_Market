// middleware/asyncHandler.js - COMPLETE VERSION
/**
 * Async Handler - Wraps async route handlers to catch errors
 * This eliminates the need for try-catch blocks in every async function
 * 
 * @param {Function} fn - Async function to wrap
 * @returns {Function} - Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
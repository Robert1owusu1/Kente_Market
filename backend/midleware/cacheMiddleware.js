// FILE LOCATION: middleware/cacheMiddleware.js
// DESCRIPTION: Node-cache middleware for API response caching

import NodeCache from 'node-cache';

// Create cache instance
const cache = new NodeCache({ 
  stdTTL: 300, // Default TTL: 5 minutes
  checkperiod: 60, // Check for expired keys every 60 seconds
  useClones: false // Better performance, don't clone objects
});

/**
 * Cache middleware for GET requests
 * @param {number} duration - Cache duration in seconds
 */
export const cacheMiddleware = (duration = 300) => {
  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Include user ID in cache key for user-specific data
    const userKey = req.user ? `_user_${req.user.id}` : '';
    const key = `cache_${req.originalUrl || req.url}${userKey}`;
    const cachedResponse = cache.get(key);

    if (cachedResponse) {
      console.log(`✅ Cache hit: ${key}`);
      return res.json(cachedResponse);
    }

    console.log(`⚠️ Cache miss: ${key}`);
    
    // Override res.json to cache the response
    const originalJson = res.json.bind(res);
    
    res.json = (body) => {
      cache.set(key, body, duration);
      return originalJson(body);
    };

    next();
  };
};

/**
 * Clear cache by pattern
 * @param {string} pattern - Pattern to match cache keys
 */
export const clearCache = (pattern) => {
  const keys = cache.keys();
  let cleared = 0;
  
  keys.forEach(key => {
    if (key.includes(pattern)) {
      cache.del(key);
      cleared++;
    }
  });
  
  console.log(`🗑️ Cleared ${cleared} cache entries matching: ${pattern}`);
  return cleared;
};

/**
 * Clear all cache
 */
export const clearAllCache = () => {
  cache.flushAll();
  console.log('🗑️ All cache cleared');
};

/**
 * Get cache statistics
 */
export const getCacheStats = () => {
  return cache.getStats();
};

export default cache;
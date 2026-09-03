import Promotion from '../models/promotionModel.js';

// GET /api/promotions — admin: list all (including expired)
export const listPromotions = async (req, res) => {
  try {
    const promotions = await Promotion.findAll({ includeExpired: true, ...req.query });
    res.json(promotions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/promotions/public — public: active, non-expired banners for hero
export const getActiveBanners = async (req, res) => {
  try {
    const promotions = await Promotion.findActiveForDisplay({ type: 'banner', limit: 10 });
    res.json(promotions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/promotions/public/popups — public: active popups by priority
export const getActivePopups = async (req, res) => {
  try {
    const promotions = await Promotion.findActiveForDisplay({ type: 'popup', limit: 3 });
    res.json(promotions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/promotions/public/all — public: all active content (banners + popups + events)
export const getActivePromotions = async (req, res) => {
  try {
    const promotions = await Promotion.findActiveForDisplay({ limit: 20 });
    res.json(promotions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/promotions/:id
export const getPromotion = async (req, res) => {
  try {
    const promotion = await Promotion.findById(req.params.id);
    if (!promotion) return res.status(404).json({ message: 'Promotion not found' });
    res.json(promotion);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/promotions
export const createPromotion = async (req, res) => {
  try {
    if (!req.body.title) return res.status(400).json({ message: 'Title is required' });
    const promotion = await Promotion.create(req.body);
    res.status(201).json(promotion);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/promotions/:id
export const updatePromotion = async (req, res) => {
  try {
    const promotion = await Promotion.update(req.params.id, req.body);
    res.json(promotion);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/promotions/:id
export const deletePromotion = async (req, res) => {
  try {
    const deleted = await Promotion.delete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Promotion not found' });
    res.json({ message: 'Promotion deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

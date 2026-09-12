// controllers/suggestionController.js
// Customer-facing suggestion box; the main admin reads them and ticks them done.
import Suggestion from '../models/suggestionModel.js';
import isValidId from '../utils/isValidId.js';

// @desc    Customer submits a suggestion
// @route   POST /api/suggestions
// @access  Private
export const createSuggestion = async (req, res) => {
  try {
    const { subject, body } = req.body || {};
    if (!subject || !body || !String(subject).trim() || !String(body).trim()) {
      return res.status(400).json({ message: 'Subject and suggestion are required' });
    }
    if (String(subject).trim().length > 255) {
      return res.status(400).json({ message: 'Subject must be 255 characters or less' });
    }
    if (String(body).trim().length > 5000) {
      return res.status(400).json({ message: 'Suggestion must be 5000 characters or less' });
    }

    const suggestion = await Suggestion.create({
      userId: req.user.id,
      subject: String(subject).trim(),
      body: String(body).trim(),
    });

    res.status(201).json({ message: 'Suggestion sent to admin', suggestion });
  } catch (error) {
    console.error('createSuggestion error:', error);
    res.status(500).json({ message: 'Failed to send suggestion' });
  }
};

// @desc    Suggestions the signed-in user has submitted
// @route   GET /api/suggestions/me
// @access  Private
export const getMySuggestions = async (req, res) => {
  try {
    const rows = await Suggestion.findByUser(req.user.id);
    res.json(rows);
  } catch (error) {
    console.error('getMySuggestions error:', error);
    res.status(500).json({ message: 'Failed to fetch suggestions' });
  }
};

// @desc    All suggestions (main admin)
// @route   GET /api/suggestions/all
// @access  Private (admin)
export const getAllSuggestions = async (req, res) => {
  try {
    const rows = await Suggestion.findAll();
    res.json(rows);
  } catch (error) {
    console.error('getAllSuggestions error:', error);
    res.status(500).json({ message: 'Failed to fetch suggestions' });
  }
};

// @desc    Admin updates a suggestion's status (e.g. mark done)
// @route   PUT /api/suggestions/:id/status
// @access  Private (admin)
export const updateSuggestionStatus = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid suggestion id' });
    }
    const { status } = req.body || {};
    const validStatuses = ['new', 'in_review', 'done'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const suggestion = await Suggestion.updateStatus(req.params.id, status);
    if (!suggestion) return res.status(404).json({ message: 'Suggestion not found' });

    res.json({ message: 'Suggestion status updated', suggestion });
  } catch (error) {
    console.error('updateSuggestionStatus error:', error);
    res.status(500).json({ message: 'Failed to update suggestion' });
  }
};
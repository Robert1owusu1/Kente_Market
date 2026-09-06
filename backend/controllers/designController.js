// controllers/designController.js
import Design from "../models/designModel.js";
import isValidId from "../utils/isValidId.js";

export const createDesign = async (req, res) => {
  try {
    const { name, description, image, config, productId } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Design name is required" });
    }
    const design = await Design.create(req.user.id, {
      name: String(name).trim(),
      description,
      image,
      config,
      productId,
    });
    res.status(201).json({ message: "Design saved", design });
  } catch (error) {
    console.error("createDesign error:", error.message);
    res.status(500).json({ message: "Failed to save design" });
  }
};

export const getMyDesigns = async (req, res) => {
  try {
    const designs = await Design.findAllByUser(req.user.id);
    res.json(designs);
  } catch (error) {
    console.error("getMyDesigns error:", error.message);
    res.status(500).json({ message: "Failed to fetch designs" });
  }
};

export const updateDesign = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid design id" });
    }
    const { name, description, image, config, productId } = req.body || {};
    const updated = await Design.update(req.user.id, parseInt(req.params.id), {
      name,
      description,
      image,
      config,
      productId,
    });
    if (!updated) {
      return res.status(404).json({ message: "Design not found" });
    }
    res.json({ message: "Design updated", design: updated });
  } catch (error) {
    console.error("updateDesign error:", error.message);
    res.status(500).json({ message: "Failed to update design" });
  }
};

export const deleteDesign = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid design id" });
    }
    const removed = await Design.remove(req.user.id, parseInt(req.params.id));
    if (!removed) {
      return res.status(404).json({ message: "Design not found" });
    }
    res.json({ message: "Design deleted" });
  } catch (error) {
    console.error("deleteDesign error:", error.message);
    res.status(500).json({ message: "Failed to delete design" });
  }
};

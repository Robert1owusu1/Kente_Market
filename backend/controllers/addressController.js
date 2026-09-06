// controllers/addressController.js
import Address from "../models/addressModel.js";
import isValidId from "../utils/isValidId.js";

export const createAddress = async (req, res) => {
  try {
    const { label, fullName, phone, addressLine1, addressLine2, city, state, zipCode, country, isDefault } = req.body || {};
    if (!fullName || !addressLine1 || !city) {
      return res.status(400).json({ message: "Full name, address line and city are required" });
    }
    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }
    const address = await Address.create(req.user.id, {
      label, fullName, phone, addressLine1, addressLine2, city, state, zipCode, country, isDefault,
    });
    res.status(201).json({ message: "Address added", address });
  } catch (error) {
    console.error("createAddress error:", error.message);
    res.status(500).json({ message: "Failed to add address" });
  }
};

export const getMyAddresses = async (req, res) => {
  try {
    const addresses = await Address.findAllByUser(req.user.id);
    res.json(addresses);
  } catch (error) {
    console.error("getMyAddresses error:", error.message);
    res.status(500).json({ message: "Failed to fetch addresses" });
  }
};

export const updateAddress = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid address id" });
    }
    const { label, fullName, phone, addressLine1, addressLine2, city, state, zipCode, country, isDefault } = req.body || {};
    const updated = await Address.update(req.user.id, parseInt(req.params.id), {
      label, fullName, phone, addressLine1, addressLine2, city, state, zipCode, country, isDefault,
    });
    if (!updated) {
      return res.status(404).json({ message: "Address not found" });
    }
    res.json({ message: "Address updated", address: updated });
  } catch (error) {
    console.error("updateAddress error:", error.message);
    res.status(500).json({ message: "Failed to update address" });
  }
};

export const deleteAddress = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid address id" });
    }
    const removed = await Address.remove(req.user.id, parseInt(req.params.id));
    if (!removed) {
      return res.status(404).json({ message: "Address not found" });
    }
    res.json({ message: "Address deleted" });
  } catch (error) {
    console.error("deleteAddress error:", error.message);
    res.status(500).json({ message: "Failed to delete address" });
  }
};

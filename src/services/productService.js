// FILE: frontend/src/services/productService.js
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Create axios instance with default config
const axiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // For cookies/auth
});

// Product API Service
const productService = {
  // Get all products with filters
  getAllProducts: async (params = {}) => {
    try {
      const response = await axiosInstance.get('/products', { params });
      return response.data;
    } catch (error) {
      console.error('Error fetching products:', error);
      throw error;
    }
  },

  // Get featured products for TopProducts component
  getFeaturedProducts: async (limit = 6) => {
    try {
      const response = await axiosInstance.get('/products/featured', {
        params: { limit }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching featured products:', error);
      throw error;
    }
  },

  // Get trending products for TrendingProducts component
  getTrendingProducts: async (limit = 5) => {
    try {
      const response = await axiosInstance.get('/products/trending', {
        params: { limit }
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching trending products:', error);
      throw error;
    }
  },

  // Get product by ID
  getProductById: async (id) => {
    try {
      const response = await axiosInstance.get(`/products/${id}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching product:', error);
      throw error;
    }
  },

  // Get products by category
  getProductsByCategory: async (category, params = {}) => {
    try {
      const response = await axiosInstance.get(`/products/category/${category}`, {
        params
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching products by category:', error);
      throw error;
    }
  },

  // Get all categories
  getCategories: async () => {
    try {
      const response = await axiosInstance.get('/products/categories/list');
      return response.data;
    } catch (error) {
      console.error('Error fetching categories:', error);
      throw error;
    }
  },
};

export default productService;
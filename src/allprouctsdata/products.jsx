// src/data/products.js
import img7 from "../assets/shirt/shirt.png"
import img1 from "../assets/women/women.png"
import img2 from "../assets/women/women2.jpg"
import img3 from"../assets/women/women3.jpg"
import img4 from"../assets/women/women4.jpg"
import img5 from"../assets/women/women5.jpg"

export const SAMPLE_PRODUCTS = [
  {
    id: 1,
    img: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=500&fit=crop",
    title: "Premium Cotton T-Shirt",
    rating: 4.8,
    price: 25,
    originalPrice: 35,
    color: "White",
    category: "T-Shirts",
    sizes: ["S", "M", "L", "XL"],
    printType: "Screen Print",
    material: "100% Cotton",
    reviews: 124,
    isCustomizable: true,
    colors: ["white", "black", "navy", "gray"],
    tag: "Best Seller",
    colorsAvailable: ["white", "black", "navy", "gray"],
    fabricType: "100% Cotton",
    productionTime: 3,
    featured: true,
    basePrice: 25
  },
  {
    id: 2,
    img: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=500&fit=crop",
    title: "Classic Hoodie",
    rating: 4.9,
    price: 55,
    originalPrice: 65,
    color: "Navy",
    category: "Hoodies", 
    sizes: ["S", "M", "L", "XL", "XXL"],
    printType: "Embroidery",
    material: "Cotton Blend",
    reviews: 89,
    isCustomizable: true,
    colors: ["navy", "black", "gray", "burgundy"],
    tag: "New",
    colorsAvailable: ["navy", "black", "gray", "burgundy"],
    fabricType: "Cotton Blend",
    productionTime: 4,
    featured: true,
    basePrice: 55
  },
  {
    id: 3,
    img: "https://images.unsplash.com/photo-1583743814966-8936f37f3ef3?w=400&h=500&fit=crop",
    title: "Summer Tank Top",
    rating: 4.6,
    price: 20,
    color: "Pink",
    category: "Tank Tops",
    sizes: ["XS", "S", "M", "L"],
    printType: "Vinyl",
    material: "Cotton",
    reviews: 67,
    isCustomizable: true,
    colors: ["pink", "white", "mint", "coral"],
    colorsAvailable: ["pink", "white", "mint", "coral"],
    fabricType: "Cotton",
    productionTime: 2,
    featured: false,
    basePrice: 20
  },
  {
    id: 4,
    img: "https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=400&h=500&fit=crop",
    title: "Long Sleeve Shirt",
    rating: 4.7,
    price: 32,
    color: "Gray",
    category: "Long Sleeves",
    sizes: ["S", "M", "L", "XL"],
    printType: "Heat Transfer",
    material: "Cotton Blend", 
    reviews: 45,
    isCustomizable: true,
    colors: ["gray", "white", "black", "navy"],
    colorsAvailable: ["gray", "white", "black", "navy"],
    fabricType: "Cotton Blend",
    productionTime: 3,
    featured: true,
    basePrice: 32
  },
  {
    id: 5,
    img: "https://images.unsplash.com/photo-1562157873-818bc0726f68?w=400&h=500&fit=crop",
    title: "Polo Shirt",
    rating: 4.5,
    price: 38,
    color: "Blue",
    category: "Polo Shirts",
    sizes: ["S", "M", "L", "XL", "XXL"],
    printType: "Embroidery",
    material: "Pique Cotton",
    reviews: 78,
    isCustomizable: true,
    colors: ["blue", "white", "black", "red"],
    tag: "Popular",
    colorsAvailable: ["blue", "white", "black", "red"],
    fabricType: "Pique Cotton",
    productionTime: 4,
    featured: true,
    basePrice: 38
  },
  {
    id: 6,
    img: "https://images.unsplash.com/photo-1586790170083-2f9ceadc732d?w=400&h=500&fit=crop",
    title: "Vintage Tee",
    rating: 4.8,
    price: 28,
    color: "Burgundy",
    category: "T-Shirts",
    sizes: ["S", "M", "L", "XL"],
    printType: "Screen Print",
    material: "Vintage Cotton",
    reviews: 156,
    isCustomizable: true,
    colors: ["burgundy", "olive", "navy", "charcoal"],
    colorsAvailable: ["burgundy", "olive", "navy", "charcoal"],
    fabricType: "Vintage Cotton",
    productionTime: 3,
    featured: true,
    basePrice: 28
  },
  {
    id: 7,
    img: img7,
    title: "Cotton T-Shirt",
    rating: 4.8,
    price: 29,
    originalPrice: 35,
    color: "black",
    category: "T-Shirts",
    sizes: ["S", "M", "L", "XL"],
    printType: "Screen Print",
    material: "100% Cotton",
    reviews: 109,
    isCustomizable: true,
    colors: ["white", "black", "navy", "gray"],
    tag: "Best Seller",
    colorsAvailable: ["white", "black", "navy", "gray"],
    fabricType: "100% Cotton",
    productionTime: 3,
    featured: true,
    basePrice: 29
  },
  // NEW PRODUCTS USING LOCAL IMAGES
  {
    id: 8,
    img: img1,
    title: "Women Ethnic Dress",
    rating: 5.0,
    price: 150,
    originalPrice: 180,
    color: "White",
    category: "Women's Fashion",
    sizes: ["S", "M", "L", "XL"],
    printType: "Embroidery",
    material: "Cotton Blend",
    reviews: 98,
    isCustomizable: true,
    colors: ["white", "cream", "ivory", "beige"],
    tag: "Trending",
    colorsAvailable: ["white", "cream", "ivory", "beige"],
    fabricType: "Cotton Blend",
    productionTime: 5,
    featured: true,
    basePrice: 150
  },
  {
    id: 9,
    img: img2,
    title: "Women Western Style",
    rating: 4.5,
    price: 200,
    originalPrice: 250,
    color: "Red",
    category: "Women's Fashion",
    sizes: ["S", "M", "L", "XL"],
    printType: "Digital Print",
    material: "Polyester Blend",
    reviews: 76,
    isCustomizable: true,
    colors: ["red", "blue", "green", "purple"],
    tag: "Hot",
    colorsAvailable: ["red", "blue", "green", "purple"],
    fabricType: "Polyester Blend",
    productionTime: 4,
    featured: false,
    basePrice: 200
  },
  {
    id: 10,
    img: img3,
    title: "Stylish Goggles",
    rating: 4.7,
    price: 190,
    originalPrice: 220,
    color: "Brown",
    category: "Accessories",
    sizes: ["S", "M", "L", "XL"],
    printType: "None",
    material: "Plastic/Metal",
    reviews: 134,
    isCustomizable: false,
    colors: ["brown", "black", "gold", "silver"],
    tag: "Summer",
    colorsAvailable: ["brown", "black", "gold", "silver"],
    fabricType: "Plastic/Metal",
    productionTime: 1,
    featured: true,
    basePrice: 190
  },
  {
    id: 11,
    img: img4,
    title: "Printed Fashion T-Shirt",
    rating: 4.5,
    price: 120,
    originalPrice: 150,
    color: "Yellow",
    category: "T-Shirts",
    sizes: ["S", "M", "L", "XL", "XXL"],
    printType: "Screen Print",
    material: "100% Cotton",
    reviews: 89,
    isCustomizable: true,
    colors: ["yellow", "white", "black", "pink"],
    tag: "Colorful",
    colorsAvailable: ["yellow", "white", "black", "pink"],
    fabricType: "100% Cotton",
    productionTime: 2,
    featured: true,
    basePrice: 120
  },
  {
    id: 12,
    img: img5,
    title: "Fashion Women's T-Shirt",
    rating: 4.5,
    price: 100,
    originalPrice: 130,
    color: "Pink",
    category: "T-Shirts",
    sizes: ["XS", "S", "M", "L", "XL"],
    printType: "Heat Transfer",
    material: "Cotton Blend",
    reviews: 67,
    isCustomizable: true,
    colors: ["pink", "white", "lavender", "mint"],
    tag: "Cute",
    colorsAvailable: ["pink", "white", "lavender", "mint"],
    fabricType: "Cotton Blend",
    productionTime: 2,
    featured: true,
    basePrice: 100
  }
];

// Helper functions for different components
export const getFeaturedProducts = (limit= 20) => {
  return SAMPLE_PRODUCTS.filter(product => product.featured).slice(0, limit);
};

export const getProductsByCategory = (category) => {
  return SAMPLE_PRODUCTS.filter(product => product.category === category);
};

export const getProductById = (id) => {
  return SAMPLE_PRODUCTS.find(product => product.id === id);
};

// Get trending/popular products (high ratings or special tags)
export const getTrendingProducts = (limit = 5) => {
  return SAMPLE_PRODUCTS.filter(product => 
    product.rating >= 4.7 || 
    ["Trending", "Hot", "Best Seller", "Popular"].includes(product.tag)
  ).slice(0, limit);
};
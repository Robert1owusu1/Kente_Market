-- Create database
CREATE DATABASE IF NOT EXISTS branding_house;
USE branding_house;

-- Users table
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  firstName VARCHAR(100) NOT NULL,
  lastName VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  zipCode VARCHAR(20),
  country VARCHAR(100),
  role ENUM('customer', 'admin') DEFAULT 'customer',
  isActive BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE product (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  img VARCHAR(500) NOT NULL,
  rating DECIMAL(2,1) DEFAULT 0,
  price DECIMAL(10,2) NOT NULL,
  originalPrice DECIMAL(10,2),
  color VARCHAR(100),
  category VARCHAR(100) NOT NULL,
  sizes JSON,
  printType VARCHAR(100),
  material VARCHAR(100),
  reviews INT DEFAULT 0,
  isCustomizable BOOLEAN DEFAULT false,
  colors JSON,
  tag VARCHAR(100),
  fabricType VARCHAR(100),
  productionTime INT DEFAULT 1,
  featured BOOLEAN DEFAULT false,
  basePrice DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Orders table (after users & product exist)
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  orderNumber VARCHAR(100) UNIQUE NOT NULL,
  items JSON NOT NULL,
  totalAmount DECIMAL(10,2) NOT NULL,
  shippingAddress JSON,
  billingAddress JSON,
  paymentMethod VARCHAR(50) DEFAULT 'pending',
  paymentStatus ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
  orderStatus ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
  shippingCost DECIMAL(10,2) DEFAULT 0,
  tax DECIMAL(10,2) DEFAULT 0,
  discount DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
 
select * from product;


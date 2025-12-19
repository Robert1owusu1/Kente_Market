// seeder.js
import dotenv from "dotenv";
import colors from "colors";
import mysql from "mysql2/promise";

import users from "./data/user.js";
//import products from "./data/products.js";
import User from "./models/usersModel.js";
import Product from "./models/productModel.js";
import Order from "./models/orderModel.js"; // you’ll need similar class
import {connectDB} from "./config/db.js";

dotenv.config();

const clearAllTables = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  try {
    await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
    await connection.execute("TRUNCATE TABLE orders");
    await connection.execute("TRUNCATE TABLE products");
    await connection.execute("TRUNCATE TABLE users");
    await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
    console.log("🗑️ Tables cleared!".yellow);
  } finally {
    await connection.end();
  }
};

const importData = async () => {
  try {
    await connectDB();

    console.log("Clearing old data...".yellow);
    await clearAllTables();

    console.log("Importing users...".cyan);
    const createdUsers = [];
    for (const u of users) {
      const newUser = await User.create(u);
      createdUsers.push(newUser);
    }
    const adminUser = createdUsers[0].id;

    console.log("Importing products...".cyan);
    for (const p of products) {
      await Product.create({ ...p, userId: adminUser });
    }

    console.log("✅ Data Imported!".green.inverse);
    process.exit();
  } catch (error) {
    console.error(`❌ Import Error: ${error.message}`.red.inverse);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await connectDB();
    await clearAllTables();
    console.log("🗑️ Data Destroyed!".red.inverse);
    process.exit();
  } catch (error) {
    console.error(`❌ Destroy Error: ${error.message}`.red.inverse);
    process.exit(1);
  }
};

// CLI handler
if (process.argv[2] === "-d") {
  destroyData();
} else if (process.argv[2] === "-i") {
  importData();
} else {
  console.log(`
Usage:
  node seeder.js -i    Import data
  node seeder.js -d    Destroy data
  `.cyan);
}

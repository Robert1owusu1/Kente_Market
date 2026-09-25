// seeder.js
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { mysqlTls } from "./config/mysqlTls.js";

import users from "./data/user.js";
import products from "./data/products.js";
import User from "./models/usersModel.js";
import Product from "./models/productModel.js";
import Order from "./models/orderModel.js"; // you’ll need similar class
import {connectDB} from "./config/db.js";

dotenv.config();

// Destructive scripts (truncate/drop) must never run against production
// without an explicit, separate opt-in — a mis-pointed .env or an accidental
// `npm run data:destroy` would otherwise wipe the live database.
const refuseIfProduction = (what) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DESTRUCTIVE_DB !== '1') {
    console.error(
      `❌ Refusing to ${what}: NODE_ENV=production. ` +
      `If this is truly intended, re-run with ALLOW_DESTRUCTIVE_DB=1.`
    );
    process.exit(1);
  }
};

const clearAllTables = async () => {
  refuseIfProduction('truncate live tables');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: mysqlTls(),
  });

  try {
    await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
    await connection.execute("TRUNCATE TABLE orders");
    await connection.execute("TRUNCATE TABLE escrow_allocations");
    await connection.execute("TRUNCATE TABLE vendors");
    await connection.execute("TRUNCATE TABLE product");
    await connection.execute("TRUNCATE TABLE users");
    await connection.execute("TRUNCATE TABLE settings");
    await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
    console.log("🗑️ Tables cleared!");
  } finally {
    await connection.end();
  }
};

const importData = async () => {
  try {
    // The seed admin's password comes from the environment, never from the
    // repo (the old hardcoded credential was a standing default-account risk).
    if (!users.some((u) => u.password)) {
      console.error(
        "❌ SEED_ADMIN_PASSWORD is not set.\n" +
        "   Run with e.g.  SEED_ADMIN_PASSWORD=<strong-password> node seeder.js -i\n" +
        "   or create the first admin interactively with:  npm run setup-admin"
      );
      process.exit(1);
    }
    await connectDB();

    console.log("Clearing old data...");
    await clearAllTables();

    console.log("Importing users...");
    const createdUsers = [];
    for (const u of users) {
      const newUser = await User.create(u);
      createdUsers.push(newUser);
    }
    const adminUser = createdUsers[0].id;

    console.log("Importing products...");
    for (const p of products) {
      await Product.create({ ...p, userId: adminUser });
    }

    console.log("✅ Data Imported!");
    process.exit();
  } catch (error) {
    console.error(`❌ Import Error: ${error.message}`);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await connectDB();
    await clearAllTables();
    console.log("🗑️ Data Destroyed!");
    process.exit();
  } catch (error) {
    console.error(`❌ Destroy Error: ${error.message}`);
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
  node seeder.js -i    Import data (requires SEED_ADMIN_PASSWORD in the env)
  node seeder.js -d    Destroy data (refused when NODE_ENV=production
                       unless ALLOW_DESTRUCTIVE_DB=1)
  `);
}

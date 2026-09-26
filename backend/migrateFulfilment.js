// FILE LOCATION: backend/migrateFulfilment.js
// DESCRIPTION: Fulfilment scorecard backfill (idempotent, additive — never
//              drops or rewrites existing data).
//   - orders.deliveredAt: orders flipped to 'delivered' through the generic
//     PUT /api/orders/:id path before the dedicated delivered endpoints
//     existed kept deliveredAt NULL. The vendor on-time scorecard needs it
//     (and order history should show when the buyer received the goods), so
//     backfill from the best record we have: the last time the row changed,
//     else its creation time.
//   - expectedCompletionDate is deliberately NOT invented. Only orders that
//     genuinely carried a promised deadline feed the on-time rate; making one
//     up would fabricate "on time"/"late" facts about past deliveries.
// Run from backend/:  node migrateFulfilment.js
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { mysqlTls } from './config/mysqlTls.js';

dotenv.config();

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  ssl: mysqlTls(),
  multipleStatements: true,
});

try {
  const [result] = await connection.execute(
    `UPDATE orders
        SET deliveredAt = COALESCE(updated_at, created_at)
      WHERE orderStatus = 'delivered'
        AND deliveredAt IS NULL`
  );
  console.log(`✅ Backfilled deliveredAt on ${result.affectedRows} delivered order(s)`);
} finally {
  await connection.end();
}

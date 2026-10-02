// backend/migrateProductSearch.js
// P1: full-text product search. Prefers one composite FULLTEXT index; on
// engines that only allow single-column FULLTEXT (this TiDB), falls back to
// one index per column and multi-MATCH queries. Total failure is non-fatal:
// Product.findAll falls back to LIKE when MATCH fails at query time.
// Idempotent: safe to run more than once.
import pool from './config/db.js';

const COLUMNS = ['title', 'description', 'patternName', 'patternMeaning', 'culturalSignificance', 'tag', 'category'];

const hasIndex = async (name) => {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product' AND INDEX_NAME = ?`,
    [name]
  );
  return Number(row.n) > 0;
};

const run = async () => {
  if (await hasIndex('ft_product_search')) {
    console.log(' ft_product_search already exists');
    return;
  }
  try {
    await pool.execute(
      `CREATE FULLTEXT INDEX ft_product_search ON product (${COLUMNS.join(', ')})`
    );
    console.log(' Added composite ft_product_search FULLTEXT index');
    return;
  } catch (err) {
    console.warn(` Composite FULLTEXT unavailable (${err.message}); trying per-column indexes`);
  }
  for (const col of COLUMNS) {
    const name = `ft_product_${col}`;
    try {
      if (await hasIndex(name)) {
        console.log(` ${name} already exists`);
        continue;
      }
      await pool.execute(`CREATE FULLTEXT INDEX ${name} ON product (${col})`);
      console.log(` Added ${name}`);
    } catch (err) {
      console.warn(` Skipping ${name}: ${err.message}`);
    }
  }
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(' Migration failed:', err.message);
    process.exit(1);
  });

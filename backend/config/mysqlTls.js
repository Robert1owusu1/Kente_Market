// config/mysqlTls.js
// Shared TLS option builder for connecting to managed/cloud MySQL that REQUIRES
// TLS (e.g. TiDB Serverless, AWS RDS, DigitalOcean managed databases).
//   DB_SSL=1    -> TLS enabled, certificate NOT verified (cloud quick-start)
//   DB_SSL_CA=  -> TLS enabled and verified against the given CA file (production)
// When neither is set, TLS stays off for plain local MySQL (no behavior change).
import fs from 'fs';

export const mysqlTls = () => {
  if (process.env.DB_SSL !== '1' && process.env.DB_SSL !== 'true') return undefined;
  if (process.env.DB_SSL_CA) {
    try {
      return { ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf8'), rejectUnauthorized: true };
    } catch (err) {
      console.warn(
        `⚠️  DB_SSL_CA could not be read (${process.env.DB_SSL_CA}): ${err.message} — falling back to unverified TLS`
      );
    }
  }
  return { rejectUnauthorized: false };
};
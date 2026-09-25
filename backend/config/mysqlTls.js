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
      // A configured-but-unreadable CA means the operator INTENDED verified
      // TLS. Silently falling back to rejectUnauthorized:false would downgrade
      // production DB traffic to an unverifiable MITM-able connection on a typo
      // — fail closed instead so the misconfiguration is fixed, not masked.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `DB_SSL_CA could not be read (${process.env.DB_SSL_CA}): ${err.message} — ` +
          `refusing to start with unverified TLS in production. Fix the path or unset DB_SSL_CA.`
        );
      }
      console.warn(
        `⚠️  DB_SSL_CA could not be read (${process.env.DB_SSL_CA}): ${err.message} — falling back to unverified TLS (dev only)`
      );
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn(
      '⚠️  DB_SSL=1 without DB_SSL_CA: TLS is enabled but certificates are NOT verified. Set DB_SSL_CA for production.'
    );
  }
  return { rejectUnauthorized: false };
};
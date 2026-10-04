// config/mysqlTls.js
// Shared TLS option builder for connecting to managed/cloud MySQL that REQUIRES
// TLS (e.g. TiDB Serverless, AWS RDS, DigitalOcean managed databases).
//   DB_SSL=1    -> TLS enabled, certificate NOT verified (dev quick-start only)
//   DB_SSL_CA=<path> -> TLS enabled AND verified against that CA (production)
//   DB_SSL_ALLOW_UNVERIFIED=1 -> explicit opt-in to unverified TLS in production
// When DB_SSL is unset, TLS stays off for plain local MySQL (no behavior change).
// In production, DB_SSL=1 with no CA now refuses to start unless
// DB_SSL_ALLOW_UNVERIFIED=1 is set.
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
`DB_SSL_CA could not be read (${process.env.DB_SSL_CA}): ${err.message} — falling back to unverified TLS (dev only)`
      );
    }
  } else if (process.env.NODE_ENV === 'production') {
    // DB_SSL=1 with no CA means TLS without certificate verification, i.e. a
    // MITM-able channel carrying DB credentials, password hashes and vendor
    // bank/momo details. This used to only log a warning and connect anyway.
    if (process.env.DB_SSL_ALLOW_UNVERIFIED === '1') {
      console.warn(
        'DB_SSL_ALLOW_UNVERIFIED=1: connecting WITHOUT certificate verification. This is MITM-able.'
      );
    } else {
      throw new Error(
        'DB_SSL=1 without DB_SSL_CA would connect without certificate verification, which is ' +
        'MITM-able and carries DB credentials, password hashes and vendor payout details. Set ' +
        'DB_SSL_CA to your provider CA file, or set DB_SSL_ALLOW_UNVERIFIED=1 to accept the risk.'
      );
    }
  }
  return { rejectUnauthorized: false };
};
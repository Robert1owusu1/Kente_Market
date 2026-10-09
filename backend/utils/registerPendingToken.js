// FILE LOCATION: backend/utils/registerPendingToken.js
// DESCRIPTION: V-10 residual CLOSED — the registration reply must be
//              byte-identical whether or not the address was taken, so it
//              can no longer carry a session (issuing one only on the
//              "new address" branch would put the oracle in Set-Cookie).
//
// What replaces it: a short-lived, purpose-bound token handed out on BOTH
// branches. It authenticates the verification phase (`/verify-email`,
// `/resend-otp`, `/verification-status`) until an OTP proves control of the
// mailbox, at which point the server issues the real session.
//
// The claims are `purpose` + the address the CALLER themselves submitted —
// they learn nothing from decoding it, and the two branches produce
// structurally identical tokens, so the JWT itself is not an oracle either.
// 15 minutes outlives the 10-minute OTP window, so a user who waits for the
// code can still use it; expiry pushes a lapsed visitor back through
// register (which the accountRegisterLimiter already bounds).
import jwt from 'jsonwebtoken';

const PENDING_TTL = '15m';

export const signRegisterPendingToken = (email) => {
  const normalized = String(email).toLowerCase().trim();
  return jwt.sign(
    { purpose: 'register_pending', email: normalized },
    process.env.JWT_SECRET,
    { expiresIn: PENDING_TTL },
  );
};

/**
 * Returns the claims of a genuine pending token, or null. Callers resolve
 * the account FROM THE CLAIMS' EMAIL at use time — the token deliberately
 * carries no user id, so it can be minted for a "new address" before any
 * account exists and still verify against whichever account ends up owning
 * that address.
 */
export const decodeRegisterPendingToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.purpose === 'register_pending' && typeof decoded.email === 'string'
      ? decoded
      : null;
  } catch {
    return null;
  }
};

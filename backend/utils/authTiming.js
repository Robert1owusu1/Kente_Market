// FILE: backend/utils/authTiming.js
// DESCRIPTION: Equal-cost work for the login branches that would otherwise
// answer "does this account exist?" with a stopwatch.
//
// A5. Every successful bcrypt.compare on a real account costs ~480ms (bcryptjs,
// cost 12), so a branch that returns WITHOUT comparing is ~480ms faster than
// one that does. On POST /api/users/auth every answer is the same generic
// failure, so that difference is the entire signal: time one request for a
// guessed address and one for a known one, and the gap enumerates the user
// table. The fix is not to randomise or to sleep — it is to spend the same
// work the real path spends.

import bcrypt from 'bcryptjs';

/**
 * A genuine bcrypt hash, cost 12, of 256 random bits that are not a credential
 * for anything. Both properties are load-bearing, and the first one is the
 * trap:
 *
 *  - `bcrypt.compare(candidate, 'not-a-hash')` returns in ~0ms. A placeholder
 *    string would make "no such user" the FASTEST path on the server — the
 *    oracle wearing a fix, and a source assertion would not have caught it
 *    because the call site would read correctly either way.
 *  - Every production hash is `bcrypt.hash(pw, 12)`, so 12 is the number that
 *    makes the two branches cost the same. Cost 4 (as some test fixtures use)
 *    is a different amount of work and stays measurable; the comparison this
 *    needs is against production, not against fixtures.
 *
 * Publishing it is safe: it is a salted hash of 256 random bits, which is
 * exactly the artifact bcrypt is designed to expose.
 */
export const DUMMY_HASH = '$2b$12$7tt6oMbRqcgoPSMvfxeCp.I5l0CThRZXI3/1yE/7oQSnaXirDK6wO';

/**
 * Spend one bcrypt comparison's worth of time, then return null.
 *
 * Called from every login branch that has no password to compare against, so
 * "no such user", "inactive", "locked" and "wrong password" all cost the same.
 *
 * The candidate is forwarded rather than replaced with a constant: bcrypt's
 * cost varies slightly with input length, so a fixed string would leave a
 * smaller length-shaped channel behind. An empty or missing candidate is
 * substituted — compare() against an empty string does still cost the full
 * ~480ms, but it is not worth depending on that.
 *
 * Failures are swallowed on purpose. This runs on paths whose decision has
 * already been made; it must never turn a generic 401 into a 500.
 */
export const burnPasswordTime = async (candidate) => {
  try {
    await bcrypt.compare(
      typeof candidate === 'string' && candidate ? candidate : 'timing-equaliser',
      DUMMY_HASH,
    );
  } catch {
    // deliberately ignored — see above
  }
  return null;
};

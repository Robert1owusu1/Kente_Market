// FILE LOCATION: backend/tests/tryOnSsrf.test.js
// DESCRIPTION: F4a — the try-on URL check was syntactic only.
//
// Replicate downloads `human_img` / `garm_img` from ITS network position, so
// a caller-supplied URL is a request we make on the caller's behalf. Before
// this, two things were wrong at once:
//
//   1. `isPrivateHostname` compares the hostname STRING, so
//      `https://localtest.me/` (which resolves to 127.0.0.1) passed, and the
//      check read as though it had established reachability.
//   2. The allow-list was opt-in: `allowed.length > 0 && ...` meant an unset
//      AI_TRYON_ALLOWED_HOSTS permitted every public hostname there is.
//
// Resolving the name on our side does not close (1). Replicate resolves it
// again — their resolver, their moment — so a lookup we run first answers a
// different question from the one that decides where the bytes come from, and
// DNS rebinding is simply the case where the difference becomes visible. The
// only lever without that race is deciding which hostnames are permissible at
// all, so the list is now required, and the check is no longer "is this
// hostname not obviously private" but "did the operator name this host".
//
// These tests drive the real predicate (it is exported for exactly this) with
// AI_TRYON_ALLOWED_HOSTS set and unset, rather than asserting the source,
// because "fail-closed" is a behaviour and an absent `> 0` guard is not
// something a grep can be trusted to characterise.
//
// NOTE: pure — no database, runs in the no-DB CI job.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertFetchableImageUrl, isTryOnEnabled } from '../controllers/tryOnController.js';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const SAVE = ['AI_TRYON_ALLOWED_HOSTS', 'AI_TRYON_ENABLED', 'REPLICATE_API_TOKEN'];

const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(SAVE.map((k) => [k, process.env[k]]));
  for (const k of SAVE) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of SAVE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

/** Assert the URL is refused, and return the message so it can be checked. */
const rejects = (url, field = 'modelImage') => {
  try {
    assertFetchableImageUrl(url, field);
  } catch (err) {
    return err.message;
  }
  throw new assert.AssertionError({
    message: `expected "${url}" to be rejected, but it was accepted`,
    actual: url,
    expected: 'rejected',
  });
};

const accepts = (url, field = 'modelImage') => assertFetchableImageUrl(url, field);

describe('F4a: no allow-list configured means no host is fetchable', () => {
  beforeEach(() => { delete process.env.AI_TRYON_ALLOWED_HOSTS; });
  afterEach(() => { delete process.env.AI_TRYON_ALLOWED_HOSTS; });

  test('every https URL is refused, including perfectly ordinary ones', async () => {
    // The regression this exists for: this used to be the default posture and
    // it handed the choice to the caller. `example.com` is public, harmless and
    // still refused — the point is that nothing is fetched until somebody
    // names a host.
    for (const url of [
      'https://example.com/image.png',
      'https://cdn.replicate.com/x.png',
      'https://images.unsplash.com/photo.jpg',
      'https://my-own-bucket.s3.amazonaws.com/k.png',
    ]) {
      const msg = await withEnv({}, async () => rejects(url));
      assert.match(
        msg,
        /no external image host/,
        `"${url}" was accepted or refused for the wrong reason: ${msg}`,
      );
    }
  });

  test('inline data: URIs still work — they cause no fetch at all', () => {
    // This is what the photo upload and camera capture send, so the primary
    // flow keeps working with no configuration.
    const ok = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    assert.equal(accepts(ok), ok);
    assert.equal(accepts('data:image/jpeg;base64,/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
  });

  test('the refusal is explained to whoever has to fix it', async () => {
    const msg = await withEnv({}, async () => rejects('https://example.com/x.png'));
    assert.match(msg, /AI_TRYON_ALLOWED_HOSTS/, 'the error must name the setting');
    assert.match(msg, /modelImage/, 'the error must name the field');
  });
});

describe('F4a: an allow-list admits whole hostnames and nothing else', () => {
  test('the named host is accepted; every other host is not', async () => {
    await withEnv({ AI_TRYON_ALLOWED_HOSTS: 'cdn.kentemarket.com' }, async () => {
      assert.equal(
        accepts('https://cdn.kentemarket.com/uploads/p.png'),
        'https://cdn.kentemarket.com/uploads/p.png',
      );
      // Public and harmless, still refused: the list is the rule now.
      assert.match(rejects('https://example.com/x.png'), /not on the allowed host list/);
      // Substring and suffix tricks: neither direction may work.
      assert.match(rejects('https://notcdn.kentemarket.com/x.png'), /not on the allowed host list/);
      assert.match(rejects('https://cdn.kentemarket.com.evil.com/x.png'), /not on the allowed host list/);
      assert.match(rejects('https://xcdn.kentemarket.com/x.png'), /not on the allowed host list/);
      // Trailing dot is a distinct hostname; it must not be silently equal.
      assert.match(rejects('https://cdn.kentemarket.com./x.png'), /not on the allowed host list/);
      // ...while case never is: URL hosts are case-insensitive, so the URL
      // parser has already lowercased this before the comparison.
      assert.equal(
        accepts('https://CDN.KENTEMARKET.COM/x.png'),
        'https://cdn.kentemarket.com/x.png',
      );
    });
  });

  test('several hosts, whitespace tolerated, comments not consulted', async () => {
    await withEnv(
      { AI_TRYON_ALLOWED_HOSTS: ' cdn.kentemarket.com , images.kentemarket.com ' },
      async () => {
        assert.equal(accepts('https://images.kentemarket.com/a.webp'), 'https://images.kentemarket.com/a.webp');
        assert.match(rejects('https://other.kentemarket.com/a.webp'), /not on the allowed host list/);
      },
    );
  });

  test('the allow-list CANNOT be used to punch through the private-host check', async () => {
    // The two checks are not alternatives. Naming a loopback or metadata host
    // makes it clearer, not permissible — otherwise a typo'd or malicious
    // operator config would silently re-open the SSRF this closes.
    await withEnv(
      {
        AI_TRYON_ALLOWED_HOSTS:
          'localhost,127.0.0.1,metadata.google.internal,169.254.169.254,'
          + 'internal.corp,service.corp,files.lan,portal.intranet,nas.home,box.localdomain',
      },
      async () => {
        for (const url of [
          'https://localhost/x.png',
          'https://127.0.0.1/x.png',
          'https://[::1]/x.png',
          'https://169.254.169.254/latest/meta-data/',
          'https://metadata.google.internal/computeMetadata/v1/',
          'https://10.0.0.5/x.png',
          'https://192.168.1.10/x.png',
          'https://172.16.0.9/x.png',
          'https://100.64.0.1/x.png',
          'https://db.internal/x.png',
          'https://printer.local/x.png',
          // The internal-only suffixes. Each is in the allow-list above on
          // purpose: naming it must not make it fetchable, so what is being
          // asserted is that the private-host check fires BEFORE the list.
          'https://internal.corp/x.png',
          'https://service.corp/x.png',
          'https://files.lan/x.png',
          'https://portal.intranet/x.png',
          'https://nas.home/x.png',
          'https://box.localdomain/x.png',
        ]) {
          assert.match(
            rejects(url),
            /publicly reachable/,
            `"${url}" was accepted despite being an internal target`,
          );
        }
      },
    );
  });

  test('names that are private only BY RESOLUTION are refused because nothing names them', async () => {
    // The honest boundary of this fix. `localtest.me`, `vcap.me` and
    // `127.0.0.1.nip.io` are syntactically perfect public hostnames that
    // resolve to loopback, so `isPrivateHostname` cannot see them — no string
    // check can, which is exactly why F4a called this validation "syntactic
    // only". The protection is NOT the private-host test here; it is that the
    // allow-list is required, so these are refused unless the OPERATOR types
    // them in. The two checks answer different questions: "is this name
    // obviously private" and "did we agree to fetch from this host".
    for (const url of [
      'https://localtest.me/x.png',
      'https://vcap.me/x.png',
      'https://127.0.0.1.nip.io/x.png',
    ]) {
      await withEnv({}, async () => {
        assert.match(rejects(url), /no external image host/, `"${url}" was fetchable`);
      });
    }

    // ...and the limit stated plainly: an operator who explicitly names such a
    // host can still fetch it. That is their call to make and the only
    // remaining one — a caller cannot make it for them, which was the finding.
    await withEnv({ AI_TRYON_ALLOWED_HOSTS: 'localtest.me' }, async () => {
      assert.equal(accepts('https://localtest.me/x.png'), 'https://localtest.me/x.png');
    });
  });

  test('non-default ports are refused — the list vouches for a host, not a port', async () => {
    await withEnv({ AI_TRYON_ALLOWED_HOSTS: 'cdn.kentemarket.com' }, async () => {
      // `new URL` normalises the default port away, so this still passes.
      assert.equal(
        accepts('https://cdn.kentemarket.com:443/x.png'),
        'https://cdn.kentemarket.com/x.png',
      );
      for (const port of [8443, 8080, 6379, 22, 9200]) {
        assert.match(
          rejects(`https://cdn.kentemarket.com:${port}/x.png`),
          /default https port/,
          `port ${port} was accepted`,
        );
      }
    });
  });
});

describe('F4a: the shapes that were never fetchable stay refused', () => {
  beforeEach(() => {
    process.env.AI_TRYON_ALLOWED_HOSTS = 'cdn.kentemarket.com';
  });
  afterEach(() => { delete process.env.AI_TRYON_ALLOWED_HOSTS; });

  test('protocol, credentials and malformed input', async () => {
    assert.match(rejects('http://cdn.kentemarket.com/x.png'), /https URL/);
    assert.match(rejects('ftp://cdn.kentemarket.com/x.png'), /https URL/);
    assert.match(rejects('file:///etc/passwd'), /https URL/);
    assert.match(rejects('javascript:alert(1)'), /https URL/);
    assert.match(rejects('https://user:pass@cdn.kentemarket.com/x.png'), /credentials/);
    assert.match(rejects('not a url at all'), /valid https URL/);
    assert.match(rejects(''), /is required/);
    assert.match(rejects(null), /is required/);
    assert.match(rejects(42), /is required/);
    assert.match(rejects('   '), /is required/);
    // Unparseable as a URL but not starting with data: — must not be
    // mistaken for an inline image.
    assert.match(rejects('data:image/png;base64'), /valid https URL|base64/);
  });

  test('data: URIs must be a real encoded image, and be small', async () => {
    assert.match(rejects('data:text/html,<script>alert(1)</script>'), /base64-encoded/);
    assert.match(rejects('data:image/svg+xml;base64,PHN2Zz4='), /base64-encoded/);
    assert.match(rejects('data:image/png;base64,not base64!'), /base64-encoded/);
    assert.match(rejects('data:image/png,rawtext'), /base64-encoded/);
    // 5 MiB cap. Sized past the *3/4 decode so the arithmetic in the
    // controller is what trips, not the regex.
    const oversize = `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`;
    assert.match(rejects(oversize), /5MB inline image limit/);
  });
});

describe('F4a: the controller and the feature flag are both fail-closed', () => {
  test('generateTryOn validates both fields before it can spend anything', () => {
    const src = read('../controllers/tryOnController.js');
    const start = src.indexOf('export const generateTryOn');
    assert.ok(start > -1, 'generateTryOn not found');
    const body = src.slice(start, src.indexOf('\n});', start));

    // The validation must come before reserveTryOnCredit — otherwise a
    // rejected URL burns one of the user's daily try-ons.
    const vIndex = body.indexOf('assertFetchableImageUrl(modelImage');
    const creditIndex = body.indexOf('reserveTryOnCredit');
    assert.ok(vIndex > -1, 'modelImage is not validated');
    assert.ok(body.indexOf('assertFetchableImageUrl(garmentImage') > -1, 'garmentImage is not validated');
    assert.ok(creditIndex > -1, 'the daily credit is not reserved');
    assert.ok(vIndex < creditIndex, 'the credit is reserved before the URLs are validated');
    assert.match(body, /res\.status\(400\)/, 'a rejected URL must not fall through as a 500');
  });

  test('the old opt-in allow-list condition is gone', () => {
    const src = read('../controllers/tryOnController.js');
    assert.ok(
      !src.includes('allowed.length > 0 &&'),
      'the allow-list is optional again — an unset list would permit every host',
    );
    assert.match(src, /allowed\.length === 0/, 'no explicit fail-closed branch');
    assert.match(src, /export const assertFetchableImageUrl/, 'the predicate is not exported');
  });

  test('the feature flag compares to "true" literally, not "not false"', async () => {
    // Pre-existing, but it is the same class of mistake (a default that is
    // permissive because somebody wrote `!== 'false'`) and it is the switch
    // that gates all of the above.
    await withEnv({}, async () => {
      assert.equal(isTryOnEnabled(), false, 'off with nothing set');
    });
    await withEnv({ AI_TRYON_ENABLED: 'true' }, async () => {
      assert.equal(isTryOnEnabled(), false, 'on but no token');
    });
    await withEnv({ AI_TRYON_ENABLED: 'false', REPLICATE_API_TOKEN: 'tok' }, async () => {
      assert.equal(isTryOnEnabled(), false, 'explicitly false must stay off');
    });
    await withEnv({ AI_TRYON_ENABLED: 'anything', REPLICATE_API_TOKEN: 'tok' }, async () => {
      assert.equal(isTryOnEnabled(), false, 'anything but "true" must stay off');
    });
    await withEnv({ AI_TRYON_ENABLED: 'true', REPLICATE_API_TOKEN: 'tok' }, async () => {
      assert.equal(isTryOnEnabled(), true);
    });
  });

  test('.env.example documents the flag and the host list', () => {
    const env = read('../.env.example');
    assert.match(env, /^AI_TRYON_ENABLED=/m, 'the feature flag is not documented');
    assert.match(env, /^AI_TRYON_ALLOWED_HOSTS=/m, 'the host allow-list is not documented');
  });
});

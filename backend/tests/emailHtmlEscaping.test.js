// FILE LOCATION: backend/tests/emailHtmlEscaping.test.js
// DESCRIPTION: M-6 — four outbound HTML renderers interpolated untrusted text.
//
// emailService.js built its templates straight from `firstName`, `email`,
// `name`, `resetUrl` and env values, and the two wishlist services interpolated
// a VENDOR-controlled `product.title` into an HTML body. A vendor who names a
// product `</strong><a href="https://evil">Verify your account</a>` ships that
// markup verbatim into a customer's inbox, and the mail arrives from us.
//
// orderEmailService.js already had the right idea and the right function — it
// just could not be reached: it imports sendEmailSafely FROM emailService.js,
// so importing the escaper back the other way would close a cycle. The escaper
// now lives in utils/htmlEscape.js, below both, and this suite checks that
// every HTML template uses it.
//
// The rule is deliberately mechanical — EVERY interpolation inside a template
// containing an HTML tag must be escapeHtml(...), including dates and counters
// that are obviously safe. A rule with no judgement calls in it still holds
// when someone adds a field later; a rule that says "user-controlled fields"
// depends on someone correctly classifying every field, forever, which is how
// the four renderers above went unescaped in the first place.
//
// Escaping a plain-text context is wrong (a subject with `&` in it would start
// displaying `&amp;`), which is why the filter is "template contains an HTML
// tag" rather than "template is not a console.log" — the wishlist notification
// title and email subject are excluded by that filter, and the test asserts
// they stay that way.
//
// NOTE: pure — no database, runs in the no-DB CI job.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const FILES = {
  emailService: '../utils/emailService.js',
  orderEmail: '../utils/orderEmailService.js',
  htmlEscape: '../utils/htmlEscape.js',
  priceDrop: '../Services/wishlistPriceDropService.js',
  restock: '../Services/wishlistRestockService.js',
};

/**
 * Every template literal in the source, as { start, body } offsets.
 *
 * Comments and quoted strings are walked past rather than pattern-matched, so
 * a backtick in prose cannot open a phantom template (and `https://` inside a
 * template cannot be mistaken for a line comment and truncate one).
 */
const templateLiterals = (src) => {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { i += 2; while (i < n && src[i] !== '\n' && src[i] !== '\r') i += 1; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
    if (c === "'" || c === '"') {
      i += 1;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === c) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (c === '`') {
      const start = i + 1;
      let j = start;
      let depth = 0;
      while (j < n) {
        const d = src[j];
        if (depth === 0 && d === '`') break;
        if (d === '\\' && depth === 0) { j += 2; continue; }
        if (d === '$' && src[j + 1] === '{') { depth += 1; j += 2; continue; }
        if (depth > 0 && d === '}') { depth -= 1; j += 1; continue; }
        j += 1;
      }
      out.push({ start, end: j, body: src.slice(start, j) });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
};

/** The `${...}` expressions in a template body, with nested ()/[]/{} and quotes balanced. */
const interpolations = (body) => {
  const out = [];
  let i = 0;
  for (;;) {
    const start = body.indexOf('${', i);
    if (start === -1) return out;
    let depth = 1;
    let j = start + 2;
    let quote = null;
    while (j < body.length && depth > 0) {
      const c = body[j];
      if (quote) {
        if (c === '\\') j += 1;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      j += 1;
    }
    out.push({ expr: body.slice(start + 2, j - 1), at: start });
    i = j;
  }
};

const lineOf = (src, offset) => src.slice(0, offset).split('\n').length;

const hasTag = (body) => /<[a-zA-Z/!]/.test(body);

/**
 * Report every interpolation in an HTML-bearing template that is not escaped.
 * Returns entries rather than asserting, so callers can first assert the
 * scanner found templates at all — an empty scan passes vacuously otherwise.
 */
const unescaped = (src) => {
  const problems = [];
  for (const t of templateLiterals(src)) {
    if (!hasTag(t.body)) continue;
    for (const { expr, at } of interpolations(t.body)) {
      if (/^\s*escapeHtml\(/.test(expr)) continue;
      problems.push({ line: lineOf(src, t.start + at), expr: expr.slice(0, 70) });
    }
  }
  return problems;
};

describe('M-6: outbound HTML escapes every interpolation', () => {
  test('the escaper neutralizes markup, attributes and entity trickery', async () => {
    const { escapeHtml } = await import('../utils/htmlEscape.js');
    assert.equal(
      escapeHtml('<script>alert(1)</script>'),
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    // Attribute breakout is the one that matters for href="...": the quote
    // must not survive, or a URL field closes the attribute early.
    assert.equal(
      escapeHtml('"><img src=x onerror=alert(1)>'),
      '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
    );
    // `&` first, or `&lt;` would become `&amp;lt;` and double-escape forever.
    assert.equal(escapeHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml('<b>x</b>'), escapeHtml('<b>x</b>'), 'must be idempotent');
  });

  test('there is exactly ONE escaper, and it is not defined twice', async () => {
    const sources = Object.entries(FILES).map(([k, v]) => [k, read(v)]);
    const definers = sources.filter(([, src]) => /const escapeHtml\s*=/.test(src));
    assert.deepEqual(
      definers.map(([k]) => k),
      ['htmlEscape'],
      'escapeHtml must be defined only in utils/htmlEscape.js',
    );
    // The others consume it rather than restating it — restating is how four
    // renderers ended up with none: the copy in one file rots silently.
    for (const name of ['emailService', 'orderEmail', 'priceDrop', 'restock']) {
      const [, src] = sources.find(([k]) => k === name);
      assert.match(
        src,
        /import \{ escapeHtml \} from/,
        `${name} does not import the shared escaper`,
      );
    }
    // orderEmailService must still re-export it, or the existing
    // verification-fixes.test.js import breaks.
    const order = sources.find(([k]) => k === 'orderEmail')[1];
    assert.match(order, /export \{ escapeHtml \};/);
    const { escapeHtml } = await import('../utils/htmlEscape.js');
    const reexported = await import('../utils/orderEmailService.js');
    assert.equal(reexported.escapeHtml, escapeHtml, 'the re-export is a different function');
  });

  test('emailService: every HTML interpolation is escaped', () => {
    const src = read(FILES.emailService);
    const templates = templateLiterals(src).filter((t) => hasTag(t.body));
    // Six html: bodies (OTP, welcome, reset, reset-confirmation, contact,
    // subscribe). Asserting the count is what stops a scanner that quietly
    // stops finding anything from reporting success.
    assert.ok(templates.length >= 6, `found ${templates.length} HTML templates, expected >= 6`);

    const problems = unescaped(src);
    assert.deepEqual(
      problems,
      [],
      `unescaped interpolation(s):\n${problems.map((p) => `  line ${p.line}: \${${p.expr}}`).join('\n')}`,
    );
  });

  test('wishlist services: the vendor-controlled title is escaped in the HTML body', () => {
    for (const rel of [FILES.priceDrop, FILES.restock]) {
      const src = read(rel);
      const templates = templateLiterals(src).filter((t) => hasTag(t.body));
      assert.equal(templates.length, 1, `${rel}: expected exactly one HTML template`);

      const problems = unescaped(src);
      assert.deepEqual(
        problems,
        [],
        `${rel}: unescaped interpolation(s):\n${problems.map((p) => `  line ${p.line}: \${${p.expr}}`).join('\n')}`,
      );
      assert.match(src, /<strong>\$\{escapeHtml\(product\.title\)\}<\/strong>/);
    }
  });

  test('plain-text contexts are NOT escaped — a subject must not show &amp;', () => {
    // Escaping is only correct inside HTML. The wishlist notification title and
    // the email subject are rendered/read as text, so escaping them would put
    // literal entities in front of the customer. The filter (template must
    // contain an HTML tag) excludes them; this asserts they were left alone.
    for (const rel of [FILES.priceDrop, FILES.restock]) {
      const src = read(rel);
      // Every template WITHOUT an HTML tag must contain no escapeHtml call —
      // this is what catches the over-eager version of this fix, which would
      // corrupt every subject line containing an ampersand.
      let plain = 0;
      for (const t of templateLiterals(src)) {
        if (hasTag(t.body)) continue;
        plain += 1;
        assert.ok(
          !/escapeHtml\(/.test(t.body),
          `${rel}: plain-text template was escaped: ${t.body.slice(0, 60)}`,
        );
      }
      assert.ok(plain >= 2, `${rel}: expected a title and a subject template, found ${plain}`);
    }
    // ...and the raw product title survives in both of them.
    const drop = read(FILES.priceDrop);
    assert.match(drop, /title: `Price drop: \$\{product\.title\}`/);
    const stock = read(FILES.restock);
    assert.match(stock, /title: `Back in stock: \$\{product\.title\}`/);
  });

  test('the checker is not vacuous — a fresh unescaped field is caught', () => {
    // Prove the scanner would flag a template someone adds later. If this ever
    // fails while the suite above passes, the suite above means nothing.
    const synthetic = [
      'const html = `',
      '  <h2>Hello ${firstName}!</h2>',
      '  <p>Sent to ${escapeHtml(email)}</p>',
      '`;',
      'console.log(`Sent to ${email}`);',
      "const url = `${FRONTEND_URL}/login`;",
      '// a comment with `a backtick` and <html> in it',
    ].join('\n');

    const problems = unescaped(synthetic);
    assert.equal(problems.length, 1, `expected exactly one finding, got ${JSON.stringify(problems)}`);
    assert.equal(problems[0].expr, 'firstName');
    assert.equal(problems[0].line, 2);
  });
});

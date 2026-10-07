// FILE LOCATION: backend/tests/uploadGate.test.js
// DESCRIPTION: F2 — the first gate matched anywhere in the string, and the
// persisted key was named by the client.
//
// Two halves of one upload path, and the twin file already showed the answer:
// profileRoutes.js had been fixed with anchored regexes and a comment saying
// why ("the old unanchored /jpeg|jpg|png/ matched any MIME or filename
// CONTAINING a token") while uploadMiddleware.js kept the old one. A gate that
// accepts `holiday.pngx` and `image/pngfoo` is worse than no gate, because the
// next reader trusts it.
//
// The second half is the key itself: `path.extname(originalname)` decided the
// extension of the stored object, so the client named the file it was about to
// receive. That mattered in two concrete ways:
//
//   * extension and content could disagree — a real PNG stored as whatever the
//     client called it, and "which rule does the static server apply here"
//     became a question a request gets to answer;
//   * the DELETE route only accepts `\d+-(product|reference)-[\w-]+\.[a-z0-9]+`,
//     so an extension the old gate let through (`.png-x` holds `png`, so the
//     unanchored test passed) produced an image nobody could ever remove.
//
// The extension now comes from `verdict.format`, the one value on that request
// produced by reading the bytes.
//
// NOTE: pure — no database, runs in the no-DB CI job. The magic-byte builders
// are repeated from uploadValidation.test.js on purpose: that file's helpers
// are module-local, and pulling them into tests/helpers/ would make this suite
// depend on a file that is not committed yet.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { imageFileFilter } from '../middleware/uploadMiddleware.js';
import { sniffImage } from '../utils/imageValidator.js';

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const uploadRouteSrc = read('../routes/uploadRoute.js');
const middlewareSrc = read('../middleware/uploadMiddleware.js');
const profileSrc = read('../routes/profileRoutes.js');

// The exact source text of the anchored patterns, asserted with includes()
// rather than a regex: escaping a regex literal that CONTAINS a regex literal
// is where this kind of guard goes subtly wrong and starts passing for the
// wrong reason.
const ANCHORED_EXT = 'const allowedExt = /\\.(jpe?g|png|gif|webp)$/i;';
const ANCHORED_MIME = 'const allowedMime = /^image\\/(jpe?g|png|gif|webp)$/';
const UNANCHORED_OLD = 'const allowedTypes = /jpeg|jpg|png|gif|webp/;';
// The pattern that used to be in charge, taken from the same string rather
// than retyped, so the premise in the last test cannot drift from the source
// it is describing.
const oldGate = new RegExp(
  UNANCHORED_OLD.slice(UNANCHORED_OLD.indexOf('/') + 1, UNANCHORED_OLD.lastIndexOf('/')),
);

// One definition of the DELETE route's acceptance pattern, verified against the
// source so the two cannot drift: if uploadRoute.js changes the pattern, this
// file fails until it is updated, rather than testing a rule the app no longer
// applies.
const DELETE_PATTERN_SRC = '/^\\d+-(product|reference)-[\\w-]+\\.[a-z0-9]+$/i';
const deletePattern = new RegExp(
  DELETE_PATTERN_SRC.slice(1, DELETE_PATTERN_SRC.lastIndexOf('/')),
  'i',
);

/** Drive the multer file filter and report the verdict it hands back. */
const gate = (originalname, mimetype) => new Promise((resolve) => {
  imageFileFilter({}, { originalname, mimetype }, (err, ok) => {
    // `err` itself must come back: a helper that reduced it to a boolean would
    // make "a rejection carries a message" untestable, which is the assertion
    // a future refactor of this file would be most likely to lose.
    resolve({ err, rejected: Boolean(err), ok: Boolean(ok) });
  });
});

// Minimal headers, built the way uploadValidation.test.js builds them (that
// file's builders are module-local, and the sniffers need real dimensions —
// a zero-size header is deliberately rejected as a bomb).
const buildPng = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write('IHDR', 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

const buildGif = (w, h) => {
  const b = Buffer.alloc(14);
  b.write('GIF89a', 0);
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};

describe('F2: the first gate is anchored', () => {
  test('the source uses anchored patterns, not a substring search', () => {
    const start = middlewareSrc.indexOf('const imageFileFilter');
    assert.ok(start > -1, 'imageFileFilter not found');
    const block = middlewareSrc.slice(start, middlewareSrc.indexOf('\n});', start));

    assert.ok(block.includes(ANCHORED_EXT), 'extension regex must be anchored at the end');
    assert.ok(block.includes(ANCHORED_MIME), 'MIME regex must be anchored at both ends');
    assert.ok(
      !block.includes(UNANCHORED_OLD),
      'the unanchored /jpeg|jpg|png/ is back',
    );
    // The flag, not just the shape: without `i` a `.PNG` upload would be
    // rejected, and with the old substring test the flag never mattered.
    assert.match(block, /\$\/i;/);
  });

  test('the gate rejects the names and MIMEs it used to wave through', async () => {
    const accept = [
      ['photo.png', 'image/png'],
      ['photo.jpg', 'image/jpeg'],
      ['photo.jpeg', 'image/jpeg'],
      ['photo.gif', 'image/gif'],
      ['photo.webp', 'image/webp'],
      ['PHOTO.PNG', 'image/png'],   // extension case must not matter
      ['archive.tar.png', 'image/png'], // extname is the last segment only
    ];
    for (const [name, mime] of accept) {
      const v = await gate(name, mime);
      assert.equal(v.ok, true, `"${name}"/"${mime}" should be accepted`);
    }

    // These are the ones the unanchored test accepted, because each string
    // merely CONTAINS a token somewhere.
    const reject = [
      ['holiday.pngx', 'image/png'],      // extname `.pngx` holds "png"
      ['holiday.jpegoops', 'image/jpeg'], // extname holds "jpeg"
      ['holiday.webp1', 'image/webp'],    // extname holds "webp"
      ['holiday.gifas', 'image/gif'],     // extname holds "gif"
      ['photo.png ', 'image/png'],        // trailing space breaks the anchor
      ['photo.png', 'image/pngfoo'],      // MIME contains "png"
      ['photo.png', 'application/png'],   // not an image/* MIME
      ['photo.png', 'image/x-png'],       // legacy MIME we do not claim to accept
      ['holiday.svg', 'image/svg+xml'],   // SVG was never allowed
      ['holiday', 'image/png'],           // no extension at all
      ['holiday.php', 'image/png'],       // never allowed, still isn't
      ['holiday.png', 'text/plain'],
    ];
    for (const [name, mime] of reject) {
      const v = await gate(name, mime);
      assert.equal(v.rejected, true, `"${name}"/"${mime}" should have been rejected`);
      assert.ok(v.err?.message, 'a rejection must carry a message the user sees');
    }
  });

  test('the profile twin stays anchored — it is the reference implementation', () => {
    const start = profileSrc.indexOf('const fileFilter');
    assert.ok(start > -1, 'profileRoutes fileFilter not found');
    const block = profileSrc.slice(start, profileSrc.indexOf('\n});', start));
    assert.ok(block.includes(ANCHORED_EXT), 'profileRoutes lost the anchored extension regex');
    assert.ok(block.includes(ANCHORED_MIME), 'profileRoutes lost the anchored MIME regex');
    assert.ok(!block.includes(UNANCHORED_OLD));
  });
});

describe('F2: the stored extension is decided by the bytes', () => {
  test('the client filename no longer contributes to the object key', () => {
    assert.ok(
      !uploadRouteSrc.includes('path.extname(req.file.originalname)'),
      'the persisted extension is derived from the client filename again',
    );
    const derived = uploadRouteSrc.match(/`\.\$\{verdict\.format\}`/g) || [];
    assert.equal(
      derived.length,
      2,
      `expected the product and reference routes to both derive from verdict.format, found ${derived.length}`,
    );
    // Every `const ext = ...` must be content-derived, so a route that persisted
    // before checking cannot quietly appear.
    for (const m of uploadRouteSrc.matchAll(/const ext = [^;]+;/g)) {
      assert.match(m[0], /verdict\.format/, `ext is not content-derived: ${m[0]}`);
    }
  });

  test('every format the sniffer reports is usable as an extension', () => {
    // The route does `.${verdict.format}` on the strength of this. If a format
    // ever arrived containing a dot, a slash or uppercase, the key would carry
    // it straight into the DELETE pattern — so the vocabulary is pinned here.
    const samples = [buildPng(640, 480), buildGif(100, 50)];
    const formats = new Set();
    for (const buf of samples) {
      const meta = sniffImage(buf);
      assert.ok(meta && meta.format, 'a real image header must report a format');
      formats.add(meta.format);
    }
    assert.deepEqual([...formats].sort(), ['gif', 'png']);
    for (const f of formats) assert.match(f, /^[a-z0-9]+$/, `"${f}" cannot be used as an extension`);

    // jpeg and webp come from uploadValidation.test.js's own assertions
    // (`sniffImage(buildJpeg(...))` deep-equals `{format:'jpeg',...}`); all
    // four are what the DELETE test below needs, and all four are the complete
    // vocabulary sniffImage can produce.
    for (const format of ['png', 'jpeg', 'gif', 'webp']) {
      assert.match(format, /^[a-z0-9]+$/);
    }
  });

  test('every extension the route can now produce is one the DELETE route accepts', () => {
    assert.ok(
      uploadRouteSrc.includes(DELETE_PATTERN_SRC),
      'the DELETE pattern changed — update DELETE_PATTERN_SRC above',
    );
    for (const format of ['png', 'jpeg', 'gif', 'webp']) {
      const ext = `.${format}`;
      assert.match(
        `1-product-9c1f0b2e-4a7d-4c3b-9f2a-1d5e6a7b8c9d${ext}`,
        deletePattern,
        `a file stored as "${ext}" could never be deleted`,
      );
      assert.match(
        `1-reference-9c1f0b2e-4a7d-4c3b-9f2a-1d5e6a7b8c9d${ext}`,
        deletePattern,
        `a reference stored as "${ext}" could never be deleted`,
      );
    }
  });

  test('the two distinct ways the OLD gate could name a file badly', async () => {
    // Stated as failing assertions, so neither half can decay into a comment.
    //
    // (1) Un-deletable: the extension holds a character the DELETE pattern's
    //     `[a-z0-9]+` does not, so the API returned a filename its own DELETE
    //     route would then refuse. `.png-x` contains the token `png`, which is
    //     why the unanchored test waved it through.
    for (const hostile of ['.png-x', '.gif_foo']) {
      assert.equal(
        deletePattern.test(`1-product-9c1f0b2e${hostile}`),
        false,
        `expected "${hostile}" to be undeletable under the old naming`,
      );
      assert.equal(
        oldGate.test(hostile),
        true,
        `the old gate must have accepted "${hostile}", or the finding was wrong`,
      );
      // ...and the anchored gate now refuses it at the door.
      const { rejected } = await new Promise((r) => imageFileFilter(
        {},
        { originalname: `holiday${hostile}`, mimetype: 'image/png' },
        (err) => r({ rejected: Boolean(err) }),
      ));
      assert.equal(rejected, true, `"${hostile}" still reaches the storage layer`);
    }

    // (2) Undeletable but nonsense: `.jpegoops` is all alphanumerics, so the
    //     DELETE route happily accepts a key whose extension describes no
    //     format at all — the object is served under whatever rule that string
    //     happens to trigger. Content and extension disagreed; the DELETE
    //     pattern never could have caught it, and the anchored gate does.
    assert.equal(deletePattern.test('1-product-9c1f0b2e.jpegoops'), true, 'premise changed');
    assert.equal(oldGate.test('.jpegoops'), true, 'the old gate accepted it');
    const mismatch = await new Promise((r) => imageFileFilter(
      {},
      { originalname: 'holiday.jpegoops', mimetype: 'image/jpeg' },
      (err) => r({ rejected: Boolean(err) }),
    ));
    assert.equal(mismatch.rejected, true, '.jpegoops reaches the storage layer');
  });
});

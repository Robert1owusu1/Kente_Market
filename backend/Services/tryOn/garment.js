// FILE LOCATION: backend/Services/tryOn/garment.js
// DESCRIPTION: Resolves the garment for a try-on from the SERVER's catalog.
//              The browser supplies a product id and nothing else about the
//              product: image, title, category, vendor and eligibility are all
//              read from the product row here, under the same visibility rule
//              as the public product page. Also holds the fail-closed remote
//              image predicate (SSRF guard) used for allow-listed product
//              image hosts. Moved verbatim from controllers/tryOnController.js
//              when the provider adapter layer was introduced.
import pool from "../../config/db.js";
import {
  sanitizeImageBuffer,
  readLocalCatalogImage,
  resolveLocalCatalogImagePath,
  isWearableProduct,
  toGarmentCategory,
  sanitizeGarmentName,
  TryOnInputError,
} from "../../utils/tryOnImage.js";

/**
 * Validate an image reference before handing it to a third-party fetcher.
 *
 * Replicate resolves and downloads `human_img` / `garm_img` from THEIR network
 * position, so an unvalidated user-supplied URL turns this endpoint into
 * delegated SSRF: a caller could aim Replicate's fetcher at loopback, a cloud
 * metadata endpoint, or an internal-only service and read the response back
 * through the generated image.
 *
 * Two shapes are accepted:
 *   - `data:image/...;base64,...` - inline bytes, so there is no network fetch
 *     and therefore no SSRF. This is what the photo upload and camera capture
 *     produce, and the decoded size is capped below. Always accepted.
 *   - `https://<host>/...` - a real URL, and only one the operator has named
 *     in AI_TRYON_ALLOWED_HOSTS.
 *
 * F4a: this used to be syntactic only. `isPrivateHostname` inspects the
 * STRING, so `https://localtest.me/` - which resolves to 127.0.0.1 - passed,
 * and the allow-list was optional: with it unset, every hostname on the public
 * internet was fetchable on the caller's say-so.
 *
 * Resolving the name ourselves would not have closed that. Replicate resolves
 * it again, from their address, at their moment, so a lookup we perform first
 * answers a DIFFERENT question from the one that decides where the bytes
 * actually come from; DNS rebinding is the sharp version of the gap, but even
 * without it the two lookups are independent and there is no way for us to
 * make theirs agree with ours. The only lever without that race is deciding
 * WHICH hostnames are permissible at all, so the list is now required: an
 * unset AI_TRYON_ALLOWED_HOSTS accepts `data:` URIs and nothing else.
 *
 * The list matches whole hostnames - no wildcards, no suffix matching - and
 * the port must be the default one: `new URL` normalises `:443` away, so a
 * non-empty port is a deliberate non-default, and trusting a host on :443 says
 * nothing about what else that host serves on :8080.
 */
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

const isPrivateHostname = (hostname) => {
  const h = hostname.toLowerCase();
  // Names that only ever resolve inside somebody's network. `.corp`, `.lan`,
  // `.intranet`, `.home` and `.localdomain` are the classic internal-only
  // suffixes: a resolver with a search domain folds them onto a private
  // address, and no public host is ever served on them.
  if (
    h === "localhost"
    || [".localhost", ".local", ".internal", ".corp", ".lan", ".intranet", ".home", ".localdomain"]
      .some((suffix) => h.endsWith(suffix))
  ) {
    return true;
  }
  // Cloud instance metadata endpoints.
  if (h === "169.254.169.254" || h === "metadata.google.internal" || h === "metadata.goog") {
    return true;
  }
  // Any IPv6 literal, and any IPv4 literal. A hostname can be an IP without a
  // TLD, so these have to be rejected here rather than by the protocol check.
  if (h.includes(":")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const a = Number(v4[1]);
  const b = Number(v4[2]);
  if (a === 0 || a === 10 || a === 127) return true;        // 0/8, 10/8, 127/8
  if (a === 169 && b === 254) return true;                  // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;         // 172.16/12
  if (a === 192 && b === 168) return true;                  // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true;        // 100.64/10 CGNAT
  return false;
};

const extraAllowedHosts = () =>
  (process.env.AI_TRYON_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

// Exported so the suite can drive the real predicate: this is the function
// that decides what a caller may make Replicate fetch, and a source assertion
// about it would only ever prove the text is present.
export const assertFetchableImageUrl = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  if (value.startsWith("data:")) {
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
      throw new Error(`${field} must be a base64-encoded png, jpeg, webp or gif image`);
    }
    const approxBytes = Math.floor(((value.length - value.indexOf(",") - 1) * 3) / 4);
    if (approxBytes > MAX_INLINE_IMAGE_BYTES) {
      throw new Error(`${field} exceeds the 5MB inline image limit`);
    }
    return value;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid https URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${field} must be an https URL`);
  }
  if (url.username || url.password) {
    throw new Error(`${field} must not contain credentials`);
  }
  if (url.port) {
    // `new URL` strips a default `:443`, so anything still here is a
    // deliberate non-default port that the host allow-list cannot vouch for.
    throw new Error(`${field} must use the default https port`);
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error(`${field} must be a publicly reachable image URL`);
  }

  // Fail closed. An unset list used to mean "any public host", which left the
  // decision with the caller; it now means "no host at all", so the operator
  // has to name the one place product images come from before this endpoint
  // will make anyone fetch anything.
  const allowed = extraAllowedHosts();
  if (allowed.length === 0) {
    throw new Error(
      `${field}: this deployment permits no external image host. `
      + 'Set AI_TRYON_ALLOWED_HOSTS to the host(s) product images are served from.',
    );
  }
  if (!allowed.includes(url.hostname.toLowerCase())) {
    throw new Error(`${field} is not on the allowed host list`);
  }
  return url.toString();
};

// One answer for "does not exist", "not approved" and "vendor suspended", so
// neither endpoint can be used to probe which hidden products exist.
const NOT_AVAILABLE_MESSAGE =
  "That Kente cloth is not available for AI try-on. Please pick another one.";

/**
 * Load a product and decide whether it can be tried on, WITHOUT reading or
 * decoding its image (cheap enough for the public eligibility endpoint). The
 * caller only ever supplies an id; everything else is the server's row.
 *
 * Eligible means: the product exists, is approved, belongs to an approved
 * vendor (or the platform) — the same visibility rule as the public product
 * page (Product.findById) — is something a person wears, and has an image
 * this server can hand to the provider (a checked local file, or an https URL
 * on the operator's allow-list).
 *
 * Throws TryOnInputError: 404 for not-visible, 422 for visible-but-unsupported.
 * Exported for the security suite.
 * @returns {Promise<{productId:number, vendorId:number|null, title:string,
 *   category:string, img:string, imageSource:'local'|'remote'}>}
 */
export const loadTryOnProduct = async (productId) => {
  const id = Number(productId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new TryOnInputError("productId must be a valid product id");
  }
  const [[row]] = await pool.execute(
    `SELECT p.id, p.vendorId, p.title, p.img, p.category, p.approvalStatus
     FROM product p
     LEFT JOIN vendors v ON v.userId = p.vendorId
     WHERE p.id = ? AND (v.status = 'approved' OR p.vendorId IS NULL)`,
    [id]
  );
  if (!row || row.approvalStatus !== "approved") {
    throw new TryOnInputError(NOT_AVAILABLE_MESSAGE, 404);
  }

  if (!isWearableProduct(row)) {
    throw new TryOnInputError(
      "AI try-on is only available for Kente you wear. This piece is not a wearable item.",
      422,
    );
  }

  let imageSource;
  try {
    if (typeof row.img === "string" && row.img.startsWith("https://")) {
      // Remote catalog image (e.g. an S3/R2 public object): fail-closed
      // allow-list — a hostname the operator has not named is refused.
      assertFetchableImageUrl(row.img, "productImage");
      imageSource = "remote";
    } else {
      resolveLocalCatalogImagePath(row.img);
      imageSource = "local";
    }
  } catch (err) {
    console.error(`Try-On product ${id} image unusable:`, err.message);
    throw new TryOnInputError(
      "This product's photo can't be used for AI try-on yet, so try-on is unavailable for it.",
      422,
    );
  }

  return {
    productId: row.id,
    vendorId: row.vendorId ?? null,
    title: row.title,
    category: row.category,
    img: row.img,
    imageSource,
  };
};

/**
 * Resolve the garment for a try-on from the SERVER's catalog. Returns:
 *   { productId, vendorId, productImage, image, name, category } where
 *   `image` is either a sanitized data: URI (local storage) or an
 *   allow-listed https URL, and `productImage` is the catalog reference it
 *   came from. Nothing here is read from the request except the id.
 * Throws TryOnInputError (400/404/422) when the product cannot be used.
 * Exported for the security suite.
 */
export const resolveGarmentForTryOn = async (productId) => {
  const product = await loadTryOnProduct(productId);

  let image;
  if (product.imageSource === "remote") {
    image = assertFetchableImageUrl(product.img, "productImage");
  } else {
    // Local storage (/images, /uploads/...): read the bytes HERE, sanitize
    // them, and inline them. No network fetch, no SSRF surface at all.
    const sanitized = await sanitizeImageBuffer(
      await readLocalCatalogImage(product.img),
      "productImage",
    );
    image = sanitized.dataUri;
  }

  return {
    productId: product.productId,
    vendorId: product.vendorId,
    productImage: product.img,
    image,
    name: sanitizeGarmentName(product.title),
    category: toGarmentCategory(product.category),
  };
};

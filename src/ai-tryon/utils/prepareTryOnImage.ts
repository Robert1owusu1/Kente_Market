// FILE LOCATION: src/ai-tryon/utils/prepareTryOnImage.ts
// DESCRIPTION: Client-side downscale/compress before the try-on upload.
//
// This is a USABILITY step, not a security boundary — the backend re-validates
// every byte it receives. Its job is to keep the photo inside the API's JSON
// body limit (1MB) with headroom: a modern phone photo is 3-8MB, and sending
// it as base64 JSON (~1.37x the bytes) guaranteed a 413 for every real user.
// Canvas re-encoding also drops EXIF (including GPS) in the BROWSER before
// the photo ever leaves the device, so the privacy win happens at the source.

/** Long edge cap: enough detail for IDM-VTON, small enough that the base64
 *  JSON round trip stays comfortably under the 1MB body limit. */
const MAX_LONG_EDGE = 1536;
/** Target payload size ceiling for the base64 string (chars). */
const MAX_DATA_URL_CHARS = 850_000;
const START_QUALITY = 0.85;

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image file."));
    img.src = src;
  });

const toJpegDataUrl = (img: HTMLImageElement, quality: number): string => {
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing is not supported in this browser.");
  // White background first: a transparent PNG re-encoded to JPEG would
  // otherwise composite onto black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
};

/**
 * Take any browser-produced image data URL (FileReader upload or canvas
 * camera capture) and return a small, EXIF-free JPEG data URL ready for
 * POST /api/tryon/jobs. Throws with a user-readable message when the
 * image cannot be decoded or stays too large.
 */
export async function prepareTryOnImage(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  // Step down quality first (keeps resolution), then dimensions if needed.
  for (const quality of [START_QUALITY, 0.7, 0.55]) {
    const out = toJpegDataUrl(img, quality);
    if (out.length <= MAX_DATA_URL_CHARS) return out;
  }
  const tiny = toJpegDataUrl(img, 0.5);
  if (tiny.length <= MAX_DATA_URL_CHARS) return tiny;
  throw new Error(
    "That photo is still too large after compression. Please try a smaller image.",
  );
}

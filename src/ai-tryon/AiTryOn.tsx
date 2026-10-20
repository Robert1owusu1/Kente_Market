import React, { useEffect, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { FaMagic, FaInfoCircle, FaArrowLeft } from "react-icons/fa";
import CameraCapture from "./CameraCapture";
import ImageUpload from "./ImageUpload";
import TryOnPreview from "./TryOnPreview";
import tryOnService, {
  TryOnRequestError,
  newIdempotencyKey,
  type TryOnEligibility,
  type TryOnJob,
} from "./api/tryOnService";
import { useGetProductsDetailsQuery, useGetProductsQuery } from "../slices/productsApiSlice";
import { useGetTryOnStatusQuery } from "../slices/tryOnApiSlice";
import { resolveImageUrl } from "../utils/imageUrl";
import type { Product } from "../types/domain";
import "./AiTryOnStyles.css";

/**
 * AI Virtual Try-On, always for ONE catalog product.
 *
 * The product comes from the URL (`/ai-tryon?product=<id>`, set by the
 * product page's "Try It On" button, a product card, or the picker shown when
 * the page is opened from the menu with no product) and never changes for the
 * life of the session: the AI never picks or substitutes the garment. The browser sends only the customer's photo and that id; the
 * server resolves the product's own image, runs the job, binds the result to
 * the product and serves the image privately to this customer.
 */

const parseProductId = (raw: string | null): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const AiTryOn = () => {
  const [searchParams] = useSearchParams();
  const productId = parseProductId(searchParams.get("product"));

  return (
    <div className="aitryon-page py-12">
      <div className="container">
        <div className="text-center mb-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-medium mb-4">
            <FaMagic /> AI Virtual Try-On
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            See It On You <span className="text-primary">Before You Buy</span>
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Upload a photo and our AI shows you an approximate preview of the
            exact Kente piece you picked from the marketplace.
          </p>
        </div>

        {productId === null ? (
          <ChooseProductFirst />
        ) : (
          // keyed so a different product starts a completely fresh session
          <ProductTryOn key={productId} productId={productId} />
        )}
      </div>
    </div>
  );
};

const PICKER_SIZE = 12;

const inStock = (p: Product) => {
  const raw = p.in_stock ?? p.stock;
  return raw === undefined || raw === null || (Number(raw) || 0) > 0;
};

/**
 * Landing state for the menu links: pick the piece to try on right here.
 * Each choice opens this page for that product; the server still decides
 * whether that product can be tried on.
 */
const ChooseProductFirst = () => {
  const { data: status, isLoading: statusLoading } = useGetTryOnStatusQuery();
  const enabled = Boolean(status?.enabled);
  const { data, isLoading, isError } = useGetProductsQuery({ limit: PICKER_SIZE * 2 }, { skip: !enabled });
  // The list endpoint answers with a plain array (or { products } when a
  // count is requested).
  const list: Product[] = Array.isArray(data) ? data : data?.products || data?.docs || [];
  const products = list.filter(inStock).slice(0, PICKER_SIZE);

  if (statusLoading || (enabled && isLoading)) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary" />
      </div>
    );
  }
  if (!enabled) {
    return <Notice message="AI try-on is offline right now. You can still browse and buy every piece in the marketplace." />;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Choose a piece to try on</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Pick a Kente piece, add a photo of yourself, and see it on you in about a minute.
        </p>
        {isError || products.length === 0 ? (
          <p className="mt-6 text-gray-600 dark:text-gray-300">
            We couldn't load pieces to try on right now.{" "}
            <Link to="/products" className="text-primary underline">Browse the marketplace</Link> and tap <strong>Try on</strong> on any piece.
          </p>
        ) : (
          <ul className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/ai-tryon?product=${encodeURIComponent(String(p.id))}`}
                  className="group block rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <img
                    src={resolveImageUrl(p.img)}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="block p-3">
                    <span className="block text-sm font-medium text-gray-800 dark:text-white line-clamp-2">{p.title || p.name}</span>
                    <span className="block text-sm text-primary font-semibold">GH₵{p.price}</span>
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      <FaMagic aria-hidden="true" /> Try this on
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-center">
          <Link to="/products" className="aitryon-btn-secondary inline-flex">See all Kente</Link>
        </p>
      </div>
    </div>
  );
};

const Notice = ({ message, productId }: { message: string; productId?: number }) => (
  <div className="max-w-xl mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center">
    <FaInfoCircle className="text-3xl text-primary mx-auto mb-3" />
    <p className="text-gray-700 dark:text-gray-200 mb-6" role="status">{message}</p>
    <div className="flex flex-wrap justify-center gap-3">
      {productId !== undefined && (
        <Link to={`/product/${productId}`} className="aitryon-btn-secondary inline-flex">
          <FaArrowLeft className="mr-2" /> Back to product
        </Link>
      )}
      <Link to="/products" className="aitryon-btn-primary inline-flex">
        Browse Kente
      </Link>
    </div>
  </div>
);

type Phase =
  | { name: "idle" }
  | { name: "submitting" }
  | { name: "running"; job: TryOnJob }
  | { name: "loadingResult"; job: TryOnJob }
  | { name: "done"; job: TryOnJob; imageUrl: string }
  | { name: "failed"; message: string; retryable: boolean };

/** Honest progress copy for each real server state. */
const RUNNING_COPY: Record<string, string> = {
  queued: "Waiting for the AI stylist to start your try-on…",
  processing: "The AI is creating your try-on. This usually takes about a minute.",
};

interface ProductTryOnProps {
  productId: number;
}

const ProductTryOn = ({ productId }: ProductTryOnProps) => {
  // The public product endpoint applies the same visibility rules as the
  // product page (approved product, approved vendor).
  const { data: product, isLoading, error: productError } = useGetProductsDetailsQuery(productId);
  const [eligibility, setEligibility] = useState<TryOnEligibility | null>(null);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);

  const [modelImage, setModelImage] = useState<string | null>(null);
  const [captureMethod, setCaptureMethod] = useState<"upload" | "camera">("upload");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    tryOnService
      .getProductEligibility(productId)
      .then((r) => { if (!cancelled) setEligibility(r); })
      .catch((err) => {
        if (!cancelled) {
          setEligibilityError(
            err instanceof TryOnRequestError
              ? err.message
              : "We couldn't check AI try-on for this product. Please try again.",
          );
        }
      });
    return () => { cancelled = true; };
  }, [productId]);

  // Stop polling and release the private result image when leaving the page.
  useEffect(() => () => {
    abortRef.current?.abort();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  if (isLoading || (!eligibility && !eligibilityError && !productError)) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Loading product">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-primary" />
      </div>
    );
  }
  if (productError || !product) {
    return <Notice message="This product isn't available. Please choose another piece from the marketplace." />;
  }
  if (eligibilityError || !eligibility) {
    return <Notice message={eligibilityError || "AI try-on isn't available right now."} productId={productId} />;
  }
  if (!eligibility.enabled) {
    return <Notice message="AI try-on is offline right now. You can still buy this piece from its product page." productId={productId} />;
  }
  if (!eligibility.eligible) {
    return <Notice message={eligibility.reason || "AI try-on isn't available for this product."} productId={productId} />;
  }

  const busy = phase.name === "submitting" || phase.name === "running" || phase.name === "loadingResult";

  const handleGenerate = async () => {
    // Duplicate-submit guard: the button is disabled while busy, and the
    // idempotency key makes a repeat of THIS attempt return the same job.
    if (!modelImage || !consent || busy) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPhase({ name: "submitting" });
    try {
      const created = await tryOnService.createJob(modelImage, productId, newIdempotencyKey());
      setPhase({ name: "running", job: created });
      const finished = await tryOnService.waitForJob(created, productId, (job) => {
        if (!controller.signal.aborted) setPhase({ name: "running", job });
      }, { signal: controller.signal });

      if (finished.status !== "succeeded") {
        setPhase({
          name: "failed",
          message: finished.error?.message || "The AI could not create this try-on. Please try again.",
          retryable: finished.error?.retryable ?? true,
        });
        return;
      }
      setPhase({ name: "loadingResult", job: finished });
      const imageUrl = await tryOnService.getResultObjectUrl(finished.jobId);
      if (controller.signal.aborted) { URL.revokeObjectURL(imageUrl); return; }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = imageUrl;
      setPhase({ name: "done", job: finished, imageUrl });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Try-on generation failed");
      setPhase({
        name: "failed",
        message: err instanceof TryOnRequestError
          ? err.message
          : "The AI stylist is busy right now. Please try again in a moment.",
        retryable: true,
      });
    }
  };

  const handleTryAgain = () => {
    // Same product, fresh photo — and fresh consent for that new photo.
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setModelImage(null);
    setConsent(false);
    setPhase({ name: "idle" });
  };

  if (phase.name === "done" && phase.job.productId === productId) {
    return (
      <div className="max-w-5xl mx-auto">
        <TryOnPreview
          originalImage={modelImage}
          resultImage={phase.imageUrl}
          product={product as Product}
          onTryAgain={handleTryAgain}
        />
      </div>
    );
  }

  const statusText =
    phase.name === "submitting" ? "Sending your photo securely…"
      : phase.name === "running" ? RUNNING_COPY[phase.job.status] || RUNNING_COPY.processing
        : phase.name === "loadingResult" ? "Almost there — loading your try-on…"
          : null;

  return (
    <div className="max-w-5xl mx-auto grid md:grid-cols-5 gap-6">
      <SelectedProductCard product={product as Product} />

      <div className="md:col-span-3 bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
          Add a clear photo of yourself
        </h2>

        {phase.name === "failed" && (
          <div role="alert" className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3 text-red-700 dark:text-red-300">
            <FaInfoCircle className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">{phase.message}</p>
              {phase.retryable && <p className="text-sm mt-1">Your photo is still selected, so you can try again.</p>}
            </div>
          </div>
        )}

        <fieldset disabled={busy} className="disabled:opacity-60">
          <div className="flex gap-2 mb-6">
            {(["upload", "camera"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCaptureMethod(m)}
                aria-pressed={captureMethod === m}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                  captureMethod === m
                    ? "bg-primary text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                }`}
              >
                {m === "upload" ? "Upload Photo" : "Use Camera"}
              </button>
            ))}
          </div>

          {captureMethod === "upload" ? (
            <ImageUpload onImageSelected={setModelImage} label="Upload a photo of yourself" />
          ) : (
            <CameraCapture onCapture={setModelImage} />
          )}

          <ul className="mt-4 text-sm text-gray-600 dark:text-gray-300 list-disc list-inside space-y-1">
            <li>Just you, facing the camera, in good light, against a plain background.</li>
            <li>Show yourself from head to at least your waist.</li>
            <li>JPG, PNG or WebP. Only use a photo of yourself.</li>
          </ul>

          <label className="mt-4 flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1"
            />
            <span>
              I agree that this photo is sent to our AI provider to create this
              preview. We remove location and camera data first and do not
              store your photo; the provider keeps it temporarily to process
              it and then deletes it under its own retention policy (see{" "}
              <Link to="/privacy" className="underline">privacy</Link>). The
              preview image is kept for a limited time and only you can see it.
            </span>
          </label>
        </fieldset>

        <button
          onClick={handleGenerate}
          disabled={!modelImage || !consent || busy}
          aria-busy={busy}
          className="aitryon-btn-primary w-full mt-6"
        >
          {busy ? "Working on it…" : phase.name === "failed" ? "Try again" : `Try On ${product.title}`}
        </button>

        {statusText && (
          <p role="status" aria-live="polite" className="mt-4 text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden="true" />
            {statusText}
          </p>
        )}
      </div>
    </div>
  );
};

/** The product being tried on — fixed, not selectable. */
const SelectedProductCard = ({ product }: { product: Product }) => (
  <div className="md:col-span-2 bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-4 self-start">
    <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">You're trying on</p>
    <img
      src={resolveImageUrl(product.img)}
      alt={product.title}
      className="w-full rounded-xl object-cover max-h-80"
    />
    <h3 className="mt-3 font-semibold text-gray-800 dark:text-white">{product.title}</h3>
    <p className="text-primary font-semibold">GH₵{product.price}</p>
    <Link to={`/product/${product.id}`} className="text-sm text-gray-500 dark:text-gray-400 underline mt-1 inline-block">
      Back to product
    </Link>
  </div>
);

export default AiTryOn;

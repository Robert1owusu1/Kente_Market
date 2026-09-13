import React, { useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { FaArrowLeft, FaMagic, FaStore, FaPalette, FaYarn, FaCalendarAlt, FaImage, FaSpinner, FaTrash } from "react-icons/fa";
import { useGetProductsDetailsQuery } from "../../slices/productsApiSlice";
import { useCreateCustomRequestMutation } from "../../slices/customRequestsApiSlice";
import { useUploadReferenceImageMutation } from "../../slices/uploadApiSlice";
import { resolveImageUrl } from "../../utils/imageUrl";
import Seo from "../../components/Seo/Seo";

const toList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean)
    : typeof v === "string" && v.trim() ? v.split(",").map((x) => x.trim()).filter(Boolean)
    : [];

const DEFAULT_THREADS = ["silver", "silk", "cotton"];

export default function CustomRequestForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: product, isLoading, isError } = useGetProductsDetailsQuery(id as string);

  const [createRequest, { isLoading: submitting }] = useCreateCustomRequestMutation();
  const [uploadReference, { isLoading: uploadingRef }] = useUploadReferenceImageMutation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState("");

  const productColours = useMemo(() => toList(product?.colors || product?.colorsAvailable), [product]);
  const productThreads = useMemo(() => toList(product?.threadTypes), [product]);
  const threads = productThreads.length > 0 ? productThreads : DEFAULT_THREADS;

  const [yards, setYards] = useState("");
  const [selectedColours, setSelectedColours] = useState<string[]>([]);
  const [dominantColour, setDominantColour] = useState("");
  const [selectedThreads, setSelectedThreads] = useState<string[]>([]);
  const [dominantThread, setDominantThread] = useState("");
  const [description, setDescription] = useState("");
  const [referenceImage, setReferenceImage] = useState("");
  const [neededForDate, setNeededForDate] = useState("");
  const [neededForTime, setNeededForTime] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-3xl">Loading...</div>;
  }
  if (isError || !product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-2xl font-semibold">Product not found</p>
        <button onClick={() => navigate("/products")} className="px-6 py-3 bg-primary text-white rounded-xl">
          Browse Kente
        </button>
      </div>
    );
  }

  const toggle = (list: string[], value: string, setter: (v: string[]) => void) => {
    if (list.includes(value)) setter(list.filter((x) => x !== value));
    else setter([...list, value]);
  };

  const minDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const handleReferenceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setUploadError("");
    if (!file) return;
    if (!/image\/(jpeg|jpg|png|gif|webp)/.test(file.type)) {
      setUploadError("Please choose an image file (JPG, PNG, GIF or WebP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Image is too large — keep it under 5MB.");
      return;
    }
    const formData = new FormData();
    formData.append("image", file);
    try {
      const res = await uploadReference(formData).unwrap();
      if (res.image) {
        setReferenceImage(String(res.image));
        toast.success("Reference image uploaded");
      } else {
        setUploadError("Upload didn't return an image URL. Try again.");
      }
    } catch (err) {
      const msg = (err as { data?: { message?: string }; message?: string })?.data?.message ||
        (err as { message?: string })?.message ||
        "Upload failed — try again.";
      setUploadError(msg);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const yardNum = parseFloat(yards);
    if (!yardNum || yardNum <= 0) errors.yards = "How many yards do you need?";
    if (selectedColours.length === 0) errors.colours = "Pick at least one colour stamp";
    if (!dominantColour) errors.dominantColour = "Which colour should dominate?";
    if (selectedThreads.length === 0) errors.threads = "Pick the thread types to use";
    if (!neededForDate) errors.neededForDate = "Pick the date you need it by";
    if (!neededForTime) errors.neededForTime = "Pick the time you need it by";
    if (description.trim().length < 10) errors.description = "Please add a short description (10+ characters)";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }

    try {
      const request = await createRequest({
        vendorId: Number(product.vendorId),
        productId: product.id as number,
        yards: yardNum,
        colours: selectedColours,
        dominantColour,
        threadTypes: selectedThreads,
        dominantThread,
        description: description.trim(),
        referenceImage: referenceImage.trim() || undefined,
        neededForDate,
        neededForTime,
      }).unwrap();
      toast.success(request?.message || "Request sent to the vendor!");
      navigate("/custom-requests");
    } catch (err) {
      const msg = (err as { data?: { message?: string } })?.data?.message || "Could not send the request. Try again.";
      toast.error(msg);
    }
  };

  const fieldClass = (hasError: boolean, extra = "") =>
    `w-full px-4 py-3 rounded-xl border-2 bg-transparent focus:outline-none transition ${
      hasError ? "border-red-500" : "border-gray-300 dark:border-gray-600 focus:border-primary"
    } ${extra}`;

  return (
    <>
      <Seo title="Customize Kente | Bonwire Kente Marketplace" />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10">
        <div className="max-w-3xl mx-auto px-4">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary transition mb-6">
            <FaArrowLeft /> Back
          </button>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-2">
              <span className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-2xl">
                <FaMagic />
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Customize Your Kente</h1>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
              Describe exactly what you want — the weaver quotes a price and timeline, then you approve and pay securely.
            </p>

            {/* Base product */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-gray-100 dark:bg-gray-700/50 mb-6">
              <img src={resolveImageUrl(product.img)} alt={product.title} className="w-16 h-16 rounded-lg object-cover" />
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-white">{product.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {product.patternName ? `${product.patternName} · ` : ""}{product.category}
                </p>
              </div>
              <div className="flex items-center gap-2 text-primary text-sm">
                <FaStore /> {product.vendorBusinessName || "Weaver"}
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Yards */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Yards needed (even numbers are standard for kente)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={yards}
                  onChange={(e) => setYards(e.target.value)}
                  placeholder="e.g. 6"
                  className={fieldClass(!!fieldErrors.yards)}
                />
                {fieldErrors.yards && <p className="text-xs text-red-500 mt-1">{fieldErrors.yards}</p>}
              </div>

              {/* Colours */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                  <FaPalette /> Colour stamps (tap to choose)
                </label>
                <div className="flex flex-wrap gap-2">
                  {productColours.map((c) => {
                    const active = selectedColours.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggle(selectedColours, c, setSelectedColours)}
                        className={`px-4 py-2 rounded-xl border-2 text-sm font-medium transition ${
                          active
                            ? "border-primary bg-primary text-white"
                            : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
                {fieldErrors.colours && <p className="text-xs text-red-500 mt-1">{fieldErrors.colours}</p>}

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mt-3 mb-1">Dominant colour</label>
                <select value={dominantColour} onChange={(e) => setDominantColour(e.target.value)} className={fieldClass(!!fieldErrors.dominantColour)}>
                  <option value="">Choose the dominant colour…</option>
                  {selectedColours.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {fieldErrors.dominantColour && <p className="text-xs text-red-500 mt-1">{fieldErrors.dominantColour}</p>}
              </div>

              {/* Thread */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                  <FaYarn /> Thread types
                </label>
                <div className="flex flex-wrap gap-2">
                  {threads.map((t) => {
                    const active = selectedThreads.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggle(selectedThreads, t, setSelectedThreads)}
                        className={`px-4 py-2 rounded-xl border-2 text-sm font-medium transition ${
                          active
                            ? "border-primary bg-primary text-white"
                            : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
                {fieldErrors.threads && <p className="text-xs text-red-500 mt-1">{fieldErrors.threads}</p>}

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mt-3 mb-1">Dominant thread</label>
                <select value={dominantThread} onChange={(e) => setDominantThread(e.target.value)} className={fieldClass(false)}>
                  <option value="">Choose the dominant thread…</option>
                  {selectedThreads.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">About the piece (occasion, pattern meaning, any details)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="e.g. A Double Weaving Oyoko for our wedding in November — we'd like the centre panel to keep the traditional Oyoko stripes…"
                  className={fieldClass(!!fieldErrors.description)}
                />
                {fieldErrors.description && <p className="text-xs text-red-500 mt-1">{fieldErrors.description}</p>}
              </div>

              {/* Reference image */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Reference image (optional — upload a photo or sketch of the pattern you'd like)
                </label>
                {referenceImage ? (
                  <div className="relative w-40 h-40 rounded-xl overflow-hidden border-2 border-gray-200 dark:border-gray-600">
                    <img
                      src={resolveImageUrl(referenceImage)}
                      alt="Reference sketch"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setReferenceImage("")}
                      className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-red-600 transition"
                      aria-label="Remove reference image"
                    >
                      <FaTrash className="text-xs" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingRef}
                    className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 flex flex-col items-center gap-2 text-gray-500 dark:text-gray-400 hover:border-primary hover:text-primary transition disabled:opacity-50"
                  >
                    {uploadingRef ? <FaSpinner className="animate-spin text-xl" /> : <FaImage className="text-2xl" />}
                    <span className="text-sm font-medium">{uploadingRef ? "Uploading…" : "Click to upload a reference image"}</span>
                    <span className="text-xs">JPG, PNG, GIF or WebP · up to 5MB</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  onChange={handleReferenceFile}
                  className="hidden"
                />
                {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
              </div>

              {/* Timeline */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                    <FaCalendarAlt /> Needed by date
                  </label>
                  <input type="date" min={minDate} value={neededForDate} onChange={(e) => setNeededForDate(e.target.value)} className={fieldClass(!!fieldErrors.neededForDate)} />
                  {fieldErrors.neededForDate && <p className="text-xs text-red-500 mt-1">{fieldErrors.neededForDate}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Needed by time</label>
                  <input type="time" value={neededForTime} onChange={(e) => setNeededForTime(e.target.value)} className={fieldClass(!!fieldErrors.neededForTime)} />
                  {fieldErrors.neededForTime && <p className="text-xs text-red-500 mt-1">{fieldErrors.neededForTime}</p>}
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? "Sending…" : "Send Request to Weaver"}
              </button>
              <p className="text-xs text-gray-400 text-center">
                No payment now — the weaver replies with a quote and timeline. You approve before you pay.
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
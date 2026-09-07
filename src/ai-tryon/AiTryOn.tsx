import React, { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { FaUserEdit, FaChair, FaMagic, FaInfoCircle, FaCheckCircle } from "react-icons/fa";
import CameraCapture from "./CameraCapture";
import ImageUpload from "./ImageUpload";
import StyleSelector from "./StyleSelector";
import TryOnPreview from "./TryOnPreview";
import DecorateMode from "./DecorateMode";
import tryOnService from "./api/tryOnService";
import { SAMPLE_PRODUCTS, getProductById } from "../allProductsData/products";
import { useGetProductsDetailsQuery } from "../slices/productsApiSlice";
import type { Product } from "../types/domain";
import "./AiTryOnStyles.css";

const AiTryOn = () => {
  const [searchParams] = useSearchParams();
  const productIdParam = searchParams.get("product");

  const [mode, setMode] = useState("wear"); // "wear" | "decorate"
  const [step, setStep] = useState(1); // 1: upload, 2: select style, 3: result
  const [modelImage, setModelImage] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [captureMethod, setCaptureMethod] = useState("upload"); // "upload" | "camera"

  // Fetch the real product from the backend when navigating here from a
  // product detail page. The product detail page uses DB products (any id),
  // not the static SAMPLE_PRODUCTS, so we must fetch it to preselect the
  // exact cloth the user was viewing.
  const productIdForQuery = productIdParam ? parseInt(productIdParam) : null;
  const { data: dbProduct } = useGetProductsDetailsQuery(productIdForQuery!, {
    skip: !productIdParam,
  });

  // If product ID passed in URL, preselect it
  useEffect(() => {
    if (productIdParam) {
      const parsedId = parseInt(productIdParam);
      // Prefer the real DB product so the try-on matches the item the user
      // was viewing. Fall back to the static catalog for demo product ids.
      const product =
        dbProduct && dbProduct.id !== undefined && dbProduct.id !== null
          ? dbProduct
          : getProductById(parsedId);
      if (product) {
        setSelectedProduct(product as Product);
        setStep(2);
      }
    }
  }, [productIdParam, dbProduct]);

  const handleModeChange = (newMode: string) => {
    setMode(newMode);
    setStep(1);
    setModelImage(null);
    setResultImage(null);
    setSelectedProduct(null);
    setError(null);
  };

  const handleProductSelect = (product: Product) => {
    setSelectedProduct(product);
  };

  const handleGenerate = async () => {
    if (!modelImage || !selectedProduct) {
      setError("Please upload your photo and select a Kente cloth first.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProcessingMessage("Contacting the AI stylist...");

    try {
      setProcessingMessage("Reading your photo and the Kente weave...");
      const result = await tryOnService.generateTryOn(
        modelImage,
        selectedProduct.img as string,
        selectedProduct.title as string,
        selectedProduct.category as string
      );
      setResultImage(result.output as string | null);
      setStep(3);
    } catch (err) {
      console.error("Try-on generation error:", err);
      // Fallback: show a local visual preview using the model photo with an overlay note
      setError(
        "The AI stylist is busy right now. Please try again in a moment, or use our canvas preview below."
      );
      // Provide a graceful fallback by showing the model image marked as preview
      setResultImage(modelImage);
      setStep(3);
    } finally {
      setIsProcessing(false);
      setProcessingMessage("");
    }
  };

  const handleReset = () => {
    setStep(1);
    setModelImage(null);
    setResultImage(null);
    setSelectedProduct(null);
    setError(null);
  };

  return (
    <div className="aitryon-page py-12">
      <div className="container">
        {/* Page Header */}
        <div className="text-center mb-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-medium mb-4">
            <FaMagic /> AI Virtual Try-On
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">
            Try On Bonwire Kente <span className="text-primary">Before You Buy</span>
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            See yourself wearing authentic Ghanaian Kente cloth, or preview how
            it transforms your home — all powered by AI.
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3 text-red-700 dark:text-red-300">
            <FaInfoCircle className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">{error}</p>
              <p className="text-sm mt-1">
                You can still preview the weaving style visually. For the best
                photorealistic result, ensure your FASHN API key is configured.
              </p>
            </div>
          </div>
        )}

        {/* Mode Selector */}
        <div className="max-w-xl mx-auto mb-10 bg-white dark:bg-gray-800 rounded-2xl p-2 shadow-lg grid grid-cols-2 gap-2">
          <button
            onClick={() => handleModeChange("wear")}
            className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold transition-all ${
              mode === "wear"
                ? "bg-gradient-to-r from-primary to-secondary text-white shadow-md"
                : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            <FaUserEdit /> Wear Mode
          </button>
          <button
            onClick={() => handleModeChange("decorate")}
            className={`flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold transition-all ${
              mode === "decorate"
                ? "bg-gradient-to-r from-primary to-secondary text-white shadow-md"
                : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            <FaChair /> Decorate Mode
          </button>
        </div>

        {mode === "wear" ? (
          <div>
            {/* Step Indicator */}
            <div className="max-w-2xl mx-auto flex items-center justify-center gap-2 mb-10">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                      step >= i
                        ? "bg-primary text-white"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-500"
                    }`}
                  >
                    {step > i ? <FaCheckCircle /> : i}
                  </div>
                  {i < 3 && (
                    <div
                      className={`w-16 h-1 rounded-full ${
                        step > i ? "bg-primary" : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    ></div>
                  )}
                </div>
              ))}
            </div>

            {/* Step 1: Upload photo */}
            {step === 1 && (
              <div className="max-w-2xl mx-auto">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 mb-6">
                  <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
                    📸 Step 1: Upload a clear photo of yourself
                  </h2>

                  {/* Upload method toggle */}
                  <div className="flex gap-2 mb-6">
                    <button
                      onClick={() => setCaptureMethod("upload")}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                        captureMethod === "upload"
                          ? "bg-primary text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      Upload Photo
                    </button>
                    <button
                      onClick={() => setCaptureMethod("camera")}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                        captureMethod === "camera"
                          ? "bg-primary text-white"
                          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      Use Camera
                    </button>
                  </div>

                  {captureMethod === "upload" ? (
                    <ImageUpload
                      onImageSelected={setModelImage}
                      label="Upload a photo of yourself"
                    />
                  ) : (
                    <CameraCapture onCapture={setModelImage} />
                  )}

                  {modelImage && (
                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={() => setStep(2)}
                        className="aitryon-btn-primary"
                      >
                        Continue to Select Kente →
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-200">
                  <p className="font-medium mb-1">💡 Tips for best results:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Face the camera directly with good lighting</li>
                    <li>Avoid busy backgrounds — plain is best</li>
                    <li>Wear simple clothing so the Kente stands out</li>
                    <li>Photo should show from head to at least your waist</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Step 2: Select Kente style */}
            {step === 2 && (
              <div className="max-w-4xl mx-auto">
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6">
                  <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
                    🪡 Step 2: Choose your Kente cloth
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    Select which Bonwire Kente piece you'd like to try on. The
                    AI will drape it on your photo.
                  </p>

                  <StyleSelector
                    selected={selectedProduct}
                    onSelect={handleProductSelect}
                  />

                  <div className="mt-6 flex justify-between">
                    <button
                      onClick={() => setStep(1)}
                      className="aitryon-btn-secondary"
                    >
                      ← Back
                    </button>
                    <button
                      onClick={handleGenerate}
                      disabled={!selectedProduct || isProcessing}
                      className="aitryon-btn-primary"
                    >
                      {isProcessing
                        ? `✨ ${processingMessage || "Processing..."}`
                        : "✨ Generate My Try-On"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Result */}
            {step === 3 && (
              <div className="max-w-4xl mx-auto">
                <TryOnPreview
                  originalImage={modelImage}
                  resultImage={resultImage}
                  product={selectedProduct}
                  onReset={handleReset}
                />
              </div>
            )}
          </div>
        ) : (
          /* Decorate Mode */
          <div className="max-w-5xl mx-auto">
            <DecorateMode
              product={selectedProduct}
              onProductChange={setSelectedProduct}
            />
            <div className="mt-8 text-center max-w-2xl mx-auto">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Not sure which Kente piece to try? Browse our full collection.
              </p>
              <Link to="/products" className="aitryon-btn-primary inline-flex">
                Browse All Kente Cloth →
              </Link>
            </div>
          </div>
        )}

        {/* Feature cards */}
        <div className="grid sm:grid-cols-3 gap-6 mt-16 max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg text-center">
            <div className="text-4xl mb-3">🪞</div>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-2">
              Photorealistic Wear Try-On
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Using the FASHN.ai virtual try-on engine, see your exact photo
              wearing the Kente with realistic fabric draping.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg text-center">
            <div className="text-4xl mb-3">🏠</div>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-2">
              Decorate Your Home
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Preview Kente as a table runner, wall hanging, or sofa throw by
              uploading a photo of your own room.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg text-center">
            <div className="text-4xl mb-3">🛡️</div>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-2">
              100% Authentic & GI-Certified
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Every Kente in our catalog is handwoven in Bonwire, Ghana — a
              UNESCO-recognized and GI-protected heritage craft.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiTryOn;

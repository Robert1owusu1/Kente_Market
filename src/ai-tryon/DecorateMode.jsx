import React, { useRef, useState, useEffect } from "react";
import { FaChair, FaHome, FaSyncAlt, FaDownload } from "react-icons/fa";
import { SAMPLE_PRODUCTS } from "../allProductsData/products";
import "./AiTryOnStyles.css";

const DECOR_TEMPLATES = [
  {
    id: "table-runner",
    name: "Table Runner",
    icon: <FaHome />,
    description: "Drape across a table/console",
    overlay: (ctx, w, h) => {
      const runnerW = w * 0.75;
      const runnerH = h * 0.12;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#000";
      ctx.fillRect(w * 0.5 - runnerW / 2, h * 0.35, runnerW, runnerH);
    },
  },
  {
    id: "wall-hanging",
    name: "Wall Hanging",
    icon: <FaHome />,
    description: "Hang on a wall",
    overlay: (ctx, w, h) => {
      const wallW = w * 0.6;
      const wallH = h * 0.5;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#000";
      ctx.fillRect(w * 0.5 - wallW / 2, h * 0.15, wallW, wallH);
    },
  },
  {
    id: "sofa-throw",
    name: "Sofa Throw",
    icon: <FaChair />,
    description: "Drape over furniture",
    overlay: (ctx, w, h) => {
      const throwW = w * 0.6;
      const throwH = h * 0.3;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#000";
      ctx.fillRect(w * 0.5 - throwW / 2, h * 0.45, throwW, throwH);
    },
  },
  {
    id: "full-cloth",
    name: "Full Cloth Cover",
    icon: <FaHome />,
    description: "Cover a large surface",
    overlay: (ctx, w, h) => {
      const coverW = w * 0.85;
      const coverH = h * 0.55;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#000";
      ctx.fillRect(w * 0.5 - coverW / 2, h * 0.3, coverW, coverH);
    },
  },
];

const DecorateMode = ({ product, onProductChange }) => {
  const canvasRef = useRef(null);
  const [roomImage, setRoomImage] = useState(null);
  const [template, setTemplate] = useState(DECOR_TEMPLATES[0]);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Kente products suitable for decoration
  const decorProducts = SAMPLE_PRODUCTS.filter(
    (p) =>
      p.category === "Kente Decor" ||
      p.category === "Kente Wraps" ||
      p.category === "Ceremonial Cloths"
  );

  const handleRoomUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setRoomImage(ev.target.result);
      setImageLoaded(true);
    };
    reader.readAsDataURL(file);
  };

  const handleTemplateChange = (t) => {
    setTemplate(t);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `bonwire-kente-decor-${template.name.replace(/\s+/g, "-").toLowerCase()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !roomImage) return;

    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // If a product is selected, draw the kente pattern overlay
      if (product && template) {
        template.overlay(ctx, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0;
      }
    };
    img.src = roomImage;
  }, [roomImage, product, template]);

  return (
    <div className="aitryon-decor bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6">
      <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2 flex items-center gap-2">
        <FaChair /> Decorate Mode
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Upload a photo of your room, choose which Kente piece to add, and see
        how it elevates your space as a table runner, wall hanging, or throw.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left column - controls */}
        <div>
          {/* Room photo upload */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              1. Upload a photo of your room
            </label>
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center hover:border-primary transition-colors cursor-pointer">
              {roomImage ? (
                <div className="relative">
                  <img
                    src={roomImage}
                    alt="Your room"
                    className="max-h-40 mx-auto rounded-lg object-cover"
                  />
                  <button
                    onClick={() => {
                      setRoomImage(null);
                      setImageLoaded(false);
                    }}
                    className="absolute top-2 right-2 bg-red-500 text-white text-xs px-2 py-1 rounded hover:bg-red-600"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer block">
                  <span className="text-3xl mb-2 block">🏠</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Click to upload room photo
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleRoomUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {/* Decor placement template */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              2. Choose where to place the Kente
            </label>
            <div className="grid grid-cols-2 gap-2">
              {DECOR_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTemplateChange(t)}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${
                    template.id === t.id
                      ? "border-primary bg-primary/10"
                      : "border-gray-200 dark:border-gray-700 hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-primary">{t.icon}</span>
                    <span className="text-sm font-semibold text-gray-800 dark:text-white">
                      {t.name}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Product selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              3. Choose the Kente piece
            </label>
            <select
              value={product?.id || ""}
              onChange={(e) => {
                const p = decorProducts.find((x) => x.id === parseInt(e.target.value));
                onProductChange(p);
              }}
              className="w-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a Kente piece...</option>
              {decorProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} — GH₵{p.price}
                </option>
              ))}
            </select>
          </div>

          {roomImage && (
            <button
              onClick={handleDownload}
              className="w-full aitryon-btn-primary mt-2"
            >
              <FaDownload className="mr-2" /> Download Preview
            </button>
          )}
        </div>

        {/* Right column - preview */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Preview
          </label>
          <div className="border-2 border-gray-300 dark:border-gray-600 rounded-xl overflow-hidden relative min-h-[300px] bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
            {imageLoaded && roomImage ? (
              <canvas ref={canvasRef} className="max-w-full max-h-[400px] object-contain" />
            ) : (
              <div className="text-center p-8">
                <FaSyncAlt className="text-4xl text-gray-300 mx-auto mb-3 animate-spin-slow" />
                <p className="text-gray-500 dark:text-gray-400">
                  Upload a room photo to see your Kente decoration preview
                </p>
              </div>
            )}
            {product && imageLoaded && (
              <div className="absolute bottom-2 left-2 bg-primary text-white text-xs px-3 py-1 rounded-full shadow">
                {product.title} • {template.name}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DecorateMode;

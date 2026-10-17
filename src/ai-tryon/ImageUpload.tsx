import React, { useCallback, useState } from "react";
import { FaCloudUploadAlt, FaImage, FaTimes } from "react-icons/fa";
import { prepareTryOnImage } from "./utils/prepareTryOnImage";
import "./AiTryOnStyles.css";

interface ImageUploadProps {
  onImageSelected: (dataUrl: string | null) => void;
  label?: string;
}

const ImageUpload = ({ onImageSelected, label = "Upload your photo" }: ImageUploadProps) => {
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file || isPreparing) return;
      setError(null);
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image file (JPG, PNG or WebP).");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError("Image is too large. Maximum size is 10MB.");
        return;
      }
      setIsPreparing(true);
      try {
        const raw = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const result = e.target?.result;
            if (typeof result === "string") resolve(result);
            else reject(new Error("Could not read that image file."));
          };
          reader.onerror = () => reject(new Error("Could not read that image file."));
          reader.readAsDataURL(file);
        });
        // Downscale + strip EXIF client-side so the JSON payload fits the
        // API's body limit and the photo leaves the device without metadata.
        const prepared = await prepareTryOnImage(raw);
        setPreview(prepared);
        onImageSelected(prepared);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not process that image.");
        onImageSelected(null);
      } finally {
        setIsPreparing(false);
      }
    },
    [onImageSelected, isPreparing]
  );

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const clearImage = () => {
    setPreview(null);
    setError(null);
    onImageSelected(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="aitryon-upload">
      {!preview ? (
        <div
          className={`aitryon-upload-area ${dragOver ? "aitryon-drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <FaCloudUploadAlt className="text-5xl text-primary mb-3" />
          <p className="font-medium text-gray-700 dark:text-gray-200">{label}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {isPreparing ? "Preparing your photo…" : "Drag & drop your photo here, or click to browse"}
          </p>
          {error && <p className="aitryon-error text-sm mt-2">{error}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            JPG, PNG or WebP • Max 10MB • Front-facing photo recommended
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden group">
          <img
            src={preview}
            alt="Your uploaded photo"
            className="w-full h-80 object-cover"
          />
          <button
            onClick={clearImage}
            className="absolute top-2 right-2 bg-black/60 text-white p-2 rounded-full hover:bg-black/80 transition-all"
            title="Remove photo"
          >
            <FaTimes />
          </button>
          <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1">
            <FaImage /> Photo ready
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;

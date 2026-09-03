import React, { useCallback, useState } from "react";
import { FaCloudUploadAlt, FaImage, FaTimes } from "react-icons/fa";
import "./AiTryOnStyles.css";

const ImageUpload = ({ onImageSelected, label = "Upload your photo" }) => {
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileInputRef = React.useRef(null);

  const handleFile = useCallback(
    (file) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert("Please upload an image file (JPG, PNG).");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        alert("Image is too large. Maximum size is 10MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        setPreview(dataUrl);
        onImageSelected(dataUrl);
      };
      reader.readAsDataURL(file);
    },
    [onImageSelected]
  );

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const clearImage = () => {
    setPreview(null);
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
            Drag & drop your photo here, or click to browse
          </p>
          <p className="text-xs text-gray-400 mt-2">
            JPG or PNG • Max 10MB • Front-facing photo recommended
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
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

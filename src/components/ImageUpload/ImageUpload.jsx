import React, { useState, useRef, useEffect } from 'react';
import { FaImage, FaTrash, FaSpinner } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useUploadImageMutation } from '../../slices/uploadApiSlice';

const ImageUpload = ({ currentImage, onImageChange, isLoading }) => {
  const [preview, setPreview] = useState(currentImage || null);
  const [uploadImage, { isLoading: uploading }] = useUploadImageMutation();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const previewUrlRef = useRef(null);

  // Cleanup preview URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrlRef.current && previewUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const handleFileSelect = async (file) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }

    // Clean up previous preview URL if it exists
    if (previewUrlRef.current && previewUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrlRef.current);
    }

    // Create object URL for preview (more efficient than base64)
    const objectUrl = URL.createObjectURL(file);
    previewUrlRef.current = objectUrl;
    setPreview(objectUrl);

    // Upload to server
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await uploadImage(formData).unwrap();
      
      // Replace object URL with server URL
      URL.revokeObjectURL(objectUrl);
      previewUrlRef.current = response.image;
      setPreview(response.image);
      
      onImageChange(response.image);
      toast.success('Image uploaded successfully');
    } catch (error) {
      console.error('Upload error:', error);
      
      // More specific error messages
      if (error?.status === 413) {
        toast.error('Image file is too large. Please compress it and try again.');
      } else if (error?.data?.message) {
        toast.error(error.data.message);
      } else {
        toast.error('Failed to upload image');
      }
      
      // Revert to previous image
      URL.revokeObjectURL(objectUrl);
      previewUrlRef.current = currentImage;
      setPreview(currentImage);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileInput = (e) => {
    const file = e.target.files[0];
    handleFileSelect(file);
  };

  const handleRemove = () => {
    // Clean up object URL
    if (previewUrlRef.current && previewUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    
    previewUrlRef.current = null;
    setPreview(null);
    onImageChange('');
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
        Product Image
      </label>
      
      {preview ? (
        <div className="relative group">
          <img 
            src={preview} 
            alt="Product preview" 
            className="w-full h-64 object-cover rounded-lg border-2 border-gray-300 dark:border-gray-600 transition-all"
          />
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all rounded-lg flex items-center justify-center">
            <button
              type="button"
              onClick={handleRemove}
              disabled={isLoading || uploading}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-3 bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-50 transform hover:scale-110"
              title="Remove image"
            >
              <FaTrash size={20} />
            </button>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all duration-300 ${
            isDragging
              ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 scale-105'
              : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <FaImage className="mx-auto text-5xl text-gray-400 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 font-medium mb-2">
            Drag and drop an image here
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            or click to browse
          </p>
          <p className="text-xs text-gray-400">
            Supports: JPG, PNG, GIF, WEBP • Max size: 5MB
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
        onChange={handleFileInput}
        className="hidden"
        disabled={isLoading || uploading}
      />

      {uploading && (
        <div className="flex items-center justify-center gap-2 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3">
          <FaSpinner className="animate-spin text-lg" />
          <span className="font-medium">Uploading image...</span>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
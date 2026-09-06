import React, { useRef, useState, useEffect } from "react";
import { FaCamera, FaRedo } from "react-icons/fa";
import { MdCameraswitch } from "react-icons/md";
import "./AiTryOnStyles.css";

const CameraCapture = ({ onCapture }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [facingMode, setFacingMode] = useState("user");
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsActive(true);
    } catch (err) {
      console.error("Camera error:", err);
      setError(
        "Unable to access camera. Please allow camera permission or upload a photo instead."
      );
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsActive(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const switchCamera = async () => {
    stopCamera();
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Flash effect
    setFlash(true);
    setTimeout(() => setFlash(false), 300);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    onCapture(dataUrl);
    stopCamera();
  };

  return (
    <div className="aitryon-camera">
      {!isActive ? (
        <div className="aitryon-camera-idle">
          {error && <p className="aitryon-error">{error}</p>}
          <div className="aitryon-camera-icons">
            <FaCamera className="text-5xl text-gray-300" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Use your webcam to take a photo of yourself
          </p>
          <button onClick={startCamera} className="aitryon-btn-primary">
            <FaCamera className="mr-2" /> Start Camera
          </button>
        </div>
      ) : (
        <div className="relative rounded-xl overflow-hidden bg-black">
          <video
            ref={videoRef}
            className="w-full h-80 object-cover"
            muted
            playsInline
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-52 h-80 border-2 border-dashed border-white/60 rounded-xl opacity-70"></div>
          </div>
          {flash && <div className="absolute inset-0 bg-white animate-pulse opacity-50"></div>}
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
            <button
              onClick={switchCamera}
              className="aitryon-btn-secondary"
              title="Switch camera"
            >
              <MdCameraswitch />
            </button>
            <button
              onClick={capturePhoto}
              className="aitryon-btn-capture"
              title="Take photo"
            >
              <FaCamera />
            </button>
            <button
              onClick={stopCamera}
              className="aitryon-btn-secondary"
              title="Stop camera"
            >
              <FaRedo />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraCapture;

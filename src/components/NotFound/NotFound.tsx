import React from "react";
import { Link } from "react-router-dom";
import { FaCompass } from "react-icons/fa";
import Footer from "../Footer/Footer";

// Rendered by the catch-all route, so it sits outside Layout and brings its
// own chrome. The footer gives a dead-end page somewhere to navigate to.
const NotFound = () => {
  return (
    <div className="min-h-screen w-full flex flex-col bg-gradient-to-br from-slate-900 via-[#431407] to-slate-800">
      <div className="flex-1 w-full flex items-center justify-center px-4 py-16 text-center">
        <div className="max-w-md">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/20 mb-6">
            <FaCompass className="text-3xl text-primary" aria-hidden="true" />
          </div>

          <h1 className="text-6xl sm:text-7xl font-extrabold text-primary leading-none">
            404
          </h1>
          <h2 className="text-2xl font-semibold text-white mt-4">
            Page Not Found
          </h2>
          <p className="text-white/70 mt-3">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          <Link
            to="/"
            className="inline-block mt-8 px-8 py-3 rounded-lg bg-primary text-[#431407] font-semibold transition-opacity duration-200 hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
          >
            Go Home
          </Link>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default NotFound;
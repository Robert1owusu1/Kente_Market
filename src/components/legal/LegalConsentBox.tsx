// components/legal/LegalConsentBox.tsx
// Compact "read & accept our legal documents" panel. Rendered on the Register
// and Login pages so that signing up (email or Google) requires agreeing to the
// Terms of Service and Privacy Policy before continuing.
import React from "react";
import type { LegalDoc } from "../../hooks/useLegalConsent";

type LegalConsentBoxProps = {
  acceptedDocs: Record<LegalDoc, boolean>;
  bothAccepted: boolean;
  openDoc: (doc: LegalDoc) => void;
  disabled?: boolean;
};

const LegalConsentBox: React.FC<LegalConsentBoxProps> = ({
  acceptedDocs,
  bothAccepted,
  openDoc,
  disabled,
}) => (
  <div className="space-y-3">
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
      <p className="text-white/80 text-sm font-medium">
        To sign up with Google, please read and accept our legal documents:
      </p>
      <button
        type="button"
        onClick={() => openDoc("terms")}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 transition-colors text-left disabled:opacity-50"
      >
        <span className="text-white text-sm">Terms of Service</span>
        <span
          className={`text-xs px-2.5 py-1 rounded-full ${
            acceptedDocs.terms
              ? "bg-green-500/20 text-green-400"
              : "bg-amber-400/20 text-amber-300"
          }`}
        >
          {acceptedDocs.terms ? "Accepted" : "Read & Accept"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => openDoc("privacy")}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 transition-colors text-left disabled:opacity-50"
      >
        <span className="text-white text-sm">Privacy Policy</span>
        <span
          className={`text-xs px-2.5 py-1 rounded-full ${
            acceptedDocs.privacy
              ? "bg-green-500/20 text-green-400"
              : "bg-amber-400/20 text-amber-300"
          }`}
        >
          {acceptedDocs.privacy ? "Accepted" : "Read & Accept"}
        </span>
      </button>
    </div>

    <label
      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
        bothAccepted
          ? "bg-green-500/10 border border-green-500/20 cursor-pointer"
          : "bg-white/5 border border-white/10 opacity-70"
      }`}
    >
      <input
        type="checkbox"
        checked={bothAccepted}
        readOnly
        className="w-4 h-4 text-amber-400 bg-transparent border-white/30 rounded focus:ring-amber-400 focus:ring-2 mt-0.5"
        disabled={disabled}
      />
      <span className="text-white/80 text-sm leading-relaxed">
        I have read and agree to the{" "}
        <button
          type="button"
          onClick={() => openDoc("terms")}
          className="text-amber-400 hover:text-amber-300 underline disabled:opacity-50"
          disabled={disabled}
        >
          Terms of Service
        </button>{" "}
        and{" "}
        <button
          type="button"
          onClick={() => openDoc("privacy")}
          className="text-amber-400 hover:text-amber-300 underline disabled:opacity-50"
          disabled={disabled}
        >
          Privacy Policy
        </button>
      </span>
    </label>

    {!bothAccepted && (
      <p className="text-amber-300 text-sm">
        Please open each document and scroll to the bottom to accept before continuing.
      </p>
    )}
  </div>
);

export default LegalConsentBox;
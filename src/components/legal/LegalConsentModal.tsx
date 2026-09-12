// components/legal/LegalConsentModal.tsx
// Full-screen modal that renders a legal document (Terms of Service or Privacy
// Policy) with the read-to-bottom-before-you-can-agree gate, shared by both the
// Register and Login flows.
import React from "react";
import LegalDocument from "./LegalDocument";
import { termsOfService, privacyPolicy } from "./legalContent";
import type { LegalDoc } from "../../hooks/useLegalConsent";

type LegalConsentModalProps = {
  activeDoc: LegalDoc | null;
  onClose: () => void;
  onAgree: (doc: LegalDoc) => void;
};

const LegalConsentModal: React.FC<LegalConsentModalProps> = ({
  activeDoc,
  onClose,
  onAgree,
}) => {
  if (!activeDoc) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-white font-semibold">
            {activeDoc === "terms" ? "Terms of Service" : "Privacy Policy"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <LegalDocument
            {...(activeDoc === "terms" ? termsOfService : privacyPolicy)}
            embedded
            agreeButtonLabel="I Agree"
            onAgree={() => onAgree(activeDoc)}
            footerNode={
              <button
                type="button"
                onClick={onClose}
                className="w-full text-center text-white/60 hover:text-white text-sm py-1 transition-colors"
              >
                Cancel
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
};

export default LegalConsentModal;
// components/legal/TermsReconsentGate.tsx
// Terms/consent versioning: a blocking overlay shown to any signed-in session
// whose account has not accepted the CURRENT revision (backend answers
// `needsReConsent: terms_version < TERMS_VERSION` on login and on every
// profile fetch). Without this, a Terms/Privacy update would only ever bind
// new signups — the whole point of versioning is that it reaches everyone.
//
// Consent properties honoured here:
//   - deliberate: both documents must be opened AND agreed in THIS sitting;
//     a stale sessionStorage flag left over from signup must not satisfy a
//     version bump, so useLegalConsent's persistence is deliberately NOT
//     reused (see the local `agreed` state);
//   - sequential: accepting Terms opens Privacy next, so neither can be
//     skipped — the read-to-bottom gate inside LegalDocument does the rest;
//   - explicit: the final "Accept and continue" button is a separate,
//     server-recording action, not a side effect of closing a document;
//   - escape hatch: "Log out" ends the session server-side (cookie cleared)
//     for a user who does not accept — they are not trapped in the app.
import React, { useState } from "react";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../store";
import { setCredentials, logout } from "../../slices/authSlice";
import {
  useAcceptTermsMutation,
  useLogoutMutation,
} from "../../slices/usersApiSlice";
import LegalConsentModal from "./LegalConsentModal";
import type { LegalDoc } from "../../hooks/useLegalConsent";

const TermsReconsentGate: React.FC = () => {
  const dispatch = useAppDispatch();
  const { userInfo } = useAppSelector((state) => state.auth);
  const [acceptTerms, { isLoading: isAccepting }] = useAcceptTermsMutation();
  const [logoutMutation] = useLogoutMutation();

  const [agreed, setAgreed] = useState({ terms: false, privacy: false });
  const [activeDoc, setActiveDoc] = useState<LegalDoc | null>(null);

  // Narrow explicitly: `userInfo?.needsReConsent` alone would not narrow
  // userInfo to AuthUser for the spread below.
  if (!userInfo || !userInfo.needsReConsent) return null;

  const handleAgree = (doc: LegalDoc) => {
    const next = { ...agreed, [doc]: true };
    setAgreed(next);
    // Whichever document was agreed second closes the modal and enables the
    // accept button; the first one hands over to the remaining document.
    if (doc === "terms" && !next.privacy) {
      setActiveDoc("privacy");
      return;
    }
    if (doc === "privacy" && !next.terms) {
      setActiveDoc("terms");
      return;
    }
    setActiveDoc(null);
  };

  const handleAccept = async () => {
    try {
      const result = await acceptTerms().unwrap();
      dispatch(
        setCredentials({
          ...userInfo,
          needsReConsent: false,
          termsVersion: result.termsVersion,
        }),
      );
      toast.success("Thanks — your acceptance has been recorded.");
    } catch (err) {
      const data = (err as { data?: { message?: string } }).data;
      toast.error(data?.message || "Could not save your acceptance. Please try again.");
    }
  };

  const handleLogout = async () => {
    try {
      await logoutMutation().unwrap();
    } catch {
      // The local logout below is what matters here; a failed server call
      // (already-dead cookie) must not trap the user behind the gate.
    }
    dispatch(logout());
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reconsent-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 id="reconsent-title" className="text-lg font-semibold text-gray-900">
          We&apos;ve updated our terms
        </h2>
        <p className="mt-3 text-sm text-gray-600">
          Our Terms of Service and Privacy Policy have been revised. Please
          review both documents and accept them to continue using your
          account.
        </p>
        <div className="mt-4 flex gap-4">
          <button
            type="button"
            onClick={() => setActiveDoc("terms")}
            className="text-sm font-medium text-amber-600 hover:underline"
          >
            Review Terms of Service
          </button>
          <button
            type="button"
            onClick={() => setActiveDoc("privacy")}
            className="text-sm font-medium text-amber-600 hover:underline"
          >
            Review Privacy Policy
          </button>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Log out
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={!agreed.terms || !agreed.privacy || isAccepting}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAccepting ? "Saving…" : "Accept and continue"}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Both documents must be reviewed before you can accept.
        </p>
      </div>

      {/* z-[100] inside — renders above this z-[90] overlay. */}
      <LegalConsentModal
        activeDoc={activeDoc}
        onClose={() => setActiveDoc(null)}
        onAgree={handleAgree}
      />
    </div>
  );
};

export default TermsReconsentGate;

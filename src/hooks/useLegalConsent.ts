// hooks/useLegalConsent.ts
// Shared "read & accept the legal policies" state machine used by both the
// Register (email + Google) and Login (Google) flows. Acceptance is remembered
// for the browser session, and `requestConsentToken()` obtains the short-lived
// signed token required by the backend before it will start Google OAuth.
import { useState } from "react";
import { csrfJsonHeaders } from "../utils/csrf";

export type LegalDoc = "terms" | "privacy";

const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  "";

const STORAGE_KEYS: Record<LegalDoc, string> = {
  terms: "bk_agreed_terms",
  privacy: "bk_agreed_privacy",
};

export function useLegalConsent() {
  const [activeDoc, setActiveDoc] = useState<LegalDoc | null>(null);
  const [acceptedDocs, setAcceptedDocs] = useState(() => ({
    terms: sessionStorage.getItem(STORAGE_KEYS.terms) === "1",
    privacy: sessionStorage.getItem(STORAGE_KEYS.privacy) === "1",
  }));

  const bothAccepted = acceptedDocs.terms && acceptedDocs.privacy;

  const openDoc = (doc: LegalDoc) => {
    if (!acceptedDocs[doc]) setActiveDoc(doc);
  };

  const handleDocAgree = (doc: LegalDoc) => {
    sessionStorage.setItem(STORAGE_KEYS[doc], "1");
    setAcceptedDocs((prev) => ({ ...prev, [doc]: true }));
    setActiveDoc(null);
  };

  // Ask the backend to certify this acceptance; the returned token is appended
  // to the Google signup start URL (/api/auth/google/signup?consent=<token>).
  const requestConsentToken = async (): Promise<string> => {
    // Cookies are included, so the csrf_token cookie travels too — the header
    // must echo it or the backend answers 403 for any visitor who already has
    // one (csrfJsonHeaders handles that; raw fetch bypasses the interceptor).
    const res = await fetch(`${API_BASE_URL}/api/auth/consent`, {
      method: "POST",
      credentials: "include",
      headers: await csrfJsonHeaders(),
      body: JSON.stringify({ accepted: true }),
    });
    if (!res.ok) {
      throw new Error("We could not record your acceptance. Please try again.");
    }
    const data = (await res.json()) as { consentToken?: string };
    if (!data.consentToken) {
      throw new Error("We could not record your acceptance. Please try again.");
    }
    return data.consentToken;
  };

  return {
    activeDoc,
    setActiveDoc,
    acceptedDocs,
    bothAccepted,
    openDoc,
    handleDocAgree,
    requestConsentToken,
  };
}
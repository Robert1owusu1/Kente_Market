// FILE LOCATION: src/Pages/Legal/PrivacyPolicy.jsx
// DESCRIPTION: Standalone Privacy Policy page rendered with the shared
//              LegalDocument (scroll-to-accept) component.

import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import LegalDocument from "../../components/legal/LegalDocument";
import { privacyPolicy } from "../../components/legal/legalContent";

// Sanitize the "from" query param — only in-app absolute paths are allowed, so
// an attacker cannot turn /privacy?from=https://evil.com into an open redirect.
const internalPath = (value: string | null): string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/register";

const PrivacyPolicy = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawFrom = searchParams.get("from");
  const from = internalPath(rawFrom);

  const handleAgree = () => {
    sessionStorage.setItem("bk_legal_agreed", "1");
    navigate(from, { replace: true });
  };

  return (
    <LegalDocument
      {...privacyPolicy}
      backTo={from}
      backLabel={rawFrom ? "Back to registration" : "Back"}
      onAgree={handleAgree}
      agreeButtonLabel="I Agree & Create My Account"
    />
  );
};

export default PrivacyPolicy;

// FILE LOCATION: src/Pages/Legal/TermsOfService.jsx
// DESCRIPTION: Standalone Terms of Service page rendered with the shared
//              LegalDocument (scroll-to-accept) component.

import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import LegalDocument from "../../components/legal/LegalDocument";
import { termsOfService } from "../../components/legal/legalContent";

// Sanitize the "from" query param — only in-app absolute paths are allowed, so
// an attacker cannot turn /terms?from=https://evil.com into an open redirect.
const internalPath = (value: string | null): string =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/register";

const TermsOfService = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawFrom = searchParams.get("from");
  const from = internalPath(rawFrom);

  const handleAgree = () => {
    // Record acceptance so the Register form can auto-check the agreement box.
    sessionStorage.setItem("bk_legal_agreed", "1");
    // Return the user to wherever they came from (usually /register).
    navigate(from, { replace: true });
  };

  return (
    <LegalDocument
      {...termsOfService}
      backTo={from}
      backLabel={rawFrom ? "Back to registration" : "Back"}
      onAgree={handleAgree}
      agreeButtonLabel="I Agree & Create My Account"
    />
  );
};

export default TermsOfService;

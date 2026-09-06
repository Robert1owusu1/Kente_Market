// FILE LOCATION: src/Pages/Legal/TermsOfService.jsx
// DESCRIPTION: Standalone Terms of Service page rendered with the shared
//              LegalDocument (scroll-to-accept) component.

import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import LegalDocument from "../../components/legal/LegalDocument.jsx";
import { termsOfService } from "../../components/legal/legalContent.js";

const TermsOfService = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from");

  const handleAgree = () => {
    // Record acceptance so the Register form can auto-check the agreement box.
    sessionStorage.setItem("bk_legal_agreed", "1");
    // Return the user to wherever they came from (usually /register).
    navigate(from || "/register", { replace: true });
  };

  return (
    <LegalDocument
      {...termsOfService}
      backTo={from || "/register"}
      backLabel={from ? "Back to registration" : "Back"}
      onAgree={handleAgree}
      agreeButtonLabel="I Agree & Create My Account"
    />
  );
};

export default TermsOfService;

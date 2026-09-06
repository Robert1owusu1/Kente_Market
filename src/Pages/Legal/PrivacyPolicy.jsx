// FILE LOCATION: src/Pages/Legal/PrivacyPolicy.jsx
// DESCRIPTION: Standalone Privacy Policy page rendered with the shared
//              LegalDocument (scroll-to-accept) component.

import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import LegalDocument from "../../components/legal/LegalDocument.jsx";
import { privacyPolicy } from "../../components/legal/legalContent.js";

const PrivacyPolicy = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from");

  const handleAgree = () => {
    sessionStorage.setItem("bk_legal_agreed", "1");
    navigate(from || "/register", { replace: true });
  };

  return (
    <LegalDocument
      {...privacyPolicy}
      backTo={from || "/register"}
      backLabel={from ? "Back to registration" : "Back"}
      onAgree={handleAgree}
      agreeButtonLabel="I Agree & Create My Account"
    />
  );
};

export default PrivacyPolicy;

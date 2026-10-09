// FILE LOCATION: backend/config/legalTerms.js
// DESCRIPTION: Terms/consent VERSIONING — the single source of truth for
//              which Terms of Service / Privacy Policy revision this
//              deployment considers current.
//
// Why a version and not just `legal_consent_at`: a timestamp cannot tell
// WHICH terms were accepted. When the legal documents next change, every
// session must be able to prove it accepted the NEW revision — the answer
// to `needsReConsent` is `terms_version < TERMS_VERSION`, and
// POST /api/users/accept-terms is what moves a user forward.
//
// How to bump (the whole point of this file):
//   1. publish the revised Terms/Privacy;
//   2. change TERMS_VERSION to 2 here;
//   3. deploy. Nothing else — every login and profile response now flags
//      every existing session, the frontend gate blocks until
//      /accept-terms records the new version, and new registrations
//      already record it at creation (usersModel.create, OAuth signup).
//
// Never bump without publishing: the version is a claim about the
// documents, and forcing re-consent to the same text is how a consent
// record becomes meaningless.
export const TERMS_VERSION = 1;

// components/Referral/ReferralCapture.tsx
// Captures `?ref=CODE` from any landing URL once and hands it to the server,
// which keeps it in an httpOnly cookie for 30 days (first link wins) and binds
// it only when a NEW account is created. Nothing referral-related is stored in
// browser-readable storage, and no referrer id is ever sent by the client.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useCaptureReferralVisitMutation } from '../../slices/referralsApiSlice';

const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

const ReferralCapture = () => {
  const { search } = useLocation();
  const [capture] = useCaptureReferralVisitMutation();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(search).get('ref')?.trim().toUpperCase() || '';
    if (!CODE_RE.test(code) || sent.current === code) return;
    sent.current = code;
    capture(code).catch(() => { /* best-effort: a lost capture only loses attribution */ });
  }, [search, capture]);

  return null;
};

export default ReferralCapture;

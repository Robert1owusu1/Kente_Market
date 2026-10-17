// FILE LOCATION: backend/Services/tryOn/errors.js
// DESCRIPTION: Normalised try-on error codes. Adapters translate provider
//              failures INTO these; routes translate these into HTTP. Neither
//              side ever forwards provider text: upstream `detail` strings can
//              carry account and configuration details.

/** code -> { http, message (customer-facing), retryable } */
export const TRYON_ERRORS = Object.freeze({
  not_enabled: { http: 503, message: 'AI try-on is not available right now.', retryable: false },
  provider_not_configured: { http: 503, message: 'AI try-on is not available right now.', retryable: false },
  provider_auth: { http: 503, message: 'AI try-on is not available right now.', retryable: false },
  provider_unavailable: { http: 503, message: 'The AI stylist is unavailable right now. Please try again later.', retryable: true },
  provider_rate_limited: { http: 429, message: 'The AI stylist is busy right now. Please try again in a minute.', retryable: true },
  provider_quota: { http: 429, message: 'The AI stylist is out of capacity right now. Please try again later.', retryable: true },
  provider_rejected_input: { http: 422, message: 'The AI stylist could not use this photo. Please try a different, clear, front-facing photo.', retryable: true },
  // The request may or may not have reached the provider (timeout / reset):
  // it may have started a paid run we cannot track. Never auto-retried.
  submit_outcome_unknown: { http: 502, message: 'We lost contact with the AI stylist. Please try again in a few minutes.', retryable: true },
  generation_failed: { http: 502, message: 'The AI could not create a try-on from this photo. Please try a different photo.', retryable: true },
  canceled: { http: 502, message: 'This try-on was cancelled. Please try again.', retryable: true },
  job_timeout: { http: 504, message: 'This try-on took too long and was stopped. Please try again.', retryable: true },
  interrupted: { http: 502, message: 'This try-on was interrupted. Please try again.', retryable: true },
  result_unavailable: { http: 502, message: 'The try-on finished but its image could not be saved. Please try again.', retryable: true },
  result_expired: { http: 410, message: 'This try-on image has expired. Please create a new one.', retryable: true },
});

export class TryOnServiceError extends Error {
  /**
   * @param {keyof typeof TRYON_ERRORS | string} code
   * @param {{ http?: number, message?: string, retryAfterSeconds?: number }} [opts]
   */
  constructor(code, opts = {}) {
    const known = TRYON_ERRORS[code];
    super(opts.message || known?.message || 'AI try-on failed. Please try again.');
    this.name = 'TryOnServiceError';
    this.code = code;
    this.httpStatus = opts.http || known?.http || 500;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

/** Public, safe view of a stored error code. */
export const publicError = (code) => {
  if (!code) return null;
  const known = TRYON_ERRORS[code];
  return {
    code: known ? code : 'generation_failed',
    message: (known || TRYON_ERRORS.generation_failed).message,
    retryable: (known || TRYON_ERRORS.generation_failed).retryable,
  };
};

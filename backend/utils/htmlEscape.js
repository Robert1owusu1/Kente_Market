// FILE LOCATION: utils/htmlEscape.js
// DESCRIPTION: The one HTML escaper, shared by every outbound email renderer.
//
// It used to live inside orderEmailService.js, which is why four other
// renderers interpolated the same kind of input with none: an escaper that
// exists in one file is a convention, not a control, and the failure mode is
// silent — a field escaped in four templates and forgotten in the fifth, with
// nothing to notice until someone reads the markup.
//
// It cannot be imported from orderEmailService either: that file already
// imports sendEmailSafely from emailService.js, so reaching back the other way
// would close a cycle. This module sits below both.
//
// Applied to every interpolated value, including ones that are already safe
// (dates, counters, env vars). Escaping is idempotent, and a rule with no
// judgement calls in it is a rule that still holds when someone adds a field
// six months from now.
export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

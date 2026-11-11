'use strict';
/**
 * Browser- and Node-safe text sanitizer. No dependencies.
 *
 * Defence in depth:
 *  1. Structure: only allow-listed fields are ever stored (see normalize.js); arbitrary objects are dropped.
 *  2. Keys: values under sensitive-looking keys are replaced wholesale (isSensitiveKey).
 *  3. Values: well-known secret / PII shapes inside free text are masked (PATTERNS).
 * This is best-effort pattern matching and cannot prove the absence of secrets (see design doc, risk R2).
 */

const REDACTED = '[REDACTED]';

const SENSITIVE_SUBSTRINGS = [
  'password', 'passwd', 'passphrase', 'secret', 'token', 'authorization', 'cookie', 'apikey',
  'accesskey', 'privatekey', 'credential', 'signature', 'sessionid', 'bearer', 'cardnumber',
  'creditcard', 'cvv', 'cvc', 'ssn', 'iban', 'accountnumber', 'jwt'
];
const SENSITIVE_EXACT = new Set(['pin', 'otp', 'pan', 'sig', 'key', 'auth', 'pwd', 'sid']);

function isSensitiveKey(key) {
  const n = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_EXACT.has(n) || SENSITIVE_SUBSTRINGS.some((s) => n.includes(s));
}

function luhnValid(digits) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const mask = () => REDACTED;

// Ordered: specific shapes first, generic last. Every replacer is a function so we can count real changes.
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, mask],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, mask],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, (m, scheme) => `${scheme} ${REDACTED}`],
  [/(\/\/)[^\s/@:]+:[^\s/@]+@/g, (m, slashes) => `${slashes}${REDACTED}@`],
  [/([?&](?:access_token|refresh_token|id_token|token|api_?key|key|secret|client_secret|password|signature|sig|code)=)[^&\s#"']+/gi,
    (m, prefix) => `${prefix}${REDACTED}`],
  [/\b((?:password|passwd|pwd|secret|client_secret|access_token|refresh_token|token|api[_-]?key|authorization|auth)["']?\s*[:=]\s*["']?)([^\s"',;&]+)/gi,
    (m, prefix, value) => (value.startsWith(REDACTED) ? m : `${prefix}${REDACTED}`)],
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/g, mask],
  [/\b[sp]k_(?:live|test)_[A-Za-z0-9]{8,}\b/g, mask],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, mask],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, mask],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => '[REDACTED_EMAIL]'],
  [/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? '[REDACTED_PAN]' : m;
  }],
  // Generic long opaque token (>= 40 url-safe chars). UUIDs (36 chars) and short ids are not matched.
  [/\b[A-Za-z0-9_-]{40,}\b/g, () => '[REDACTED_TOKEN]']
];

/**
 * Sanitize free text. `ctx.count` (optional) accumulates the number of redactions performed.
 * @param {*} input
 * @param {{max?: number, ctx?: {count: number}}} [opts]
 * @returns {string}
 */
function sanitizeText(input, { max = 1000, ctx = { count: 0 } } = {}) {
  if (input === undefined || input === null) return '';
  // eslint-disable-next-line no-control-regex
  let text = String(input).replace(/[\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F\u007F]/g, '');
  for (const [re, fn] of PATTERNS) {
    text = text.replace(re, (...args) => {
      const out = fn(...args);
      if (out !== args[0]) ctx.count += 1;
      return out;
    });
  }
  if (text.length > max) text = `${text.slice(0, max)}…[truncated]`;
  return text;
}

module.exports = { sanitizeText, isSensitiveKey, REDACTED };

import { ALPHABET } from './base62.js';
import { badRequest } from './errors.js';

const MAX_URL_LENGTH = 2048;
const CODE_RE = new RegExp(`^[${ALPHABET}_-]{3,32}$`);

// Codes that would shadow API routes if handed out as aliases.
const RESERVED = new Set(['api', 'health', 'healthz', 'favicon.ico', 'robots.txt', 'static', 'admin']);

/**
 * Accept only absolute http(s) URLs with a real host. Rejecting other schemes
 * matters: a shortener that redirects to javascript: or data: is an open XSS
 * vector for anyone who trusts the short domain.
 */
export function normalizeUrl(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw badRequest('"url" is required and must be a string');
  }
  const raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) {
    throw badRequest(`"url" must be at most ${MAX_URL_LENGTH} characters`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest('"url" is not a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw badRequest('"url" must use the http or https scheme');
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    throw badRequest('"url" must contain a fully qualified host name');
  }
  return parsed.toString();
}

export function validateCustomCode(code) {
  if (typeof code !== 'string') throw badRequest('"customCode" must be a string');
  const trimmed = code.trim();
  if (!CODE_RE.test(trimmed)) {
    throw badRequest('"customCode" must be 3-32 characters of [A-Za-z0-9_-]');
  }
  if (RESERVED.has(trimmed.toLowerCase())) {
    throw badRequest(`"${trimmed}" is a reserved code`);
  }
  return trimmed;
}

export function parseExpiresAt(value) {
  if (value === undefined || value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest('"expiresAt" must be an ISO-8601 timestamp');
  if (date.getTime() <= Date.now()) throw badRequest('"expiresAt" must be in the future');
  return date;
}

export function isValidCodeShape(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

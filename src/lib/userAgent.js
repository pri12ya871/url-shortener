/**
 * Deliberately tiny UA classifier. Real UA parsing needs a maintained database
 * (ua-parser-js et al.); this covers the buckets the analytics endpoint reports
 * without adding a dependency that goes stale.
 */
export function classifyUserAgent(ua = '') {
  const s = String(ua);

  let device = 'desktop';
  if (/\bbot\b|crawler|spider|slurp|curl\/|wget\/|HeadlessChrome/i.test(s)) device = 'bot';
  else if (/iPad|Tablet|PlayBook|Silk/i.test(s)) device = 'tablet';
  else if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(s)) device = 'mobile';

  let browser = 'other';
  if (/Edg\//i.test(s)) browser = 'edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'opera';
  else if (/Chrome\//i.test(s)) browser = 'chrome';
  else if (/Firefox\//i.test(s)) browser = 'firefox';
  else if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) browser = 'safari';
  else if (/curl\/|wget\//i.test(s)) browser = 'cli';

  return { device, browser };
}

/** Store only the origin of a referrer — the full path is often sensitive. */
export function normalizeReferrer(referrer) {
  if (!referrer) return null;
  try {
    return new URL(referrer).origin;
  } catch {
    return null;
  }
}

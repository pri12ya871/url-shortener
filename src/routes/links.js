import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { normalizeUrl, parseExpiresAt, validateCustomCode } from '../lib/validate.js';
import { createLink, deactivateLink, getLink, listLinks } from '../services/linkService.js';
import { linkAnalytics, totalClicks } from '../services/analyticsService.js';
import { badRequest } from '../lib/errors.js';

export const linksRouter = Router();

// Writes are the expensive, abusable side of a shortener — throttle those, not
// the redirect path, which is cheap and cached.
linksRouter.post(
  '/links',
  rateLimit({ bucket: 'create' }),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const url = normalizeUrl(body.url);
    const customCode = body.customCode === undefined || body.customCode === null
      ? null
      : validateCustomCode(body.customCode);
    const expiresAt = parseExpiresAt(body.expiresAt);

    const link = await createLink({ url, customCode, expiresAt });
    res.status(201).json(link);
  }),
);

linksRouter.get(
  '/links',
  asyncHandler(async (req, res) => {
    const limit = clampInt(req.query.limit, 20, 1, 100);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000);
    res.json({ links: await listLinks({ limit, offset }), limit, offset });
  }),
);

linksRouter.get(
  '/links/:code',
  asyncHandler(async (req, res) => {
    const link = await getLink(req.params.code);
    res.json({ ...link, clicks: await totalClicks(link) });
  }),
);

linksRouter.get(
  '/links/:code/analytics',
  asyncHandler(async (req, res) => {
    const link = await getLink(req.params.code);
    const days = clampInt(req.query.days, 30, 1, 365);
    res.json(await linkAnalytics(link, { days }));
  }),
);

linksRouter.delete(
  '/links/:code',
  rateLimit({ bucket: 'delete' }),
  asyncHandler(async (req, res) => {
    await deactivateLink(req.params.code);
    res.status(204).end();
  }),
);

function clampInt(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw badRequest(`"${value}" is not an integer`);
  return Math.min(max, Math.max(min, n));
}

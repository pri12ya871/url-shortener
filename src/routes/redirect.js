import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { resolveCode } from '../services/linkService.js';
import { recordClick } from '../services/analyticsService.js';
import { isValidCodeShape } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

export const redirectRouter = Router();

redirectRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const { code } = req.params;
    // Reject malformed codes before touching Redis or Postgres.
    if (!isValidCodeShape(code)) throw notFound('Unknown short link');

    const link = await resolveCode(code);
    if (!link) throw notFound('Unknown short link');

    // 302, not 301: a permanent redirect gets cached by the browser and every
    // subsequent click never reaches us, which silently kills the analytics.
    res.set('Cache-Control', 'private, max-age=0, no-store');
    res.redirect(302, link.targetUrl);

    recordClick(link, req);
  }),
);

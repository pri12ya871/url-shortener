import { HttpError } from '../lib/errors.js';

/** Wrap an async handler so rejected promises reach Express's error pipeline. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Request body is not valid JSON' } });
  }

  console.error('[error]', err);
  return res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
}

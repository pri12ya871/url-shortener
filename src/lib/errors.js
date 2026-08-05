export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, 'bad_request', msg, details);
export const notFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);
export const conflict = (msg) => new HttpError(409, 'conflict', msg);
export const tooManyRequests = (msg, details) => new HttpError(429, 'rate_limited', msg, details);
export const serverError = (msg) => new HttpError(500, 'internal_error', msg);

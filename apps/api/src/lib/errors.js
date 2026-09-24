// Every failed request returns { error: { code, message, details? } } (NFR-007).
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Your role is not allowed to perform this action.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found.`);
export const conflict = (message, details) => new HttpError(409, 'conflict', message, details);

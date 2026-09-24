import { badRequest } from '../lib/errors.js';

/** Validates req[source] against a zod schema and replaces it with the parsed value (NFR-004). */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      const first = details[0];
      throw badRequest(first.field ? `${first.field}: ${first.message}` : first.message, details);
    }
    // Express 5 makes req.query a getter, so parsed values live on req.valid.
    req.valid = { ...req.valid, [source]: result.data };
    next();
  };
}

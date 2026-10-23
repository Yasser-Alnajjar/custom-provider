/** An error that maps to a JSON error response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const validationError = (message: string) => new HttpError(400, "validation_error", message);
export const notFound = (message = "Ticket not found") => new HttpError(404, "not_found", message);

export const conflict = (message: string) => new HttpError(409, "conflict", message);

export class StorageError extends Error {}

/** Another instance saved the database after this request loaded it. */
export class ConflictError extends StorageError {}

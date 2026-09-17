export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503 = 400,
  ) {
    super(message);
  }
}

/** Typed errors so handlers throw meaning, and index.ts maps it to HTTP once. */

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public errors: Record<string, string[]> | string | null = null,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (m: string, e?: Record<string, string[]>) => new AppError(m, 400, e ?? null)
export const unauthorized = (m = 'Authentication required') => new AppError(m, 401)
/** Never confirm another tenant's data exists. Cross-tenant reads are 404, not 403. */
export const notFound = (m = 'Not found') => new AppError(m, 404)
export const forbidden = (m = 'You do not have permission to do this') => new AppError(m, 403)
export const conflict = (m: string) => new AppError(m, 409)
export const unprocessable = (m: string) => new AppError(m, 422)
export const tooMany = (m = 'Too many requests') => new AppError(m, 429)

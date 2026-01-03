/**
 * Typed Errors for Honertia Effect
 *
 * Using Effect's Data.TaggedError for type-safe error handling.
 */

import { Data } from 'effect'

/**
 * Validation Error - Field-level validation failures
 */
export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly errors: Record<string, string>
  readonly component?: string
}> {}

/**
 * Unauthorized Error - Authentication/authorization failures
 */
export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
  readonly message: string
  readonly redirectTo?: string
}> {}

/**
 * Not Found Error - Resource not found
 */
export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly resource: string
  readonly id?: string | number
}> {}

/**
 * Forbidden Error - Authenticated but not authorized
 */
export class ForbiddenError extends Data.TaggedError('ForbiddenError')<{
  readonly message: string
}> {}

/**
 * HTTP Error - Generic HTTP error
 */
export class HttpError extends Data.TaggedError('HttpError')<{
  readonly status: number
  readonly message: string
  readonly body?: unknown
}> {}

/**
 * Redirect - Not an error, but uses same control flow
 * This is a tagged class (not error) for redirects
 */
export class Redirect extends Data.TaggedClass('Redirect')<{
  readonly url: string
  readonly status: 302 | 303
}> {}

/**
 * Union of all application errors
 */
export type AppError =
  | ValidationError
  | UnauthorizedError
  | NotFoundError
  | ForbiddenError
  | HttpError

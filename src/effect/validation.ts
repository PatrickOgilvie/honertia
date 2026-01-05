/**
 * Effect Validation Helpers
 *
 * Utilities for validating request data using Effect Schema.
 */

import { Effect, Schema as S, ParseResult } from 'effect'
import { RequestService } from './services.js'
import { ValidationError } from './errors.js'

/**
 * Extract validation data from the request.
 * Merges route params, query params, and body (body takes precedence).
 */
export const getValidationData: Effect.Effect<
  Record<string, unknown>,
  ValidationError,
  RequestService
> = Effect.gen(function* () {
  const request = yield* RequestService

  const routeParams = request.params()
  const queryParams = request.query()

  // Only parse body for methods that typically have one
  if (['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    return { ...routeParams, ...queryParams }
  }

  const contentType = request.header('Content-Type') ?? ''
  const isJson = contentType.includes('application/json')

  const body = yield* Effect.tryPromise(() =>
    isJson ? request.json<Record<string, unknown>>() : request.parseBody()
  ).pipe(
    Effect.mapError(() =>
      new ValidationError({
        errors: { form: isJson ? 'Invalid JSON body' : 'Could not parse request body' },
      })
    )
  )

  return { ...routeParams, ...queryParams, ...body }
})

/**
 * Format Effect Schema parse errors into field-level validation errors.
 */
export function formatSchemaErrors(
  error: ParseResult.ParseError,
  messages: Record<string, string> = {},
  attributes: Record<string, string> = {}
): Record<string, string> {
  const errors: Record<string, string> = {}
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error)

  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join('.') : 'form'

    if (errors[field]) continue // First error wins

    const attribute = attributes[field] ?? field
    const message = messages[field] ?? issue.message

    errors[field] = message.replace(/:attribute/g, attribute)
  }

  return errors
}

/**
 * Options for validation functions.
 */
export interface ValidateOptions {
  /**
   * Custom error messages keyed by field name.
   * Overrides the default messages from Effect Schema.
   *
   * @example
   * { email: 'Please enter a valid email address' }
   */
  messages?: Record<string, string>

  /**
   * Human-readable names for fields, used with the `:attribute` placeholder.
   * If a message contains `:attribute`, it will be replaced with the value here.
   *
   * @example
   * // With attributes: { email: 'email address' }
   * // And message: 'The :attribute field is required'
   * // Produces: 'The email address field is required'
   */
  attributes?: Record<string, string>

  /**
   * The Inertia component to re-render when validation fails.
   * If set, a ValidationError will trigger a re-render of this component
   * with the errors passed as props. If not set, redirects back.
   *
   * @example
   * 'Projects/Create'
   */
  errorComponent?: string
}

/**
 * Validate data against a schema.
 * Returns validated data or fails with ValidationError.
 */
export function validate<A, I>(
  schema: S.Schema<A, I>,
  data: unknown,
  options: ValidateOptions = {}
): Effect.Effect<A, ValidationError, never> {
  return S.decodeUnknown(schema)(data).pipe(
    Effect.mapError((error) =>
      new ValidationError({
        errors: formatSchemaErrors(error, options.messages, options.attributes),
        component: options.errorComponent,
      })
    )
  )
}

/**
 * Validate request data against a schema.
 * Extracts data from request and validates in one step.
 */
export function validateRequest<A, I>(
  schema: S.Schema<A, I>,
  options: ValidateOptions = {}
): Effect.Effect<A, ValidationError, RequestService> {
  return Effect.gen(function* () {
    const data = yield* getValidationData
    return yield* validate(schema, data, options)
  })
}
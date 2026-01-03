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
 * Merges route params, query params, and body.
 */
export const getValidationData = Effect.gen(function* () {
  const request = yield* RequestService

  const routeParams = request.params()
  const queryParams = request.query()

  let body: Record<string, unknown> = {}
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
    const contentType = request.header('Content-Type') || ''
    const bodyResult = yield* Effect.tryPromise({
      try: () => contentType.includes('application/json')
        ? request.json<Record<string, unknown>>()
        : request.parseBody(),
      catch: () => ({} as Record<string, unknown>),
    }).pipe(Effect.catchAll(() => Effect.succeed({} as Record<string, unknown>)))
    body = bodyResult
  }

  return {
    ...routeParams,
    ...queryParams,
    ...body,
  }
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

  // Use ArrayFormatter to get structured errors
  const formattedErrors = ParseResult.ArrayFormatter.formatErrorSync(error)
  
  for (const issue of formattedErrors) {
    const pathStr = issue.path.length > 0 
      ? issue.path.map(p => typeof p === 'object' && p !== null && 'key' in p ? (p as { key: unknown }).key : String(p)).join('.') 
      : 'form'
    
    if (errors[pathStr]) continue // First error wins

    const attribute = attributes[pathStr] ?? pathStr
    const messageKey = messages[pathStr]

    const message = messageKey ?? issue.message
    errors[pathStr] = message.replace(/:attribute/g, attribute)
  }

  return errors
}

/**
 * Validate data against a schema.
 * Returns validated data or fails with ValidationError.
 */
export const validate = <A, I>(
  schema: S.Schema<A, I>,
  options?: {
    messages?: Record<string, string>
    attributes?: Record<string, string>
    errorComponent?: string
  }
) =>
  (data: unknown): Effect.Effect<A, ValidationError, never> =>
    S.decodeUnknown(schema)(data).pipe(
      Effect.mapError((error) =>
        new ValidationError({
          errors: formatSchemaErrors(
            error,
            options?.messages ?? {},
            options?.attributes ?? {}
          ),
          component: options?.errorComponent,
        })
      )
    )

/**
 * Validate request data against a schema.
 * Extracts data from request and validates in one step.
 */
export const validateRequest = <A, I>(
  schema: S.Schema<A, I>,
  options?: {
    messages?: Record<string, string>
    attributes?: Record<string, string>
    errorComponent?: string
  }
): Effect.Effect<A, ValidationError, RequestService> =>
  Effect.gen(function* () {
    const data = yield* getValidationData
    return yield* validate(schema, options)(data)
  })

/**
 * Effect Validation Helpers
 *
 * Utilities for validating request data using Effect Schema.
 */

import { Effect, Schema as S, ParseResult } from 'effect'
import { RequestService } from './services.js'
import { ValidationError } from './errors.js'
import type { FieldError } from './error-types.js'
import { ErrorCodes } from './error-catalog.js'

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
        code: ErrorCodes.VAL_003_BODY_PARSE_FAILED,
      })
    )
  )

  return { ...routeParams, ...queryParams, ...body }
})

/**
 * Result of formatting schema errors with details.
 */
export interface FormattedSchemaErrors {
  /** Simple field -> message mapping */
  errors: Record<string, string>
  /** Detailed field errors for structured output */
  details: Record<string, FieldError>
}

/**
 * Format Effect Schema parse errors into field-level validation errors.
 * Returns both simple errors and detailed field information.
 */
export function formatSchemaErrorsWithDetails(
  error: ParseResult.ParseError,
  data: unknown,
  messages: Record<string, string> = {},
  attributes: Record<string, string> = {}
): FormattedSchemaErrors {
  const errors: Record<string, string> = {}
  const details: Record<string, FieldError> = {}
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error)

  // Get the input data for extracting actual values
  const inputData = (typeof data === 'object' && data !== null) ? data as Record<string, unknown> : {}

  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.map(String).join('.') : 'form'

    if (errors[field]) continue // First error wins

    const attribute = attributes[field] ?? field
    const message = messages[field] ?? issue.message

    errors[field] = message.replace(/:attribute/g, attribute)

    // Extract the actual value from the input data
    let value: unknown = inputData
    for (const segment of issue.path) {
      if (typeof value === 'object' && value !== null) {
        value = (value as Record<string | number, unknown>)[segment as string | number]
      } else {
        value = undefined
        break
      }
    }

    // Create detailed field error
    details[field] = {
      value,
      expected: issue.message,
      message: errors[field],
      path: issue.path.map(String),
      schemaType: extractSchemaType(issue),
    }
  }

  return { errors, details }
}

/**
 * Extract the schema type from an issue for debugging.
 */
function extractSchemaType(issue: ParseResult.ArrayFormatterIssue): string | undefined {
  // Try to extract type information from the issue
  const message = issue.message

  // Common patterns in Effect Schema messages
  if (message.includes('Expected')) {
    const match = message.match(/Expected\s+([^,]+)/)
    if (match) return match[1].trim()
  }

  return undefined
}

/**
 * Format Effect Schema parse errors into field-level validation errors.
 * Simple version that returns only the error messages.
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
 * Nominal brand marker for validated data.
 * Private field prevents the brand from surviving object spreads.
 */
declare class ValidatedBrand {
  private readonly __validatedBrand: void
}

export type Validated<A> = A & ValidatedBrand

/**
 * Mark data as validated (type-level only).
 */
export const asValidated = <A>(input: A): Validated<A> =>
  input as Validated<A>

/**
 * Nominal brand marker for trusted (server-derived) data.
 * Private field prevents the brand from surviving object spreads.
 */
declare class TrustedBrand {
  private readonly __trustedBrand: void
}

export type Trusted<A> = A & TrustedBrand

/**
 * Mark data as trusted (type-level only).
 */
export const asTrusted = <A>(input: A): Trusted<A> =>
  input as Trusted<A>

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
): Effect.Effect<Validated<A>, ValidationError, never> {
  return S.decodeUnknown(schema)(data).pipe(
    Effect.mapError((error) => {
      const { errors, details } = formatSchemaErrorsWithDetails(
        error,
        data,
        options.messages,
        options.attributes
      )

      // Determine the most appropriate error code
      const hasRequiredErrors = Object.values(details).some(
        d => d.expected?.toLowerCase().includes('required') ||
             d.message?.toLowerCase().includes('required')
      )

      return new ValidationError({
        errors,
        fieldDetails: details,
        component: options.errorComponent,
        code: hasRequiredErrors
          ? ErrorCodes.VAL_001_FIELD_REQUIRED
          : ErrorCodes.VAL_004_SCHEMA_MISMATCH,
      })
    }),
    Effect.map(asValidated)
  )
}

/**
 * Validate request data against a schema.
 * Extracts data from request and validates in one step.
 */
export function validateRequest<A, I>(
  schema: S.Schema<A, I>,
  options: ValidateOptions = {}
): Effect.Effect<Validated<A>, ValidationError, RequestService> {
  return Effect.gen(function* () {
    const data = yield* getValidationData
    return yield* validate(schema, data, options)
  })
}

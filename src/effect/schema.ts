/**
 * Honertia Effect Schema Validators
 *
 * Laravel-inspired Effect Schema helpers for common validation patterns.
 */

import { Schema as S } from 'effect'

// =============================================================================
// String Types
// =============================================================================

/**
 * Trims whitespace from a string.
 */
export const trimmed = S.transform(
  S.String,
  S.String,
  {
    decode: (s) => s.trim(),
    encode: (s) => s,
  }
)

/**
 * A nullable string that converts empty/whitespace-only strings to null.
 * Useful for optional text fields where empty input should be stored as null.
 */
export const nullableString = S.transform(
  S.Unknown,
  S.NullOr(S.String),
  {
    decode: (value) => {
      if (value === undefined || value === null) return null
      if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed === '' ? null : trimmed
      }
      return String(value)
    },
    encode: (s) => s,
  }
)

/**
 * Alias for nullableString.
 */
export const optionalString = nullableString

/**
 * A required string that is trimmed. Empty strings fail validation.
 */
export const requiredString = S.String.pipe(
  S.transform(S.String, {
    decode: (s) => s.trim(),
    encode: (s) => s,
  }),
  S.minLength(1, { message: () => 'This field is required' })
)

/**
 * Create a required string with a custom message.
 */
export const required = (message = 'This field is required') =>
  S.String.pipe(
    S.transform(S.String, {
      decode: (s) => s.trim(),
      encode: (s) => s,
    }),
    S.minLength(1, { message: () => message })
  )

// =============================================================================
// Numeric Types
// =============================================================================

/**
 * Coerces a value to a number.
 */
export const coercedNumber = S.transform(
  S.Unknown,
  S.Number,
  {
    decode: (value) => {
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const parsed = parseFloat(value)
        if (!isNaN(parsed)) return parsed
      }
      throw new Error('Expected a number')
    },
    encode: (n) => n,
  }
)

/**
 * Coerces a value to a positive integer.
 */
export const positiveInt = coercedNumber.pipe(
  S.int({ message: () => 'Must be an integer' }),
  S.positive({ message: () => 'Must be positive' })
)

/**
 * Coerces a value to a non-negative integer (0 or greater).
 */
export const nonNegativeInt = coercedNumber.pipe(
  S.int({ message: () => 'Must be an integer' }),
  S.nonNegative({ message: () => 'Must be non-negative' })
)

/**
 * Parses a string to a positive integer, returning null on failure.
 */
export function parsePositiveInt(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed <= 0) return null
  return parsed
}

// =============================================================================
// Boolean Types
// =============================================================================

/**
 * Coerces various truthy/falsy values to boolean.
 */
export const coercedBoolean = S.transform(
  S.Unknown,
  S.Boolean,
  {
    decode: (value) => {
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value !== 0
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim()
        if (['true', '1', 'on', 'yes'].includes(lower)) return true
        if (['false', '0', 'off', 'no', ''].includes(lower)) return false
      }
      return Boolean(value)
    },
    encode: (b) => b,
  }
)

/**
 * A checkbox value that defaults to false if not present.
 */
export const checkbox = S.transform(
  S.Unknown,
  S.Boolean,
  {
    decode: (value) => {
      if (value === undefined || value === null || value === '') return false
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim()
        return ['true', '1', 'on', 'yes'].includes(lower)
      }
      return Boolean(value)
    },
    encode: (b) => b,
  }
)

// =============================================================================
// Date Types
// =============================================================================

/**
 * Coerces a string or number to a Date object.
 */
export const coercedDate = S.transform(
  S.Unknown,
  S.DateFromSelf,
  {
    decode: (value) => {
      if (value instanceof Date) return value
      if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value)
        if (!isNaN(date.getTime())) return date
      }
      throw new Error('Expected a valid date')
    },
    encode: (d) => d,
  }
)

/**
 * A nullable date that accepts empty strings as null.
 */
export const nullableDate = S.transform(
  S.Unknown,
  S.NullOr(S.DateFromSelf),
  {
    decode: (value) => {
      if (value === undefined || value === null || value === '') return null
      if (value instanceof Date) return value
      if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value)
        if (!isNaN(date.getTime())) return date
      }
      throw new Error('Expected a valid date')
    },
    encode: (d) => d,
  }
)

// =============================================================================
// Array Types
// =============================================================================

/**
 * Ensures a value is always an array.
 */
export const ensureArray = <A, I, R>(schema: S.Schema<A, I, R>) =>
  S.transform(
    S.Unknown,
    S.Array(schema),
    {
      decode: (value) => {
        if (value === undefined || value === null) return []
        if (Array.isArray(value)) return value
        return [value]
      },
      encode: (arr) => arr,
    }
  )

// =============================================================================
// Common Patterns
// =============================================================================

/**
 * An email address with trimming and lowercase normalization.
 */
export const email = S.String.pipe(
  S.transform(S.String, {
    decode: (s) => s.trim().toLowerCase(),
    encode: (s) => s,
  }),
  S.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: () => 'Invalid email address' })
)

/**
 * A nullable email address.
 */
export const nullableEmail = S.transform(
  S.Unknown,
  S.NullOr(S.String),
  {
    decode: (value) => {
      if (value === undefined || value === null) return null
      if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase()
        if (trimmed === '') return null
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          throw new Error('Invalid email address')
        }
        return trimmed
      }
      throw new Error('Expected a string')
    },
    encode: (s) => s,
  }
)

/**
 * A URL with trimming.
 */
export const url = S.String.pipe(
  S.transform(S.String, {
    decode: (s) => s.trim(),
    encode: (s) => s,
  }),
  S.filter((s) => {
    try {
      new URL(s)
      return true
    } catch {
      return false
    }
  }, { message: () => 'Invalid URL' })
)

/**
 * A nullable URL.
 */
export const nullableUrl = S.transform(
  S.Unknown,
  S.NullOr(S.String),
  {
    decode: (value) => {
      if (value === undefined || value === null) return null
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed === '') return null
        try {
          new URL(trimmed)
          return trimmed
        } catch {
          throw new Error('Invalid URL')
        }
      }
      throw new Error('Expected a string')
    },
    encode: (s) => s,
  }
)

// =============================================================================
// Laravel-style String Rules
// =============================================================================

/**
 * Validates that a string contains only alphabetic characters.
 */
export const alpha = S.String.pipe(
  S.transform(S.String, {
    decode: (s) => s.trim(),
    encode: (s) => s,
  }),
  S.pattern(/^[a-zA-Z]+$/, { message: () => 'Must contain only letters' })
)

/**
 * Validates that a string contains only alphanumeric characters, dashes, and underscores.
 */
export const alphaDash = S.String.pipe(
  S.transform(S.String, {
    decode: (s) => s.trim(),
    encode: (s) => s,
  }),
  S.pattern(/^[a-zA-Z0-9_-]+$/, {
    message: () => 'Must contain only letters, numbers, dashes, and underscores',
  })
)

/**
 * Validates that a string contains only alphanumeric characters.
 */
export const alphaNum = S.String.pipe(
  S.transform(S.String, {
    decode: (s) => s.trim(),
    encode: (s) => s,
  }),
  S.pattern(/^[a-zA-Z0-9]+$/, { message: () => 'Must contain only letters and numbers' })
)

/**
 * Validates a string starts with one of the given values.
 */
export const startsWith = (prefixes: string[], message?: string) =>
  S.String.pipe(
    S.filter(
      (val) => prefixes.some((prefix) => val.startsWith(prefix)),
      { message: () => message ?? `Must start with one of: ${prefixes.join(', ')}` }
    )
  )

/**
 * Validates a string ends with one of the given values.
 */
export const endsWith = (suffixes: string[], message?: string) =>
  S.String.pipe(
    S.filter(
      (val) => suffixes.some((suffix) => val.endsWith(suffix)),
      { message: () => message ?? `Must end with one of: ${suffixes.join(', ')}` }
    )
  )

/**
 * Validates that a string is all lowercase.
 */
export const lowercase = S.String.pipe(
  S.filter((val) => val === val.toLowerCase(), { message: () => 'Must be lowercase' })
)

/**
 * Validates that a string is all uppercase.
 */
export const uppercase = S.String.pipe(
  S.filter((val) => val === val.toUpperCase(), { message: () => 'Must be uppercase' })
)

// =============================================================================
// Laravel-style Numeric Rules
// =============================================================================

/**
 * Validates a number is between min and max (inclusive).
 */
export const between = (min: number, max: number, message?: string) =>
  coercedNumber.pipe(
    S.between(min, max, { message: () => message ?? `Must be between ${min} and ${max}` })
  )

/**
 * Validates that a value has exactly the specified number of digits.
 */
export const digits = (length: number, message?: string) =>
  S.String.pipe(
    S.pattern(
      new RegExp(`^\\d{${length}}$`),
      { message: () => message ?? `Must be exactly ${length} digits` }
    )
  )

/**
 * Validates that a value has between min and max digits.
 */
export const digitsBetween = (min: number, max: number, message?: string) =>
  S.String.pipe(
    S.pattern(
      new RegExp(`^\\d{${min},${max}}$`),
      { message: () => message ?? `Must be between ${min} and ${max} digits` }
    )
  )

/**
 * Validates a number is greater than the given value.
 */
export const gt = (value: number, message?: string) =>
  coercedNumber.pipe(
    S.greaterThan(value, { message: () => message ?? `Must be greater than ${value}` })
  )

/**
 * Validates a number is greater than or equal to the given value.
 */
export const gte = (value: number, message?: string) =>
  coercedNumber.pipe(
    S.greaterThanOrEqualTo(value, { message: () => message ?? `Must be at least ${value}` })
  )

/**
 * Validates a number is less than the given value.
 */
export const lt = (value: number, message?: string) =>
  coercedNumber.pipe(
    S.lessThan(value, { message: () => message ?? `Must be less than ${value}` })
  )

/**
 * Validates a number is less than or equal to the given value.
 */
export const lte = (value: number, message?: string) =>
  coercedNumber.pipe(
    S.lessThanOrEqualTo(value, { message: () => message ?? `Must be at most ${value}` })
  )

/**
 * Validates a number is a multiple of another number.
 */
export const multipleOf = (value: number, message?: string) =>
  coercedNumber.pipe(
    S.multipleOf(value, { message: () => message ?? `Must be a multiple of ${value}` })
  )

// =============================================================================
// Laravel-style Enum/In Rules
// =============================================================================

/**
 * Validates that a value is one of the allowed values.
 */
export const inArray = <T extends readonly string[]>(values: T, message?: string) =>
  S.String.pipe(
    S.filter(
      (val) => values.includes(val as T[number]),
      { message: () => message ?? `Must be one of: ${values.join(', ')}` }
    )
  ) as S.Schema<T[number], string, never>

/**
 * Validates that a value is NOT one of the disallowed values.
 */
export const notIn = <T>(values: T[], message?: string) =>
  S.Unknown.pipe(
    S.filter(
      (val) => !values.includes(val as T),
      { message: () => message ?? `Must not be one of: ${values.join(', ')}` }
    )
  )

// =============================================================================
// Laravel-style Format Rules
// =============================================================================

/**
 * Validates a UUID.
 */
export const uuid = S.UUID

/**
 * Validates a nullable UUID.
 */
export const nullableUuid = S.transform(
  S.Unknown,
  S.NullOr(S.UUID),
  {
    decode: (value) => {
      if (value === undefined || value === null || value === '') return null
      if (typeof value !== 'string') throw new Error('Expected a string')
      return value
    },
    encode: (s) => s,
  }
)

/**
 * Validates an IPv4 address.
 */
export const ipv4 = S.String.pipe(
  S.pattern(
    /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
    { message: () => 'Must be a valid IPv4 address' }
  )
)

/**
 * Validates an IPv6 address.
 */
export const ipv6 = S.String.pipe(
  S.pattern(
    /^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$|^::(?:[a-fA-F0-9]{1,4}:){0,5}[a-fA-F0-9]{1,4}$|^[a-fA-F0-9]{1,4}::(?:[a-fA-F0-9]{1,4}:){0,4}[a-fA-F0-9]{1,4}$|^(?:[a-fA-F0-9]{1,4}:){2}:(?:[a-fA-F0-9]{1,4}:){0,3}[a-fA-F0-9]{1,4}$|^(?:[a-fA-F0-9]{1,4}:){3}:(?:[a-fA-F0-9]{1,4}:){0,2}[a-fA-F0-9]{1,4}$|^(?:[a-fA-F0-9]{1,4}:){4}:(?:[a-fA-F0-9]{1,4}:)?[a-fA-F0-9]{1,4}$|^(?:[a-fA-F0-9]{1,4}:){5}:[a-fA-F0-9]{1,4}$|^(?:[a-fA-F0-9]{1,4}:){6}:$/,
    { message: () => 'Must be a valid IPv6 address' }
  )
)

/**
 * Validates an IP address (v4 or v6).
 */
export const ip = S.String.pipe(
  S.filter(
    (val) =>
      /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(val) ||
      /^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/.test(val),
    { message: () => 'Must be a valid IP address' }
  )
)

/**
 * Validates a MAC address.
 */
export const macAddress = S.String.pipe(
  S.pattern(
    /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/,
    { message: () => 'Must be a valid MAC address' }
  )
)

/**
 * Validates valid JSON string.
 */
export const jsonString = S.String.pipe(
  S.filter(
    (val) => {
      try {
        JSON.parse(val)
        return true
      } catch {
        return false
      }
    },
    { message: () => 'Must be valid JSON' }
  )
)

// =============================================================================
// Laravel-style Confirmation Rules
// =============================================================================

/**
 * Helper for password confirmation validation.
 * Use with S.Struct and filter for cross-field validation.
 */
export function confirmed(
  fieldName: string,
  confirmationFieldName = `${fieldName}_confirmation`,
  message = 'Confirmation does not match'
) {
  return {
    fieldName,
    confirmationFieldName,
    refine: <T extends Record<string, unknown>>(data: T) =>
      data[fieldName] === data[confirmationFieldName],
    message,
    path: [confirmationFieldName],
  }
}

// =============================================================================
// Laravel-style Accepted Rules
// =============================================================================

/**
 * Validates that a value is "accepted" (true, "yes", "on", "1", 1).
 */
export const accepted = S.transform(
  S.Unknown,
  S.Literal(true),
  {
    strict: false,
    decode: (value) => {
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value === 1
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim()
        return ['true', '1', 'on', 'yes'].includes(lower)
      }
      return false
    },
    encode: () => true,
  }
).pipe(
  S.filter((v): v is true => v === true, { message: () => 'Must be accepted' })
)

/**
 * Validates that a value is "declined" (false, "no", "off", "0", 0).
 */
export const declined = S.transform(
  S.Unknown,
  S.Literal(false),
  {
    strict: false,
    decode: (value) => {
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value === 0
      if (typeof value === 'string') {
        const lower = value.toLowerCase().trim()
        return ['false', '0', 'off', 'no'].includes(lower)
      }
      return true
    },
    encode: () => false,
  }
).pipe(
  S.filter((v): v is false => v === false, { message: () => 'Must be declined' })
)

// =============================================================================
// Laravel-style Size Rules
// =============================================================================

/**
 * Validates exact string length.
 */
export const size = (length: number, message?: string) =>
  S.String.pipe(S.length(length, { message: () => message ?? `Must be exactly ${length} characters` }))

/**
 * Validates minimum string length.
 */
export const min = (length: number, message?: string) =>
  S.String.pipe(S.minLength(length, { message: () => message ?? `Must be at least ${length} characters` }))

/**
 * Validates maximum string length.
 */
export const max = (length: number, message?: string) =>
  S.String.pipe(S.maxLength(length, { message: () => message ?? `Must be at most ${length} characters` }))

// =============================================================================
// Laravel-style Date Rules
// =============================================================================

/**
 * Validates a date is after the given date.
 */
export const after = (date: Date | string, message?: string) => {
  const compareDate = typeof date === 'string' ? new Date(date) : date
  return coercedDate.pipe(
    S.filter(
      (val) => val > compareDate,
      { message: () => message ?? `Must be after ${compareDate.toISOString()}` }
    )
  )
}

/**
 * Validates a date is after or equal to the given date.
 */
export const afterOrEqual = (date: Date | string, message?: string) => {
  const compareDate = typeof date === 'string' ? new Date(date) : date
  return coercedDate.pipe(
    S.filter(
      (val) => val >= compareDate,
      { message: () => message ?? `Must be on or after ${compareDate.toISOString()}` }
    )
  )
}

/**
 * Validates a date is before the given date.
 */
export const before = (date: Date | string, message?: string) => {
  const compareDate = typeof date === 'string' ? new Date(date) : date
  return coercedDate.pipe(
    S.filter(
      (val) => val < compareDate,
      { message: () => message ?? `Must be before ${compareDate.toISOString()}` }
    )
  )
}

/**
 * Validates a date is before or equal to the given date.
 */
export const beforeOrEqual = (date: Date | string, message?: string) => {
  const compareDate = typeof date === 'string' ? new Date(date) : date
  return coercedDate.pipe(
    S.filter(
      (val) => val <= compareDate,
      { message: () => message ?? `Must be on or before ${compareDate.toISOString()}` }
    )
  )
}

// =============================================================================
// Laravel-style Array Rules
// =============================================================================

/**
 * Validates array has distinct/unique values.
 */
export const distinct = <A, I, R>(schema: S.Schema<A, I, R>, message?: string) =>
  S.Array(schema).pipe(
    S.filter(
      (arr) => new Set(arr).size === arr.length,
      { message: () => message ?? 'Must contain unique values' }
    )
  )

/**
 * Validates array has minimum number of items.
 */
export const minItems = <A, I, R>(schema: S.Schema<A, I, R>, minCount: number, message?: string) =>
  S.Array(schema).pipe(
    S.minItems(minCount, { message: () => message ?? `Must have at least ${minCount} items` })
  )

/**
 * Validates array has maximum number of items.
 */
export const maxItems = <A, I, R>(schema: S.Schema<A, I, R>, maxCount: number, message?: string) =>
  S.Array(schema).pipe(
    S.maxItems(maxCount, { message: () => message ?? `Must have at most ${maxCount} items` })
  )

// =============================================================================
// Laravel-style Password Rules
// =============================================================================

/**
 * Creates a password schema with configurable rules.
 */
export function password(options: {
  min?: number
  max?: number
  letters?: boolean
  mixedCase?: boolean
  numbers?: boolean
  symbols?: boolean
} = {}) {
  const {
    min: minLength = 8,
    max: maxLength,
    letters = false,
    mixedCase = false,
    numbers = false,
    symbols = false,
  } = options

  let schema = S.String.pipe(
    S.minLength(minLength, { message: () => `Password must be at least ${minLength} characters` })
  )

  if (maxLength) {
    schema = schema.pipe(
      S.maxLength(maxLength, { message: () => `Password must be at most ${maxLength} characters` })
    )
  }

  if (letters) {
    schema = schema.pipe(
      S.filter((val) => /[a-zA-Z]/.test(val), {
        message: () => 'Password must contain at least one letter',
      })
    )
  }

  if (mixedCase) {
    schema = schema.pipe(
      S.filter((val) => /[a-z]/.test(val) && /[A-Z]/.test(val), {
        message: () => 'Password must contain both uppercase and lowercase letters',
      })
    )
  }

  if (numbers) {
    schema = schema.pipe(
      S.filter((val) => /\d/.test(val), {
        message: () => 'Password must contain at least one number',
      })
    )
  }

  if (symbols) {
    schema = schema.pipe(
      S.filter((val) => /[!@#$%^&*(),.?":{}|<>]/.test(val), {
        message: () => 'Password must contain at least one special character',
      })
    )
  }

  return schema
}

// =============================================================================
// Laravel-style Conditional Rules
// =============================================================================

/**
 * Excludes a field (sets to undefined) when a condition is met.
 */
export const excludeIf = <A, I, R>(
  schema: S.Schema<A, I, R>,
  condition: (value: unknown) => boolean
) =>
  S.transform(
    S.Unknown,
    S.Union(schema, S.Undefined),
    {
      decode: (value) => {
        if (condition(value)) return undefined
        return value as I
      },
      encode: (value) => value,
    }
  )

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Creates a nullable version of any schema.
 * Converts empty strings to null.
 */
export const nullable = <A, I, R>(schema: S.Schema<A, I, R>) =>
  S.transform(
    S.Unknown,
    S.NullOr(schema),
    {
      decode: (value) => {
        if (value === undefined || value === null) return null
        if (typeof value === 'string' && value.trim() === '') return null
        return value as I
      },
      encode: (value) => value,
    }
  )

/**
 * Creates a schema that fills in a default value when empty/null/undefined.
 */
export const filled = <A, I, R>(schema: S.Schema<A, I, R>, defaultValue: A) =>
  S.transform(
    S.Unknown,
    schema,
    {
      strict: false,
      decode: (value) => {
        if (value === undefined || value === null || value === '') return defaultValue as unknown as I
        return value as unknown as I
      },
      encode: (value) => value,
    }
  )

// =============================================================================
// Schema Helpers
// =============================================================================

/**
 * Re-export Schema namespace for convenience.
 */
export { Schema as S } from 'effect'

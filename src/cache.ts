/**
 * Cache Module
 *
 * Simple cache abstraction for storing expensive DB operations.
 * Uses CacheService which is automatically provided and backed by Cloudflare KV by default.
 * Can be swapped for Redis, Memcached, or any other implementation.
 */

import { Effect, Option, Schema, ParseResult, Duration } from 'effect'
import { CacheService, CacheClientError } from './effect/services.js'

// ============================================================================
// Errors
// ============================================================================

export class CacheError extends Schema.TaggedError<CacheError>()('CacheError', {
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

// ============================================================================
// Composable API
// ============================================================================

/**
 * Cache a computed value with automatic serialization and TTL.
 *
 * @example
 * ```typescript
 * const user = yield* cache(
 *   `user:${id}`,
 *   Effect.tryPromise(() => db.query.users.findFirst({ where: eq(users.id, id) })),
 *   UserSchema,
 *   Duration.hours(1)
 * )
 * ```
 */
export const cache = <V, E, R>(
  key: string,
  compute: Effect.Effect<V, E, R>,
  schema: Schema.Schema<V>,
  ttl: Duration.DurationInput
): Effect.Effect<V, E | CacheError | CacheClientError | ParseResult.ParseError, R | CacheService> =>
  Effect.gen(function* () {
    const cacheService = yield* CacheService

    // Check cache first
    const cached = yield* cacheService.get(key)

    if (cached !== null) {
      return yield* Schema.decodeUnknown(Schema.parseJson(schema))(cached)
    }

    // Compute value
    const value = yield* compute

    // Store in cache
    const serialized = yield* Schema.encode(Schema.parseJson(schema))(value)
    const ttlSeconds = Duration.toSeconds(Duration.decode(ttl))

    yield* cacheService.put(key, serialized, { expirationTtl: ttlSeconds })

    return value
  })

/**
 * Get a value from cache without computing.
 *
 * @example
 * ```typescript
 * const cached = yield* cacheGet(`user:${id}`, UserSchema)
 * if (Option.isSome(cached)) {
 *   return cached.value
 * }
 * ```
 */
export const cacheGet = <V>(
  key: string,
  schema: Schema.Schema<V>
): Effect.Effect<Option.Option<V>, CacheError | CacheClientError | ParseResult.ParseError, CacheService> =>
  Effect.gen(function* () {
    const cacheService = yield* CacheService

    const cached = yield* cacheService.get(key)

    if (cached === null) {
      return Option.none<V>()
    }

    const decoded = yield* Schema.decodeUnknown(Schema.parseJson(schema))(cached)
    return Option.some(decoded)
  })

/**
 * Set a value in cache.
 *
 * @example
 * ```typescript
 * yield* cacheSet(`user:${id}`, user, UserSchema, Duration.hours(1))
 * ```
 */
export const cacheSet = <V>(
  key: string,
  value: V,
  schema: Schema.Schema<V>,
  ttl: Duration.DurationInput
): Effect.Effect<void, CacheError | CacheClientError | ParseResult.ParseError, CacheService> =>
  Effect.gen(function* () {
    const cacheService = yield* CacheService

    const serialized = yield* Schema.encode(Schema.parseJson(schema))(value)
    const ttlSeconds = Duration.toSeconds(Duration.decode(ttl))

    yield* cacheService.put(key, serialized, { expirationTtl: ttlSeconds })
  })

/**
 * Invalidate a cache key.
 *
 * @example
 * ```typescript
 * yield* cacheInvalidate(`user:${id}`)
 * ```
 */
export const cacheInvalidate = (
  key: string
): Effect.Effect<void, CacheClientError, CacheService> =>
  Effect.gen(function* () {
    const cacheService = yield* CacheService
    yield* cacheService.delete(key)
  })

/**
 * Invalidate all cache keys with a given prefix.
 *
 * @example
 * ```typescript
 * yield* cacheInvalidatePrefix(`user:${userId}:`)
 * ```
 */
export const cacheInvalidatePrefix = (
  prefix: string
): Effect.Effect<void, CacheClientError, CacheService> =>
  Effect.gen(function* () {
    const cacheService = yield* CacheService

    const list = yield* cacheService.list({ prefix })

    yield* Effect.forEach(
      list.keys,
      (key) => cacheService.delete(key.name),
      { concurrency: 10 }
    )
  })

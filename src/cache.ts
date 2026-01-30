/**
 * Cache Module
 *
 * Simple cache abstraction for storing expensive DB operations.
 * Uses CacheService which is automatically provided and backed by Cloudflare KV by default.
 * Can be swapped for Redis, Memcached, or any other implementation.
 *
 * Supports stale-while-revalidate (SWR) pattern for improved latency and resilience.
 */

import { Effect, Option, Schema, ParseResult, Duration } from 'effect'
import { CacheService, CacheClientError, ExecutionContextService } from './effect/services.js'

// ============================================================================
// Types
// ============================================================================

export type CacheOptions = {
  /** Time-to-live for cached values */
  ttl: Duration.DurationInput
  /**
   * Stale-while-revalidate window. When set, stale values within this window
   * are returned immediately while a background refresh is triggered.
   * Without ExecutionContext, the refresh happens on the next request.
   */
  swr?: Duration.DurationInput
}

// ============================================================================
// Errors
// ============================================================================

export class CacheError extends Schema.TaggedError<CacheError>()('CacheError', {
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

// ============================================================================
// Internal
// ============================================================================

/** Internal schema for storing value with metadata */
const CacheEntrySchema = <V>(valueSchema: Schema.Schema<V>) =>
  Schema.Struct({
    v: valueSchema,
    t: Schema.Number, // cachedAt timestamp
  })

type CacheEntry<V> = { v: V; t: number }

// ============================================================================
// Composable API
// ============================================================================

/**
 * Cache a computed value with automatic serialization and TTL.
 * Supports stale-while-revalidate (SWR) for improved latency.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const user = yield* cache(
 *   `user:${id}`,
 *   Effect.tryPromise(() => db.query.users.findFirst({ where: eq(users.id, id) })),
 *   UserSchema,
 *   { ttl: Duration.hours(1) }
 * )
 *
 * // With stale-while-revalidate
 * const user = yield* cache(
 *   `user:${id}`,
 *   fetchUser(id),
 *   UserSchema,
 *   { ttl: Duration.hours(1), swr: Duration.minutes(5) }
 * )
 * ```
 */
export const cache = <V, E, R>(
  key: string,
  compute: Effect.Effect<V, E, R>,
  schema: Schema.Schema<V>,
  options: CacheOptions
): Effect.Effect<V, E | CacheError | CacheClientError | ParseResult.ParseError, R | CacheService | ExecutionContextService> =>
  Effect.gen(function* () {
    const cacheService = yield* CacheService
    const executionContext = yield* ExecutionContextService
    const entrySchema = CacheEntrySchema(schema)
    const jsonSchema = Schema.parseJson(entrySchema)

    const ttlMs = Duration.toMillis(Duration.decode(options.ttl))
    const swrMs = options.swr ? Duration.toMillis(Duration.decode(options.swr)) : 0
    const totalTtlSeconds = Math.ceil((ttlMs + swrMs) / 1000)

    // Helper to store a value in cache
    const storeInCache = (value: V) =>
      Effect.gen(function* () {
        const newEntry: CacheEntry<V> = { v: value, t: Date.now() }
        const serialized = yield* Schema.encode(jsonSchema)(newEntry)
        yield* cacheService.put(key, serialized, { expirationTtl: totalTtlSeconds })
      })

    // Check cache first
    const cached = yield* cacheService.get(key)

    if (cached !== null) {
      const entry = yield* Schema.decodeUnknown(jsonSchema)(cached)
      const age = Date.now() - entry.t

      if (age < ttlMs) {
        // Fresh - return immediately
        return entry.v
      }

      if (swrMs > 0 && age < ttlMs + swrMs) {
        // Stale but within SWR window - return stale, trigger background refresh
        if (executionContext.isAvailable) {
          yield* executionContext.runInBackground(
            Effect.gen(function* () {
              const freshValue = yield* compute
              yield* storeInCache(freshValue)
            })
          )
        }
        return entry.v
      }

      // Beyond SWR window - fall through to recompute
    }

    // Compute value (cold cache or expired)
    const value = yield* compute

    // Store with timestamp
    yield* storeInCache(value)

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
    const entrySchema = CacheEntrySchema(schema)
    const jsonSchema = Schema.parseJson(entrySchema)

    const cached = yield* cacheService.get(key)

    if (cached === null) {
      return Option.none<V>()
    }

    const entry = yield* Schema.decodeUnknown(jsonSchema)(cached)
    return Option.some(entry.v)
  })

/**
 * Set a value in cache.
 *
 * @example
 * ```typescript
 * yield* cacheSet(`user:${id}`, user, UserSchema, { ttl: Duration.hours(1) })
 * ```
 */
export const cacheSet = <V>(
  key: string,
  value: V,
  schema: Schema.Schema<V>,
  options: CacheOptions
): Effect.Effect<void, CacheError | CacheClientError | ParseResult.ParseError, CacheService> =>
  Effect.gen(function* () {
    const cacheService = yield* CacheService
    const entrySchema = CacheEntrySchema(schema)
    const jsonSchema = Schema.parseJson(entrySchema)

    const ttlMs = Duration.toMillis(Duration.decode(options.ttl))
    const swrMs = options.swr ? Duration.toMillis(Duration.decode(options.swr)) : 0
    const totalTtlSeconds = Math.ceil((ttlMs + swrMs) / 1000)

    const entry: CacheEntry<V> = { v: value, t: Date.now() }
    const serialized = yield* Schema.encode(jsonSchema)(entry)

    yield* cacheService.put(key, serialized, { expirationTtl: totalTtlSeconds })
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

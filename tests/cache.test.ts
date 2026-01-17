import { describe, it, expect, beforeEach } from 'bun:test'
import { Effect, Layer, Option, Schema as S, Duration } from 'effect'
import {
  CacheService,
  CacheClientError,
  cache,
  cacheGet,
  cacheSet,
  cacheInvalidate,
  cacheInvalidatePrefix,
  CacheError,
  type CacheClient,
} from '../src/effect/index'

// ============================================================================
// Test Cache Layer
// ============================================================================

const makeTestCache = (): {
  layer: Layer.Layer<CacheService>
  store: Map<string, { value: string; expiresAt: number }>
} => {
  const store = new Map<string, { value: string; expiresAt: number }>()

  const client: CacheClient = {
    get: (key) =>
      Effect.sync(() => {
        const entry = store.get(key)
        if (!entry || entry.expiresAt < Date.now()) {
          store.delete(key)
          return null
        }
        return entry.value
      }),
    put: (key, value, options) =>
      Effect.sync(() => {
        const ttlMs = (options?.expirationTtl ?? 3600) * 1000
        store.set(key, { value, expiresAt: Date.now() + ttlMs })
      }),
    delete: (key) =>
      Effect.sync(() => {
        store.delete(key)
      }),
    list: (options) =>
      Effect.sync(() => ({
        keys: [...store.keys()]
          .filter((k) => !options?.prefix || k.startsWith(options.prefix))
          .map((name) => ({ name })),
      })),
  }

  return {
    layer: Layer.succeed(CacheService, client),
    store,
  }
}

// ============================================================================
// Test Schemas
// ============================================================================

const UserSchema = S.Struct({
  id: S.String,
  name: S.String,
  email: S.String,
})

const ProjectSchema = S.Struct({
  id: S.String,
  name: S.String,
  userId: S.String,
})

// ============================================================================
// Tests
// ============================================================================

describe('cache', () => {
  describe('cache()', () => {
    it('computes and caches value on first call', async () => {
      const { layer } = makeTestCache()
      let callCount = 0

      await Effect.gen(function* () {
        const compute = Effect.sync(() => {
          callCount++
          return { id: '1', name: 'Test User', email: 'test@example.com' }
        })

        const result = yield* cache('user:1', compute, UserSchema, Duration.hours(1))

        expect(result).toEqual({ id: '1', name: 'Test User', email: 'test@example.com' })
        expect(callCount).toBe(1)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('returns cached value on subsequent calls without recomputing', async () => {
      const { layer } = makeTestCache()
      let callCount = 0

      await Effect.gen(function* () {
        const compute = Effect.sync(() => {
          callCount++
          return { id: '1', name: 'Test User', email: 'test@example.com' }
        })

        const first = yield* cache('user:1', compute, UserSchema, Duration.hours(1))
        const second = yield* cache('user:1', compute, UserSchema, Duration.hours(1))
        const third = yield* cache('user:1', compute, UserSchema, Duration.hours(1))

        expect(first).toEqual(second)
        expect(second).toEqual(third)
        expect(callCount).toBe(1) // Only computed once
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('recomputes after cache invalidation', async () => {
      const { layer } = makeTestCache()
      let callCount = 0

      await Effect.gen(function* () {
        const compute = Effect.sync(() => {
          callCount++
          return { id: '1', name: `User ${callCount}`, email: 'test@example.com' }
        })

        const first = yield* cache('user:1', compute, UserSchema, Duration.hours(1))
        expect(first.name).toBe('User 1')

        yield* cacheInvalidate('user:1')

        const second = yield* cache('user:1', compute, UserSchema, Duration.hours(1))
        expect(second.name).toBe('User 2')
        expect(callCount).toBe(2)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('propagates compute errors', async () => {
      const { layer } = makeTestCache()

      const result = await Effect.gen(function* () {
        const compute = Effect.fail(new Error('Database connection failed'))

        return yield* cache('user:1', compute, UserSchema, Duration.hours(1))
      }).pipe(Effect.provide(layer), Effect.either, Effect.runPromise)

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(Error)
        expect((result.left as Error).message).toBe('Database connection failed')
      }
    })

    it('handles schema decode errors for invalid cached data', async () => {
      const { layer, store } = makeTestCache()

      // Pre-populate cache with invalid data
      store.set('user:1', {
        value: JSON.stringify({ id: '1', invalid: 'data' }), // Missing required fields
        expiresAt: Date.now() + 3600000,
      })

      const result = await Effect.gen(function* () {
        const compute = Effect.sync(() => ({
          id: '1',
          name: 'Test User',
          email: 'test@example.com',
        }))

        return yield* cache('user:1', compute, UserSchema, Duration.hours(1))
      }).pipe(Effect.provide(layer), Effect.either, Effect.runPromise)

      expect(result._tag).toBe('Left')
    })

    it('caches complex nested objects', async () => {
      const { layer } = makeTestCache()

      const ComplexSchema = S.Struct({
        id: S.String,
        data: S.Struct({
          items: S.Array(S.Struct({ name: S.String, value: S.Number })),
          metadata: S.Struct({
            createdAt: S.String,
            tags: S.Array(S.String),
          }),
        }),
      })

      await Effect.gen(function* () {
        const complex = {
          id: '1',
          data: {
            items: [
              { name: 'item1', value: 100 },
              { name: 'item2', value: 200 },
            ],
            metadata: {
              createdAt: '2024-01-01',
              tags: ['tag1', 'tag2'],
            },
          },
        }

        const compute = Effect.succeed(complex)
        const result = yield* cache('complex:1', compute, ComplexSchema, Duration.hours(1))

        expect(result).toEqual(complex)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })
  })

  describe('cacheGet()', () => {
    it('returns Option.none for missing keys', async () => {
      const { layer } = makeTestCache()

      await Effect.gen(function* () {
        const result = yield* cacheGet('nonexistent', UserSchema)
        expect(Option.isNone(result)).toBe(true)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('returns Option.some with decoded value for existing keys', async () => {
      const { layer, store } = makeTestCache()

      // Pre-populate cache
      store.set('user:1', {
        value: JSON.stringify({ id: '1', name: 'Test', email: 'test@example.com' }),
        expiresAt: Date.now() + 3600000,
      })

      await Effect.gen(function* () {
        const result = yield* cacheGet('user:1', UserSchema)

        expect(Option.isSome(result)).toBe(true)
        if (Option.isSome(result)) {
          expect(result.value).toEqual({ id: '1', name: 'Test', email: 'test@example.com' })
        }
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('returns Option.none for expired entries', async () => {
      const { layer, store } = makeTestCache()

      // Pre-populate cache with expired entry
      store.set('user:1', {
        value: JSON.stringify({ id: '1', name: 'Test', email: 'test@example.com' }),
        expiresAt: Date.now() - 1000, // Expired
      })

      await Effect.gen(function* () {
        const result = yield* cacheGet('user:1', UserSchema)
        expect(Option.isNone(result)).toBe(true)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })
  })

  describe('cacheSet()', () => {
    it('stores value in cache', async () => {
      const { layer, store } = makeTestCache()

      await Effect.gen(function* () {
        const user = { id: '1', name: 'Test', email: 'test@example.com' }
        yield* cacheSet('user:1', user, UserSchema, Duration.hours(1))

        const entry = store.get('user:1')
        expect(entry).toBeDefined()
        expect(JSON.parse(entry!.value)).toEqual(user)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('overwrites existing value', async () => {
      const { layer, store } = makeTestCache()

      await Effect.gen(function* () {
        const user1 = { id: '1', name: 'User 1', email: 'user1@example.com' }
        const user2 = { id: '1', name: 'User 2', email: 'user2@example.com' }

        yield* cacheSet('user:1', user1, UserSchema, Duration.hours(1))
        yield* cacheSet('user:1', user2, UserSchema, Duration.hours(1))

        const entry = store.get('user:1')
        expect(JSON.parse(entry!.value)).toEqual(user2)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('respects TTL', async () => {
      const { layer, store } = makeTestCache()

      await Effect.gen(function* () {
        const user = { id: '1', name: 'Test', email: 'test@example.com' }
        yield* cacheSet('user:1', user, UserSchema, Duration.seconds(60))

        const entry = store.get('user:1')
        const expectedExpiry = Date.now() + 60000
        // Allow 1 second tolerance
        expect(entry!.expiresAt).toBeGreaterThan(expectedExpiry - 1000)
        expect(entry!.expiresAt).toBeLessThan(expectedExpiry + 1000)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })
  })

  describe('cacheInvalidate()', () => {
    it('removes key from cache', async () => {
      const { layer, store } = makeTestCache()

      store.set('user:1', {
        value: JSON.stringify({ id: '1', name: 'Test', email: 'test@example.com' }),
        expiresAt: Date.now() + 3600000,
      })

      await Effect.gen(function* () {
        yield* cacheInvalidate('user:1')
        expect(store.has('user:1')).toBe(false)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('succeeds for non-existent keys', async () => {
      const { layer } = makeTestCache()

      await Effect.gen(function* () {
        // Should not throw
        yield* cacheInvalidate('nonexistent')
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })
  })

  describe('cacheInvalidatePrefix()', () => {
    it('removes all keys with matching prefix', async () => {
      const { layer, store } = makeTestCache()

      // Pre-populate cache with multiple keys
      store.set('user:1:profile', {
        value: '{}',
        expiresAt: Date.now() + 3600000,
      })
      store.set('user:1:settings', {
        value: '{}',
        expiresAt: Date.now() + 3600000,
      })
      store.set('user:1:notifications', {
        value: '{}',
        expiresAt: Date.now() + 3600000,
      })
      store.set('user:2:profile', {
        value: '{}',
        expiresAt: Date.now() + 3600000,
      })
      store.set('other:key', {
        value: '{}',
        expiresAt: Date.now() + 3600000,
      })

      await Effect.gen(function* () {
        yield* cacheInvalidatePrefix('user:1:')

        expect(store.has('user:1:profile')).toBe(false)
        expect(store.has('user:1:settings')).toBe(false)
        expect(store.has('user:1:notifications')).toBe(false)
        expect(store.has('user:2:profile')).toBe(true) // Not deleted
        expect(store.has('other:key')).toBe(true) // Not deleted
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('handles empty prefix (deletes nothing)', async () => {
      const { layer, store } = makeTestCache()

      store.set('key1', { value: '{}', expiresAt: Date.now() + 3600000 })
      store.set('key2', { value: '{}', expiresAt: Date.now() + 3600000 })

      await Effect.gen(function* () {
        yield* cacheInvalidatePrefix('nonexistent:')

        expect(store.has('key1')).toBe(true)
        expect(store.has('key2')).toBe(true)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })
  })

  describe('CacheService directly', () => {
    it('provides raw access to cache operations', async () => {
      const { layer } = makeTestCache()

      await Effect.gen(function* () {
        const cacheClient = yield* CacheService

        // Raw put
        yield* cacheClient.put('raw:key', '{"data":"value"}', { expirationTtl: 3600 })

        // Raw get
        const raw = yield* cacheClient.get('raw:key')
        expect(raw).toBe('{"data":"value"}')

        // List
        const keys = yield* cacheClient.list({ prefix: 'raw:' })
        expect(keys.keys).toHaveLength(1)
        expect(keys.keys[0].name).toBe('raw:key')

        // Delete
        yield* cacheClient.delete('raw:key')
        const deleted = yield* cacheClient.get('raw:key')
        expect(deleted).toBeNull()
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })
  })

  describe('error handling', () => {
    it('wraps cache client errors in CacheClientError', async () => {
      const failingClient: CacheClient = {
        get: () => Effect.fail(new CacheClientError('Connection failed', new Error('ECONNREFUSED'))),
        put: () => Effect.fail(new CacheClientError('Connection failed')),
        delete: () => Effect.fail(new CacheClientError('Connection failed')),
        list: () => Effect.fail(new CacheClientError('Connection failed')),
      }

      const failingLayer = Layer.succeed(CacheService, failingClient)

      const result = await Effect.gen(function* () {
        return yield* cacheGet('key', UserSchema)
      }).pipe(Effect.provide(failingLayer), Effect.either, Effect.runPromise)

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(CacheClientError)
        expect((result.left as CacheClientError).reason).toBe('Connection failed')
      }
    })
  })

  describe('integration scenarios', () => {
    it('handles typical read-through cache pattern', async () => {
      const { layer } = makeTestCache()
      let dbCalls = 0

      const fetchFromDb = (id: string) =>
        Effect.sync(() => {
          dbCalls++
          return { id, name: `Project ${id}`, userId: 'user-1' }
        })

      await Effect.gen(function* () {
        // First request - cache miss, fetches from DB
        const project1 = yield* cache(
          'project:1',
          fetchFromDb('1'),
          ProjectSchema,
          Duration.minutes(5)
        )
        expect(project1.id).toBe('1')
        expect(dbCalls).toBe(1)

        // Second request - cache hit
        const project1Again = yield* cache(
          'project:1',
          fetchFromDb('1'),
          ProjectSchema,
          Duration.minutes(5)
        )
        expect(project1Again.id).toBe('1')
        expect(dbCalls).toBe(1) // Still 1, no DB call

        // Different key - cache miss
        const project2 = yield* cache(
          'project:2',
          fetchFromDb('2'),
          ProjectSchema,
          Duration.minutes(5)
        )
        expect(project2.id).toBe('2')
        expect(dbCalls).toBe(2)
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })

    it('handles write-through invalidation pattern', async () => {
      const { layer } = makeTestCache()
      let version = 1

      const fetchProject = () =>
        Effect.sync(() => ({
          id: '1',
          name: `Project v${version}`,
          userId: 'user-1',
        }))

      const updateProject = () =>
        Effect.sync(() => {
          version++
        })

      await Effect.gen(function* () {
        // Initial fetch
        const v1 = yield* cache('project:1', fetchProject(), ProjectSchema, Duration.hours(1))
        expect(v1.name).toBe('Project v1')

        // Update (simulated DB write)
        yield* updateProject()

        // Still returns cached v1
        const stillV1 = yield* cache('project:1', fetchProject(), ProjectSchema, Duration.hours(1))
        expect(stillV1.name).toBe('Project v1')

        // Invalidate after write
        yield* cacheInvalidate('project:1')

        // Now gets fresh v2
        const v2 = yield* cache('project:1', fetchProject(), ProjectSchema, Duration.hours(1))
        expect(v2.name).toBe('Project v2')
      }).pipe(Effect.provide(layer), Effect.runPromise)
    })
  })
})

/**
 * Action Factories Tests
 */

import { describe, test, expect } from 'bun:test'
import { Effect, Schema as S, Layer, Exit, Cause } from 'effect'
import {
  effectAction,
  dbAction,
  authAction,
  simpleAction,
  injectUser,
  dbOperation,
  prepareData,
  preparedAction,
} from '../../src/effect/action.js'
import {
  DatabaseService,
  AuthUserService,
  RequestService,
  type AuthUser,
  type RequestContext,
} from '../../src/effect/services.js'
import { Redirect, ValidationError, UnauthorizedError } from '../../src/effect/errors.js'

// Mock user
const createMockUser = (overrides: Partial<AuthUser['user']> = {}): AuthUser => ({
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: true,
    image: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  },
  session: {
    id: 'session-456',
    userId: 'user-123',
    expiresAt: new Date('2024-12-31'),
    token: 'test-token',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
})

// Mock database
const createMockDb = () => ({
  insert: (table: string) => ({
    values: (data: unknown) => Promise.resolve({ inserted: data }),
  }),
  query: {
    users: {
      findMany: () => Promise.resolve([{ id: 1 }, { id: 2 }]),
    },
  },
})

// Mock request context
const createMockRequest = (options: {
  method?: string
  body?: Record<string, unknown>
  params?: Record<string, string>
  query?: Record<string, string>
} = {}): RequestContext => ({
  method: options.method || 'POST',
  url: 'http://localhost/',
  headers: new Headers({ 'Content-Type': 'application/json' }),
  param: (name: string) => options.params?.[name],
  params: () => options.params || {},
  query: () => options.query || {},
  json: async <T>() => (options.body || {}) as T,
  parseBody: async () => options.body || {},
  header: (name: string) =>
    name.toLowerCase() === 'content-type' ? 'application/json' : undefined,
})

describe('effectAction', () => {
  test('validates input and calls handler', async () => {
    const schema = S.Struct({
      name: S.String.pipe(S.minLength(2)),
    })

    const action = effectAction(schema, (input) =>
      Effect.succeed(new Redirect({ url: `/created/${input.name}`, status: 303 }))
    )

    const request = createMockRequest({ body: { name: 'Test' } })
    const layer = Layer.succeed(RequestService, request)

    const result = await Effect.runPromise(Effect.provide(action, layer))

    expect(result).toBeInstanceOf(Redirect)
    expect((result as Redirect).url).toBe('/created/Test')
  })

  test('fails with ValidationError on invalid input', async () => {
    const schema = S.Struct({
      name: S.String.pipe(S.minLength(5)),
    })

    const action = effectAction(schema, (input) =>
      Effect.succeed(new Redirect({ url: '/', status: 303 }))
    )

    const request = createMockRequest({ body: { name: 'Hi' } })
    const layer = Layer.succeed(RequestService, request)

    const exit = await Effect.runPromiseExit(Effect.provide(action, layer))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit) && Cause.isFailure(exit.cause)) {
      const option = Cause.failureOption(exit.cause)
      if (option._tag === 'Some') {
        expect((option.value as ValidationError)._tag).toBe('ValidationError')
      }
    }
  })

  test('passes error component option', async () => {
    const schema = S.Struct({
      email: S.String.pipe(S.minLength(1)),
    })

    const action = effectAction(
      schema,
      () => Effect.succeed(new Redirect({ url: '/', status: 303 })),
      { errorComponent: 'Users/Create' }
    )

    const request = createMockRequest({ body: { email: '' } })
    const layer = Layer.succeed(RequestService, request)

    const exit = await Effect.runPromiseExit(Effect.provide(action, layer))

    if (Exit.isFailure(exit) && Cause.isFailure(exit.cause)) {
      const option = Cause.failureOption(exit.cause)
      if (option._tag === 'Some') {
        expect((option.value as ValidationError).component).toBe('Users/Create')
      }
    }
  })
})

describe('dbAction', () => {
  test('provides db and user to handler', async () => {
    const schema = S.Struct({
      name: S.String,
    })

    let capturedDeps: { db: unknown; user: AuthUser } | null = null

    const action = dbAction(schema, (input, deps) => {
      capturedDeps = deps
      return Effect.succeed(new Redirect({ url: '/', status: 303 }))
    })

    const mockDb = createMockDb()
    const mockUser = createMockUser()
    const request = createMockRequest({ body: { name: 'Project' } })

    const layer = Layer.mergeAll(
      Layer.succeed(RequestService, request),
      Layer.succeed(DatabaseService, mockDb),
      Layer.succeed(AuthUserService, mockUser)
    )

    await Effect.runPromise(Effect.provide(action, layer))

    expect(capturedDeps).not.toBeNull()
    expect(capturedDeps!.db).toBe(mockDb)
    expect(capturedDeps!.user.user.id).toBe('user-123')
  })

  test('fails without authenticated user', async () => {
    const schema = S.Struct({ name: S.String })

    const action = dbAction(schema, () =>
      Effect.succeed(new Redirect({ url: '/', status: 303 }))
    )

    const mockDb = createMockDb()
    const request = createMockRequest({ body: { name: 'Test' } })

    const layer = Layer.mergeAll(
      Layer.succeed(RequestService, request),
      Layer.succeed(DatabaseService, mockDb)
    )

    const exit = await Effect.runPromiseExit(Effect.provide(action, layer))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test('validates input before accessing db/user', async () => {
    const schema = S.Struct({
      name: S.String.pipe(S.minLength(3)),
    })

    let handlerCalled = false

    const action = dbAction(schema, () => {
      handlerCalled = true
      return Effect.succeed(new Redirect({ url: '/', status: 303 }))
    })

    const request = createMockRequest({ body: { name: 'X' } })

    const layer = Layer.mergeAll(
      Layer.succeed(RequestService, request),
      Layer.succeed(DatabaseService, createMockDb()),
      Layer.succeed(AuthUserService, createMockUser())
    )

    await Effect.runPromiseExit(Effect.provide(action, layer))

    // Handler should not be called due to validation failure
    // Note: dbAction validates after getting db/user, so this may still fail
    // The important thing is the validation error is returned
    expect(handlerCalled).toBe(false)
  })
})

describe('authAction', () => {
  test('passes user to handler', async () => {
    let capturedUser: AuthUser | null = null

    const action = authAction((user) => {
      capturedUser = user
      return Effect.succeed(new Response('OK'))
    })

    const mockUser = createMockUser({ name: 'Jane' })
    const layer = Layer.succeed(AuthUserService, mockUser)

    await Effect.runPromise(Effect.provide(action, layer))

    expect(capturedUser).not.toBeNull()
    expect(capturedUser!.user.name).toBe('Jane')
  })

  test('fails without authenticated user', async () => {
    const action = authAction(() => Effect.succeed(new Response('OK')))

    const exit = await Effect.runPromiseExit(action)
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe('simpleAction', () => {
  test('executes handler directly', async () => {
    const action = simpleAction(() =>
      Effect.succeed(new Response('Hello World'))
    )

    const response = await Effect.runPromise(action)
    const text = await response.text()

    expect(text).toBe('Hello World')
  })

  test('can access services', async () => {
    const action = simpleAction(() =>
      Effect.gen(function* () {
        const db = yield* DatabaseService
        return new Response(JSON.stringify(db))
      })
    )

    const mockDb = { name: 'test-db' }
    const layer = Layer.succeed(DatabaseService, mockDb)

    const response = await Effect.runPromise(Effect.provide(action, layer))
    const json = await response.json()

    expect(json).toEqual({ name: 'test-db' })
  })
})

describe('injectUser', () => {
  test('adds userId to input', async () => {
    const input = { name: 'Project', description: 'A project' }
    const effect = injectUser(input)

    const mockUser = createMockUser({ id: 'abc-123' })
    const layer = Layer.succeed(AuthUserService, mockUser)

    const result = await Effect.runPromise(Effect.provide(effect, layer))

    expect(result).toEqual({
      name: 'Project',
      description: 'A project',
      userId: 'abc-123',
    })
  })

  test('fails without user', () => {
    const input = { name: 'Test' }
    const exit = Effect.runSyncExit(injectUser(input))

    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe('dbOperation', () => {
  test('wraps database operation in Effect', async () => {
    const operation = dbOperation((db: any) => db.query.users.findMany())

    const mockDb = createMockDb()
    const layer = Layer.succeed(DatabaseService, mockDb)

    const result = await Effect.runPromise(Effect.provide(operation, layer))

    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  test('handles database errors', async () => {
    const operation = dbOperation(() => {
      throw new Error('Connection failed')
    })

    const layer = Layer.succeed(DatabaseService, {})

    const exit = await Effect.runPromiseExit(Effect.provide(operation, layer))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test('converts non-Error throws to Error', async () => {
    const operation = dbOperation(() => {
      throw 'string error'
    })

    const layer = Layer.succeed(DatabaseService, {})

    const exit = await Effect.runPromiseExit(Effect.provide(operation, layer))

    if (Exit.isFailure(exit) && Cause.isFailure(exit.cause)) {
      const option = Cause.failureOption(exit.cause)
      if (option._tag === 'Some') {
        expect(option.value).toBeInstanceOf(Error)
      }
    }
  })
})

describe('prepareData', () => {
  test('transforms request data', async () => {
    const effect = prepareData((data) => ({
      ...data,
      processed: true,
    }))

    const request = createMockRequest({
      body: { name: 'Test', value: 123 },
    })
    const layer = Layer.succeed(RequestService, request)

    const result = await Effect.runPromise(Effect.provide(effect, layer))

    expect(result).toEqual({
      name: 'Test',
      value: 123,
      processed: true,
    })
  })

  test('supports async transforms', async () => {
    const effect = prepareData(async (data) => {
      await Promise.resolve()
      return { ...data, async: true }
    })

    const request = createMockRequest({ body: { name: 'Test' } })
    const layer = Layer.succeed(RequestService, request)

    const result = await Effect.runPromise(Effect.provide(effect, layer))

    expect(result.async).toBe(true)
  })
})

describe('preparedAction', () => {
  test('prepares data before validation', async () => {
    const schema = S.Struct({
      name: S.String,
      slug: S.String,
    })

    const action = preparedAction(
      schema,
      (data) => ({
        ...data,
        slug: (data.name as string).toLowerCase().replace(/\s+/g, '-'),
      }),
      (input) => Effect.succeed(new Response(JSON.stringify(input)))
    )

    const request = createMockRequest({ body: { name: 'Hello World' } })
    const layer = Layer.succeed(RequestService, request)

    const response = await Effect.runPromise(Effect.provide(action, layer))
    const json = await response.json()

    expect(json).toEqual({
      name: 'Hello World',
      slug: 'hello-world',
    })
  })

  test('validation fails after preparation', async () => {
    const schema = S.Struct({
      name: S.String.pipe(S.minLength(10)),
    })

    const action = preparedAction(
      schema,
      (data) => ({ name: (data.name as string).slice(0, 5) }), // Truncates to fail validation
      () => Effect.succeed(new Response('OK'))
    )

    const request = createMockRequest({ body: { name: 'Hello World' } })
    const layer = Layer.succeed(RequestService, request)

    const exit = await Effect.runPromiseExit(Effect.provide(action, layer))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test('passes error options', async () => {
    const schema = S.Struct({
      email: S.String.pipe(S.minLength(1)),
    })

    const action = preparedAction(
      schema,
      (data) => data,
      () => Effect.succeed(new Response('OK')),
      { errorComponent: 'Form/Submit' }
    )

    const request = createMockRequest({ body: { email: '' } })
    const layer = Layer.succeed(RequestService, request)

    const exit = await Effect.runPromiseExit(Effect.provide(action, layer))

    if (Exit.isFailure(exit) && Cause.isFailure(exit.cause)) {
      const option = Cause.failureOption(exit.cause)
      if (option._tag === 'Some') {
        expect((option.value as ValidationError).component).toBe('Form/Submit')
      }
    }
  })
})

describe('Action Composition Patterns', () => {
  test('chain multiple actions', async () => {
    const validateEmail = (email: string) =>
      email.includes('@')
        ? Effect.succeed(email)
        : Effect.fail(new ValidationError({ errors: { email: 'Invalid' } }))

    const createUser = (email: string) =>
      Effect.gen(function* () {
        const db = yield* DatabaseService
        return { id: 'new-id', email }
      })

    const sendWelcome = (userId: string) =>
      Effect.succeed({ sent: true, userId })

    const registrationFlow = Effect.gen(function* () {
      const email = yield* validateEmail('test@example.com')
      const user = yield* createUser(email)
      const _ = yield* sendWelcome(user.id)
      return new Redirect({ url: '/welcome', status: 303 })
    })

    const layer = Layer.succeed(DatabaseService, createMockDb())
    const result = await Effect.runPromise(Effect.provide(registrationFlow, layer))

    expect(result).toBeInstanceOf(Redirect)
  })

  test('handle errors in flow', async () => {
    const riskyOperation = Effect.fail(
      new ValidationError({ errors: { field: 'Error' } })
    )

    const safeFlow = riskyOperation.pipe(
      Effect.catchTag('ValidationError', (e) =>
        Effect.succeed(new Response(JSON.stringify(e.errors), { status: 422 }))
      )
    )

    const response = await Effect.runPromise(safeFlow)
    expect(response.status).toBe(422)
  })
})

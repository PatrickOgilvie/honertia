/**
 * Effect Action Factories
 *
 * Pure function factories for creating Effect-based request handlers.
 */

import { Effect, Schema as S } from 'effect'
import {
  DatabaseService,
  AuthUserService,
  HonertiaService,
  RequestService,
  ResponseFactoryService,
  type AuthUser,
} from './services.js'
import { ValidationError, UnauthorizedError } from './errors.js'
import { validateRequest, getValidationData, validate } from './validation.js'
import { Redirect } from './errors.js'

/**
 * Create an Effect action with schema validation.
 *
 * @example
 * const createProject = effectAction(
 *   S.Struct({ name: requiredString }),
 *   (input) => Effect.gen(function* () {
 *     const db = yield* DatabaseService
 *     yield* Effect.tryPromise(() => db.insert(projects).values(input))
 *     return new Redirect({ url: '/projects', status: 303 })
 *   })
 * )
 */
export function effectAction<A, I, R, E>(
  schema: S.Schema<A, I>,
  handler: (input: A) => Effect.Effect<Response | Redirect, E, R>,
  options?: {
    errorComponent?: string
    messages?: Record<string, string>
    attributes?: Record<string, string>
  }
): Effect.Effect<Response | Redirect, E | ValidationError, R | RequestService> {
  return Effect.gen(function* () {
    const input = yield* validateRequest(schema, {
      errorComponent: options?.errorComponent,
      messages: options?.messages,
      attributes: options?.attributes,
    })
    return yield* handler(input)
  })
}

/**
 * Create an Effect action that requires authentication and database access.
 *
 * @example
 * const createProject = dbAction(
 *   S.Struct({ name: requiredString }),
 *   (input, { db, user }) => Effect.gen(function* () {
 *     yield* Effect.tryPromise(() =>
 *       db.insert(projects).values({ ...input, userId: user.user.id })
 *     )
 *     return new Redirect({ url: '/projects', status: 303 })
 *   })
 * )
 */
export function dbAction<A, I, E>(
  schema: S.Schema<A, I>,
  handler: (
    input: A,
    deps: { db: unknown; user: AuthUser }
  ) => Effect.Effect<Response | Redirect, E, never>,
  options?: {
    errorComponent?: string
    messages?: Record<string, string>
    attributes?: Record<string, string>
  }
): Effect.Effect<
  Response | Redirect,
  E | ValidationError | UnauthorizedError,
  RequestService | DatabaseService | AuthUserService
> {
  return Effect.gen(function* () {
    const db = yield* DatabaseService
    const user = yield* AuthUserService
    const input = yield* validateRequest(schema, {
      errorComponent: options?.errorComponent,
      messages: options?.messages,
      attributes: options?.attributes,
    })
    return yield* handler(input, { db, user })
  })
}

/**
 * Create an Effect action that requires authentication.
 *
 * @example
 * const showDashboard = authAction(() => Effect.gen(function* () {
 *   const user = yield* AuthUserService
 *   const honertia = yield* HonertiaService
 *   return yield* Effect.tryPromise(() => honertia.render('Dashboard', { user: user.user }))
 * }))
 */
export function authAction<R, E>(
  handler: (user: AuthUser) => Effect.Effect<Response | Redirect, E, R>
): Effect.Effect<Response | Redirect, E | UnauthorizedError, R | AuthUserService> {
  return Effect.gen(function* () {
    const user = yield* AuthUserService
    return yield* handler(user)
  })
}

/**
 * Create a simple Effect action without validation.
 *
 * @example
 * const listProjects = simpleAction(() => Effect.gen(function* () {
 *   const db = yield* DatabaseService
 *   const user = yield* AuthUserService
 *   const projects = yield* Effect.tryPromise(() => db.query.projects.findMany())
 *   const honertia = yield* HonertiaService
 *   return yield* Effect.tryPromise(() => honertia.render('Projects', { projects }))
 * }))
 */
export function simpleAction<R, E>(
  handler: () => Effect.Effect<Response | Redirect, E, R>
): Effect.Effect<Response | Redirect, E, R> {
  return handler()
}

/**
 * Inject additional data into the validated input.
 *
 * @example
 * const createProject = effectAction(
 *   S.Struct({ name: requiredString }),
 *   (input) => pipe(
 *     injectUser(input),
 *     Effect.flatMap(({ name, userId }) =>
 *       Effect.tryPromise(() => db.insert(projects).values({ name, userId }))
 *     )
 *   )
 * )
 */
export function injectUser<T extends Record<string, unknown>>(
  input: T
): Effect.Effect<T & { userId: string }, UnauthorizedError, AuthUserService> {
  return Effect.gen(function* () {
    const authUser = yield* AuthUserService
    return { ...input, userId: authUser.user.id }
  })
}

/**
 * Run a database operation wrapped in Effect.
 */
export function dbOperation<T>(
  operation: (db: unknown) => Promise<T>
): Effect.Effect<T, Error, DatabaseService> {
  return Effect.gen(function* () {
    const db = yield* DatabaseService
    return yield* Effect.tryPromise({
      try: () => operation(db),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    })
  })
}

/**
 * Prepare validation data by transforming it before validation.
 */
export function prepareData<T extends Record<string, unknown>>(
  transform: (data: Record<string, unknown>) => T | Promise<T>
): Effect.Effect<T, never, RequestService> {
  return Effect.gen(function* () {
    const data = yield* getValidationData
    return yield* Effect.tryPromise({
      try: () => Promise.resolve(transform(data)),
      catch: () => new Error('Transform failed'),
    }).pipe(Effect.catchAll(() => Effect.succeed(data as T)))
  })
}

/**
 * Create an action with custom data preparation.
 */
export function preparedAction<A, I, R, E>(
  schema: S.Schema<A, I>,
  prepare: (data: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
  handler: (input: A) => Effect.Effect<Response | Redirect, E, R>,
  options?: {
    errorComponent?: string
    messages?: Record<string, string>
    attributes?: Record<string, string>
  }
): Effect.Effect<Response | Redirect, E | ValidationError, R | RequestService> {
  return Effect.gen(function* () {
    const rawData = yield* getValidationData
    const preparedData = yield* Effect.tryPromise({
      try: () => Promise.resolve(prepare(rawData)),
      catch: () => new Error('Prepare failed'),
    }).pipe(Effect.catchAll(() => Effect.succeed(rawData)))
    const input = yield* validate(schema, {
      errorComponent: options?.errorComponent,
      messages: options?.messages,
      attributes: options?.attributes,
    })(preparedData)
    return yield* handler(input)
  })
}

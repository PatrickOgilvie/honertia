/**
 * Effect Action Composables
 *
 * Composable helpers for building Effect-based request handlers.
 * Actions are fully opt-in - yield* only what you need.
 */

import { Effect, Option } from 'effect'
import {
  DatabaseService,
  AuthUserService,
  type AuthUser,
} from './services.js'
import { UnauthorizedError, ForbiddenError, Redirect } from './errors.js'

/**
 * Semantic wrapper for Effect actions.
 *
 * This is a minimal wrapper that marks an Effect as an action.
 * All capabilities are opt-in via yield* inside your handler.
 *
 * @example
 * const createProject = action(
 *   Effect.gen(function* () {
 *     // Opt-in to authorization
 *     const auth = yield* authorize()
 *
 *     // Opt-in to validation
 *     const input = yield* validateRequest(S.Struct({ name: requiredString }))
 *
 *     // Opt-in to database
 *     const db = yield* DatabaseService
 *
 *     yield* Effect.tryPromise(() =>
 *       db.insert(projects).values({ ...input, userId: auth.user.id })
 *     )
 *     return new Redirect({ url: '/projects', status: 303 })
 *   })
 * )
 */
export function action<R, E>(
  handler: Effect.Effect<Response | Redirect, E, R>
): Effect.Effect<Response | Redirect, E, R> {
  return handler
}

/**
 * Authorization helper - opt-in to auth check.
 *
 * Returns the authenticated user if authorized.
 * Fails with UnauthorizedError if no user is present.
 * Fails with ForbiddenError if the check returns false.
 * The check function is optional - if not provided, just requires authentication.
 *
 * @example
 * // Just require authentication
 * const auth = yield* authorize()
 *
 * // Require specific role (if your user type has a role field)
 * const auth = yield* authorize((a) => a.user.role === 'admin')
 *
 * // Require resource ownership
 * const auth = yield* authorize((a) => a.user.id === project.userId)
 */
export function authorize(
  check?: (user: AuthUser) => boolean
): Effect.Effect<AuthUser, UnauthorizedError | ForbiddenError, never> {
  return Effect.gen(function* () {
    const maybeUser = yield* Effect.serviceOption(AuthUserService)
    if (Option.isNone(maybeUser)) {
      return yield* Effect.fail(
        new UnauthorizedError({
          message: 'Authentication required',
          redirectTo: '/login',
        })
      )
    }

    const user = maybeUser.value
    if (check && !check(user)) {
      return yield* Effect.fail(
        new ForbiddenError({ message: 'Not authorized' })
      )
    }
    return user
  })
}

/**
 * Run multiple database operations in a transaction.
 * Automatically rolls back on any failure.
 *
 * @example
 * yield* dbTransaction(async (tx) => {
 *   await tx.insert(users).values({ name: 'Alice' })
 *   await tx.update(accounts).set({ balance: 100 }).where(eq(accounts.userId, id))
 *   return { success: true }
 * })
 */
export function dbTransaction<T>(
  operations: (tx: unknown) => Promise<T>
): Effect.Effect<T, Error, DatabaseService> {
  return Effect.gen(function* () {
    const db = yield* DatabaseService
    return yield* Effect.tryPromise({
      try: (): Promise<T> => (db as any).transaction(operations),
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    })
  })
}

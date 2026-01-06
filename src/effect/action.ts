/**
 * Effect Action Composables
 *
 * Composable helpers for building Effect-based request handlers.
 * Actions are fully opt-in - yield* only what you need.
 */

import { Effect, Option } from 'effect'
import {
  AuthUserService,
  type AuthUser,
} from './services.js'
import { UnauthorizedError, ForbiddenError, Redirect } from './errors.js'
import { type Validated, type Trusted } from './validation.js'

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
 *     yield* dbMutation(db, input, (db, input) =>
 *       db.insert(projects).values(asTrusted({ ...input, userId: auth.user.id }))
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
 * Run a database mutation with a safe wrapper.
 * Writes only accept validated or trusted inputs for insert/update/execute params.
 *
 * @example
 * const input = yield* validateRequest(CreateProjectSchema)
 * const db = yield* DatabaseService
 * yield* dbMutation(db, async (db) => {
 *   await db.insert(projects).values(asTrusted({ ...input, userId: auth.user.id }))
 * })
 */
export function dbMutation<DB, T>(
  db: DB,
  operation: (db: SafeTx<DB>) => Promise<T>
): Effect.Effect<T, Error> {
  return Effect.tryPromise({
    try: (): Promise<T> => operation(db as SafeTx<DB>),
    catch: (error) => error instanceof Error ? error : new Error(String(error)),
  })
}

type SafeInput<A> = Validated<A> | Trusted<A>

type SafeValues<V> =
  V extends Array<infer E>
    ? Array<SafeInput<E>> | SafeInput<E> | SafeInput<V>
    : V extends ReadonlyArray<infer E>
      ? ReadonlyArray<SafeInput<E>> | SafeInput<E> | SafeInput<V>
      : SafeInput<V>

type SafeParam<P> =
  P extends ReadonlyArray<any>
    ? SafeValues<P>
    : P extends Array<any>
      ? SafeValues<P>
      : P extends Record<string, unknown>
        ? SafeInput<P>
        : P

type WrapExecuteArgs<A extends unknown[]> =
  A extends [infer Q, infer P, ...infer Rest]
    ? [Q, SafeParam<P>, ...Rest]
    : A

type WrapSecondArg<A extends unknown[]> =
  A extends [infer First, infer Second, ...infer Rest]
    ? [First, SafeParam<Second>, ...Rest]
    : A

type WrapMethod<I, K extends string> =
  I extends Record<K, (...args: infer A) => infer R>
    ? Omit<I, K> & { [P in K]: (...args: WrapExecuteArgs<A>) => R }
    : I

type WrapBuilder<I> = WrapMethod<WrapMethod<WrapMethod<I, 'execute'>, 'run'>, 'query'>

type WrapValues<I> = I extends { values: (values: infer V) => infer R }
  ? WrapBuilder<Omit<I, 'values'> & { values: (values: SafeValues<V>) => R }>
  : WrapBuilder<I>

type WrapSet<I> = I extends { set: (values: infer V) => infer R }
  ? WrapBuilder<Omit<I, 'set'> & { set: (values: SafeValues<V>) => R }>
  : WrapBuilder<I>

type SafeInsert<Tx> = Tx extends { insert: (...args: infer A) => infer I }
  ? Omit<Tx, 'insert'> & { insert: (...args: WrapSecondArg<A>) => WrapValues<I> }
  : Tx

type SafeUpdate<Tx> = Tx extends { update: (...args: infer A) => infer I }
  ? Omit<Tx, 'update'> & { update: (...args: WrapSecondArg<A>) => WrapSet<I> }
  : Tx

type SafeDelete<Tx> = Tx extends { delete: (...args: infer A) => infer I }
  ? Omit<Tx, 'delete'> & { delete: (...args: WrapSecondArg<A>) => WrapBuilder<I> }
  : Tx

export type SafeTx<Tx> = WrapBuilder<SafeDelete<SafeUpdate<SafeInsert<Tx>>>>

type TransactionClient<DB> =
  DB extends { transaction: (fn: (tx: infer Tx) => Promise<any>) => Promise<any> }
    ? Tx
    : never

/**
 * Run multiple database operations in a transaction.
 * Automatically rolls back on any failure.
 *
 * The transaction client is wrapped as `SafeTx` so writes only accept
 * validated or trusted inputs for insert/update/execute params.
 *
 * @example
 * const input = yield* validateRequest(CreateUserSchema)
 * const balanceUpdate = asTrusted({ balance: 100 })
 * const db = yield* DatabaseService
 * yield* dbTransaction(db, async (tx) => {
 *   await tx.insert(users).values(input)
 *   await tx.update(accounts).set(balanceUpdate).where(eq(accounts.userId, id))
 *   return { success: true }
 * })
 */
export function dbTransaction<
  DB extends { transaction: (fn: (tx: any) => Promise<any>) => Promise<any> },
  T
>(
  db: DB,
  operations: (tx: SafeTx<TransactionClient<DB>>) => Promise<T>
): Effect.Effect<T, Error> {
  return Effect.tryPromise({
    try: (): Promise<T> => db.transaction((tx) =>
      operations(tx as SafeTx<TransactionClient<DB>>)
    ),
    catch: (error) => error instanceof Error ? error : new Error(String(error)),
  })
}

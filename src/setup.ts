/**
 * Honertia Setup
 *
 * Provides a single setup function that configures all Honertia middleware.
 * This is the recommended way to set up Honertia in your Hono app.
 */

import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler, Env, Context } from 'hono'
import { honertia } from './middleware.js'
import type { HonertiaConfig } from './types.js'
import { loadUser, shareAuthMiddleware } from './effect/auth.js'
import { effectBridge, type EffectBridgeConfig } from './effect/bridge.js'

/**
 * Extended Honertia configuration with database, auth, and schema.
 */
export interface HonertiaFullConfig<E extends Env = Env> extends HonertiaConfig {
  /**
   * Database factory function.
   * Creates the database client for each request.
   *
   * @example
   * ```typescript
   * database: (c) => createDb(c.env.DATABASE_URL)
   * ```
   */
  database?: (c: Context<E>) => unknown

  /**
   * Auth factory function.
   * Creates the auth client for each request.
   * Receives context with `c.var.db` already set (if database is configured).
   *
   * @example
   * ```typescript
   * auth: (c) => createAuth({
   *   db: c.var.db,
   *   secret: c.env.BETTER_AUTH_SECRET,
   *   baseURL: new URL(c.req.url).origin,
   * })
   * ```
   */
  auth?: (c: Context<E>) => unknown

  /**
   * Drizzle schema for route model binding.
   * Required if using Laravel-style route model binding.
   *
   * @example
   * ```typescript
   * import * as schema from '~/db/schema'
   *
   * setupHonertia({
   *   honertia: { version, render, schema }
   * })
   * ```
   */
  schema?: Record<string, unknown>
}

/**
 * Configuration for Honertia setup.
 */
export interface HonertiaSetupConfig<E extends Env = Env, CustomServices = never> {
  /**
   * Honertia core configuration including database, auth, and schema.
   */
  honertia: HonertiaFullConfig<E>

  /**
   * Effect bridge configuration (optional).
   * Only needed for custom Effect services.
   */
  effect?: EffectBridgeConfig<E, CustomServices>

  /**
   * Auth loading configuration (optional).
   * Controls how the authenticated user is loaded from the session.
   */
  auth?: {
    userKey?: string
    sessionCookie?: string
  }

  /**
   * Additional middleware to run after core Honertia setup.
   * These run in order after effectBridge.
   */
  middleware?: MiddlewareHandler<E>[]
}

/**
 * Sets up all Honertia middleware in the correct order.
 *
 * This bundles:
 * - Database and auth setup (sets `c.var.db` and `c.var.auth`)
 * - `honertia()` - Core Honertia middleware
 * - `loadUser()` - Loads authenticated user into context
 * - `shareAuthMiddleware()` - Shares auth state with pages
 * - `effectBridge()` - Sets up Effect runtime for each request
 *
 * @example
 * ```ts
 * import { setupHonertia, createTemplate } from 'honertia'
 * import * as schema from '~/db/schema'
 *
 * app.use('*', setupHonertia({
 *   honertia: {
 *     version: '1.0.0',
 *     render: createTemplate({ title: 'My App', scripts: [...] }),
 *     database: (c) => createDb(c.env.DATABASE_URL),
 *     auth: (c) => createAuth({
 *       db: c.var.db,
 *       secret: c.env.BETTER_AUTH_SECRET,
 *       baseURL: new URL(c.req.url).origin,
 *     }),
 *     schema,
 *   },
 * }))
 * ```
 */
export function setupHonertia<E extends Env, CustomServices = never>(
  config: HonertiaSetupConfig<E, CustomServices>
): MiddlewareHandler<E> {
  const { database, auth, schema, ...honertiaConfig } = config.honertia

  // Middleware to set up db and auth on c.var
  const setupServices: MiddlewareHandler<E> = createMiddleware<E>(async (c, next) => {
    // Set up database first (auth may depend on it)
    if (database) {
      c.set('db' as any, database(c))
    }

    // Set up auth (can access c.var.db)
    if (auth) {
      c.set('auth' as any, auth(c))
    }

    await next()
  })

  // Build effect bridge config, passing schema from honertia config
  const effectConfig: EffectBridgeConfig<E, CustomServices> = {
    ...config.effect,
    schema,
  }

  const middlewares: MiddlewareHandler<E>[] = [
    setupServices,
    honertia(honertiaConfig),
    loadUser<E>(config.auth),
    shareAuthMiddleware<E>(),
    effectBridge<E, CustomServices>(effectConfig),
    ...(config.middleware ?? []),
  ]

  return createMiddleware<E>(async (c, next) => {
    const dispatch = async (i: number): Promise<void> => {
      if (i >= middlewares.length) {
        await next()
        return
      }
      await middlewares[i](c, () => dispatch(i + 1))
    }
    await dispatch(0)
  })
}

/**
 * Error handler configuration.
 */
export interface ErrorHandlerConfig {
  /**
   * Component to render for errors.
   * @default 'Error'
   */
  component?: string

  /**
   * Whether to show detailed error messages in development.
   * @default true
   */
  showDevErrors?: boolean

  /**
   * Environment variable key to check for development mode.
   * @default 'ENVIRONMENT'
   */
  envKey?: string

  /**
   * Value that indicates development mode.
   * @default 'development'
   */
  devValue?: string
}

/**
 * Creates error handlers for Hono apps using Honertia.
 *
 * Returns an object with `notFound` and `onError` handlers
 * that you can pass to app.notFound() and app.onError().
 *
 * @example
 * ```ts
 * const { notFound, onError } = createErrorHandlers()
 * app.notFound(notFound)
 * app.onError(onError)
 * ```
 */
export function createErrorHandlers<E extends Env>(config: ErrorHandlerConfig = {}) {
  const {
    component = 'Error',
    showDevErrors = true,
    envKey = 'ENVIRONMENT',
    devValue = 'development',
  } = config

  const notFound = (c: Context<E>) => {
    return c.var.honertia.render(component, {
      status: 404,
      message: 'Page not found',
    })
  }

  const onError = (err: Error, c: Context<E>) => {
    console.error(err)
    const isDev = showDevErrors && (c.env as any)?.[envKey] === devValue
    const status = (err as any).status ?? 500
    const hint = isDev ? (err as any).hint : undefined
    return c.var.honertia.render(component, {
      status,
      message: isDev ? err.message : 'Something went wrong',
      ...(hint && { hint }),
    })
  }

  return { notFound, onError }
}

/**
 * Registers error handlers on a Hono app.
 *
 * @example
 * ```ts
 * import { registerErrorHandlers } from 'honertia'
 *
 * registerErrorHandlers(app)
 * ```
 */
export function registerErrorHandlers<E extends Env>(
  app: { notFound: (handler: any) => void; onError: (handler: any) => void },
  config: ErrorHandlerConfig = {}
): void {
  const { notFound, onError } = createErrorHandlers<E>(config)
  app.notFound(notFound)
  app.onError(onError)
}

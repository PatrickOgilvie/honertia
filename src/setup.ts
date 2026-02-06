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
import { getStructuredFromThrown } from './effect/handler.js'
import { toStructuredError } from './effect/errors.js'
import { captureErrorContext } from './effect/error-context.js'
import {
  detectOutputFormat,
  JsonErrorFormatter,
  TerminalErrorFormatter,
  InertiaErrorFormatter,
} from './effect/error-formatter.js'
import { createStructuredError, ErrorCodes } from './effect/error-catalog.js'

/**
 * Extended Honertia configuration with database, auth, and schema.
 *
 * @typeParam E - Hono environment type
 * @typeParam DB - Database client type (inferred from database factory return type)
 * @typeParam Auth - Auth client type (inferred from auth factory return type)
 */
export interface HonertiaFullConfig<E extends Env = Env, DB = unknown, Auth = unknown>
  extends HonertiaConfig {
  /**
   * Database factory function.
   * Creates the database client for each request.
   *
   * @example
   * ```typescript
   * database: (c) => createDb(c.env.DATABASE_URL)
   * ```
   */
  database?: (c: Context<E>) => DB

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
  auth?: (c: Context<E & { Variables: { db: DB } }>) => Auth

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
 *
 * @typeParam E - Hono environment type
 * @typeParam DB - Database client type (inferred from database factory)
 * @typeParam Auth - Auth client type (inferred from auth factory)
 * @typeParam CustomServices - Custom Effect services
 */
export interface HonertiaSetupConfig<
  E extends Env = Env,
  DB = unknown,
  Auth = unknown,
  CustomServices = never,
> {
  /**
   * Honertia core configuration including database, auth, and schema.
   */
  honertia: HonertiaFullConfig<E, DB, Auth>

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
export function setupHonertia<
  E extends Env,
  DB = unknown,
  Auth = unknown,
  CustomServices = never,
>(config: HonertiaSetupConfig<E, DB, Auth, CustomServices>): MiddlewareHandler<E> {
  const { database, auth, schema, ...honertiaConfig } = config.honertia

  // Middleware to set up db and auth on c.var
  const setupServices: MiddlewareHandler<E> = createMiddleware<E>(async (c, next) => {
    // Set up database first (auth may depend on it)
    if (database) {
      c.set('db' as any, database(c))
    }

    // Set up auth (can access c.var.db since database middleware ran first)
    if (auth) {
      // Cast c to include db in Variables since we just set it above
      c.set('auth' as any, auth(c as Context<E & { Variables: { db: DB } }>))
    }

    await next()
  })

  // Build effect bridge config, passing schema from honertia config
  const effectConfig: EffectBridgeConfig<E, CustomServices> = {
    ...config.effect,
    authUserKey: config.auth?.userKey ?? config.effect?.authUserKey,
    schema: schema ?? config.effect?.schema,
  }

  const middlewares: MiddlewareHandler<E>[] = [
    setupServices,
    honertia(honertiaConfig),
    loadUser<E>(config.auth),
    shareAuthMiddleware<E>(config.auth),
    effectBridge<E, CustomServices>(effectConfig),
    ...(config.middleware ?? []),
  ]

  return createMiddleware<E>(async (c, next) => {
    const dispatch = async (i: number): Promise<Response | void> => {
      if (i >= middlewares.length) {
        await next()
        // Return response for proper propagation in forwarding/proxy scenarios
        return c.res
      }
      // Call middleware and capture result (following Hono's compose pattern)
      const res = await middlewares[i](c, async () => {
        await dispatch(i + 1)
      })
      // If middleware returned a Response and context isn't finalized, set c.res
      if (res && !c.finalized) {
        c.res = res
      }
    }
    await dispatch(0)

    // Return the response to ensure proper propagation in forwarding/proxy scenarios
    return c.res
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

  // Memoized formatter instances for dev and production modes
  const formatters = {
    dev: {
      json: new JsonErrorFormatter({
        pretty: true,
        includeSource: true,
        includeContext: true,
        includeFixes: true,
      }),
      terminal: new TerminalErrorFormatter({
        useColors: true,
        showSnippet: true,
        showFixes: true,
      }),
      inertia: new InertiaErrorFormatter({ isDev: true, includeFixes: true }),
    },
    prod: {
      json: new JsonErrorFormatter({
        pretty: false,
        includeSource: false,
        includeContext: false,
        includeFixes: true,
      }),
      inertia: new InertiaErrorFormatter({ isDev: false, includeFixes: false }),
    },
  }

  const getFormatters = (isDev: boolean) => (isDev ? formatters.dev : formatters.prod)

  const notFound = (c: Context<E>) => {
    const isDev = showDevErrors && (c.env as any)?.[envKey] === devValue
    const context = captureErrorContext(c)
    const format = detectOutputFormat(
      {
        header: (name: string) => c.req.header(name),
        method: c.req.method,
        url: c.req.url,
      },
      (c.env ?? {}) as Record<string, unknown>
    )

    // Create structured not found error
    const structured = createStructuredError(
      ErrorCodes.RES_200_NOT_FOUND,
      { resource: 'page' },
      context
    )

    const fmt = getFormatters(isDev)

    // JSON response for API/AI requests
    if (format === 'json') {
      return c.json(fmt.json.format(structured), 404)
    }

    // Render Inertia error component (if honertia middleware has run)
    if (c.var.honertia?.render) {
      return c.var.honertia.render(component, fmt.inertia.format(structured) as Record<string, unknown>)
    }

    // Fallback: return JSON if honertia isn't available
    return c.json(fmt.json.format(structured), 404)
  }

  const onError = (err: Error, c: Context<E>) => {
    const isDev = showDevErrors && (c.env as any)?.[envKey] === devValue
    const context = captureErrorContext(c)
    const format = detectOutputFormat(
      {
        header: (name: string) => c.req.header(name),
        method: c.req.method,
        url: c.req.url,
      },
      (c.env ?? {}) as Record<string, unknown>
    )

    // Get structured error (may have been attached by handler.ts)
    let structured = getStructuredFromThrown(err)
    if (!structured) {
      // Convert the error to structured format
      structured = toStructuredError(err, context)
    }

    const fmt = getFormatters(isDev)

    // Log in terminal format for development (suppress during tests)
    const isTest = (typeof Bun !== 'undefined' && Bun.env?.NODE_ENV === 'test')
    if (!isTest) {
      if (isDev) {
        console.error(formatters.dev.terminal.format(structured))
      } else {
        console.error(err)
      }
    }

    // JSON response for API/AI requests
    if (format === 'json') {
      return c.json(fmt.json.format(structured), structured.httpStatus as any)
    }

    // Render Inertia error component (if honertia middleware has run)
    if (c.var.honertia?.render) {
      return c.var.honertia.render(component, fmt.inertia.format(structured) as Record<string, unknown>)
    }

    // Fallback: return JSON if honertia isn't available
    return c.json(fmt.json.format(structured), structured.httpStatus as any)
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

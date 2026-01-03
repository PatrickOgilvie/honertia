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
 * Configuration for Honertia setup.
 */
export interface HonertiaSetupConfig<E extends Env = Env> {
  /**
   * Honertia core configuration.
   */
  honertia: HonertiaConfig

  /**
   * Effect bridge configuration (optional).
   */
  effect?: EffectBridgeConfig<E>

  /**
   * Auth configuration (optional).
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
 * - `honertia()` - Core Honertia middleware
 * - `loadUser()` - Loads authenticated user into context
 * - `shareAuthMiddleware()` - Shares auth state with pages
 * - `effectBridge()` - Sets up Effect runtime for each request
 *
 * @example
 * ```ts
 * import { setupHonertia, createTemplate } from 'honertia'
 *
 * app.use('*', setupHonertia({
 *   honertia: {
 *     version: '1.0.0',
 *     render: createTemplate({ title: 'My App', scripts: [...] }),
 *   },
 * }))
 * ```
 */
export function setupHonertia<E extends Env>(
  config: HonertiaSetupConfig<E>
): MiddlewareHandler<E> {
  const middlewares: MiddlewareHandler<E>[] = [
    honertia(config.honertia),
    loadUser<E>(config.auth),
    shareAuthMiddleware<E>(),
    effectBridge<E>(config.effect),
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
    return c.var.honertia.render(component, {
      status: 500,
      message: isDev ? err.message : 'Something went wrong',
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

/**
 * Effect Auth Layers and Helpers
 *
 * Authentication and authorization via Effect Layers.
 */

import { Effect, Layer, Option } from 'effect'
import type { Hono, MiddlewareHandler, Env } from 'hono'
import { AuthUserService, AuthService, HonertiaService, RequestService, type AuthUser } from './services.js'
import { UnauthorizedError } from './errors.js'
import { effectRoutes, type EffectRouteBuilder } from './routing.js'
import { render, redirect } from './responses.js'

/**
 * Layer that requires an authenticated user.
 * Fails with UnauthorizedError if no user is present.
 *
 * @example
 * effectRoutes(app)
 *   .provide(RequireAuthLayer)
 *   .get('/dashboard', showDashboard)
 */
export const RequireAuthLayer = Layer.effect(
  AuthUserService,
  Effect.gen(function* () {
    // Try to get existing AuthUserService
    const maybeUser = yield* Effect.serviceOption(AuthUserService)

    if (Option.isNone(maybeUser)) {
      return yield* Effect.fail(
        new UnauthorizedError({
          message: 'Authentication required',
          redirectTo: '/login',
        })
      )
    }

    return maybeUser.value
  })
)

/**
 * Layer that requires no authenticated user (guest only).
 * Fails if a user is present, succeeds (as a no-op) if no user.
 *
 * @example
 * effectRoutes(app)
 *   .provide(RequireGuestLayer)
 *   .get('/login', showLogin)
 */
export const RequireGuestLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const maybeUser = yield* Effect.serviceOption(AuthUserService)

    if (Option.isSome(maybeUser)) {
      return yield* Effect.fail(
        new UnauthorizedError({
          message: 'Already authenticated',
          redirectTo: '/',
        })
      )
    }

    // Guest confirmed - no user present, succeed silently
  })
)

/**
 * Check if user is authenticated without failing.
 */
export const isAuthenticated: Effect.Effect<boolean, never, never> =
  Effect.serviceOption(AuthUserService).pipe(Effect.map(Option.isSome))

/**
 * Get the current user if authenticated.
 */
export const currentUser: Effect.Effect<AuthUser | null, never, never> =
  Effect.serviceOption(AuthUserService).pipe(
    Effect.map((option) => (Option.isSome(option) ? option.value : null))
  )

/**
 * Require authentication or redirect.
 */
export const requireAuth = (
  redirectTo = '/login'
): Effect.Effect<AuthUser, UnauthorizedError, never> =>
  Effect.serviceOption(AuthUserService).pipe(
    Effect.flatMap((option) => {
      if (Option.isNone(option)) {
        return Effect.fail(new UnauthorizedError({ message: 'Unauthenticated', redirectTo }))
      }
      return Effect.succeed(option.value)
    })
  )

/**
 * Require guest status or redirect.
 */
export const requireGuest = (
  redirectTo = '/'
): Effect.Effect<void, UnauthorizedError, never> =>
  Effect.serviceOption(AuthUserService).pipe(
    Effect.flatMap((option) => {
      if (Option.isSome(option)) {
        return Effect.fail(new UnauthorizedError({ message: 'Already authenticated', redirectTo }))
      }
      return Effect.void
    })
  )

/**
 * Share auth state with Honertia.
 */
export const shareAuth: Effect.Effect<void, never, HonertiaService> =
  Effect.gen(function* () {
    const honertia = yield* HonertiaService
    const user = yield* currentUser
    honertia.share('auth', { user: user?.user ?? null })
  })

/**
 * Middleware version of shareAuth for use with app.use().
 */
export function shareAuthMiddleware<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    const honertia = (c as any).var?.honertia
    const authUser = (c as any).var?.authUser
    if (honertia) {
      honertia.share('auth', { user: authUser?.user ?? null })
    }
    await next()
  }
}

/**
 * Configuration for auth routes.
 */
export interface AuthRoutesConfig<E extends Env> {
  loginPath?: string
  registerPath?: string
  logoutPath?: string
  apiPath?: string
  logoutRedirect?: string
  loginRedirect?: string
  loginComponent?: string
  registerComponent?: string
  sessionCookie?: string
  /**
   * CORS configuration for auth API routes.
   * If provided, adds CORS headers to `/api/auth/*` routes.
   */
  cors?: {
    origin: string | string[] | ((origin: string) => string | undefined | null)
    credentials?: boolean
  }
}

/**
 * Register standard auth routes.
 *
 * @example
 * effectAuthRoutes(app, {
 *   loginComponent: 'Auth/Login',
 *   registerComponent: 'Auth/Register',
 * })
 */
export function effectAuthRoutes<E extends Env>(
  app: Hono<E>,
  config: AuthRoutesConfig<E> = {}
): void {
  const {
    loginPath = '/login',
    registerPath = '/register',
    logoutPath = '/logout',
    apiPath = '/api/auth',
    logoutRedirect = '/login',
    loginComponent = 'Auth/Login',
    registerComponent = 'Auth/Register',
  } = config

  const routes = effectRoutes(app)

  // Login page (guest only)
  routes.get(
    loginPath,
    Effect.gen(function* () {
      yield* requireGuest(loginPath === '/login' ? '/' : loginPath)
      return yield* render(loginComponent)
    })
  )

  // Register page (guest only)
  routes.get(
    registerPath,
    Effect.gen(function* () {
      yield* requireGuest(registerPath === '/register' ? '/' : registerPath)
      return yield* render(registerComponent)
    })
  )

  // Logout (POST)
  routes.post(
    logoutPath,
    Effect.gen(function* () {
      const auth = yield* AuthService
      const request = yield* RequestService

      // Revoke session server-side
      yield* Effect.tryPromise(() =>
        (auth as any).api.signOut({
          headers: request.headers,
        })
      )

      // Clear cookie and redirect
      const sessionCookie = config.sessionCookie ?? 'better-auth.session_token'
      return new Response(null, {
        status: 303,
        headers: {
          'Location': logoutRedirect,
          'Set-Cookie': `${sessionCookie}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`,
        },
      })
    })
  )

  // Better-auth API handler (handles sign-in, sign-up, etc.)
  // Apply CORS if configured
  if (config.cors) {
    const corsConfig = config.cors
    app.use(`${apiPath}/*`, async (c, next) => {
      const origin = c.req.header('Origin')
      
      // Determine allowed origin
      let allowedOrigin: string | null = null
      if (typeof corsConfig.origin === 'function') {
        allowedOrigin = origin ? corsConfig.origin(origin) ?? null : null
      } else if (Array.isArray(corsConfig.origin)) {
        allowedOrigin = origin && corsConfig.origin.includes(origin) ? origin : null
      } else {
        allowedOrigin = corsConfig.origin
      }

      if (allowedOrigin) {
        c.header('Access-Control-Allow-Origin', allowedOrigin)
        if (corsConfig.credentials) {
          c.header('Access-Control-Allow-Credentials', 'true')
        }
      }

      // Handle preflight
      if (c.req.method === 'OPTIONS') {
        c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        c.header('Access-Control-Max-Age', '86400')
        return c.body(null, 204)
      }

      await next()
    })
  }

  app.all(`${apiPath}/*`, async (c) => {
    const auth = (c as any).var?.auth
    if (!auth) {
      return c.json({ error: 'Auth not configured' }, 500)
    }
    return auth.handler(c.req.raw)
  })
}

/**
 * Middleware to load the authenticated user.
 * This should be used early in the middleware chain.
 */
export function loadUser<E extends Env>(
  config: {
    userKey?: string
    sessionCookie?: string
  } = {}
): MiddlewareHandler<E> {
  const { userKey = 'authUser' } = config

  return async (c, next) => {
    const auth = (c as any).var?.auth
    if (!auth) {
      await next()
      return
    }

    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
      if (session) {
        c.set(userKey as any, {
          user: session.user,
          session: session.session,
        })
      }
    } catch {
      // Session fetch failed, continue without user
    }

    await next()
  }
}

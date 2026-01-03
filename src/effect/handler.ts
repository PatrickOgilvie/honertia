/**
 * Effect Handler
 *
 * Wraps Effect computations into Hono handlers.
 */

import { Effect, Exit, Cause, ManagedRuntime } from 'effect'
import type { Context as HonoContext, MiddlewareHandler, Env } from 'hono'
import { getEffectRuntime, buildContextLayer } from './bridge.js'
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  HttpError,
  Redirect,
  type AppError,
} from './errors.js'
import { HonertiaService } from './services.js'

/**
 * Convert an Effect error to an HTTP response.
 */
export async function errorToResponse<E extends Env>(
  error: AppError,
  c: HonoContext<E>
): Promise<Response> {
  if (error instanceof ValidationError) {
    const isInertia = c.req.header('X-Inertia') === 'true'
    const prefersJson =
      c.req.header('Accept')?.includes('application/json') ||
      c.req.header('Content-Type')?.includes('application/json')

    if (prefersJson && !isInertia) {
      return c.json({ errors: error.errors }, 422)
    }

    // For Inertia requests with a component, render the component with errors
    if (error.component && (c as any).var?.honertia) {
      const honertia = (c as any).var.honertia
      honertia.setErrors(error.errors)
      return await honertia.render(error.component)
    }

    // Redirect back with errors
    const referer = c.req.header('Referer') || '/'
    ;(c as any).var?.honertia?.setErrors(error.errors)
    return c.redirect(referer, 303)
  }

  if (error instanceof UnauthorizedError) {
    const isInertia = c.req.header('X-Inertia') === 'true'
    const redirectTo = error.redirectTo ?? '/login'
    return c.redirect(redirectTo, isInertia ? 303 : 302)
  }

  if (error instanceof ForbiddenError) {
    return c.json({ message: error.message }, 403)
  }

  if (error instanceof NotFoundError) {
    return c.notFound() as Response
  }

  if (error instanceof HttpError) {
    return c.json({ message: error.message, ...(error.body as object) }, error.status as any)
  }

  // Unknown error
  console.error('Unhandled error:', error)
  return c.json({ message: 'Internal server error' }, 500)
}

/**
 * Handle a Redirect value (which is not an error).
 */
function handleRedirect<E extends Env>(redirect: Redirect, c: HonoContext<E>): Response {
  return c.redirect(redirect.url, redirect.status)
}

/**
 * Check if a value is a Redirect.
 */
function isRedirect(value: unknown): value is Redirect {
  return value instanceof Redirect
}

/**
 * Wrap an Effect into a Hono handler.
 */
export function effectHandler<E extends Env, R, Err extends AppError>(
  effect: Effect.Effect<Response | Redirect, Err, R>
): MiddlewareHandler<E> {
  return async (c) => {
    const runtime = getEffectRuntime(c)

    if (!runtime) {
      // No runtime set up, create one for this request
      const layer = buildContextLayer(c)
      const tempRuntime = ManagedRuntime.make(layer)

      try {
        const exit = await tempRuntime.runPromiseExit(effect as Effect.Effect<Response | Redirect, AppError, any>)
        return await handleExit(exit, c)
      } finally {
        await tempRuntime.dispose()
      }
    }

    const exit = await runtime.runPromiseExit(effect as Effect.Effect<Response | Redirect, AppError, any>)
    return await handleExit(exit, c)
  }
}

/**
 * Handle an Effect exit value.
 */
async function handleExit<E extends Env>(
  exit: Exit.Exit<Response | Redirect, AppError>,
  c: HonoContext<E>
): Promise<Response> {
  if (Exit.isSuccess(exit)) {
    const value = exit.value
    if (isRedirect(value)) {
      return handleRedirect(value, c)
    }
    return value
  }

  // Handle failure
  const cause = exit.cause

  if (Cause.isFailure(cause)) {
    const error = Cause.failureOption(cause)
    if (error._tag === 'Some') {
      return await errorToResponse(error.value, c)
    }
  }

  // Handle defects (unexpected errors)
  if (Cause.isDie(cause)) {
    const defect = Cause.dieOption(cause)
    if (defect._tag === 'Some') {
      console.error('Effect defect:', defect.value)
    }
  }

  return c.json({ message: 'Internal server error' }, 500)
}

/**
 * Create a handler from a function that returns an Effect.
 */
export function effect<E extends Env, R, Err extends AppError>(
  fn: () => Effect.Effect<Response | Redirect, Err, R>
): MiddlewareHandler<E> {
  return effectHandler(Effect.suspend(fn))
}

/**
 * Create a handler from an Effect directly.
 */
export const handle = effectHandler

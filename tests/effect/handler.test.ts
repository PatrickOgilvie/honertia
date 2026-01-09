/**
 * Effect Handler Tests
 */

import { describe, test, expect } from 'bun:test'
import { Hono } from 'hono'
import { Effect } from 'effect'
import { effectHandler, effect, handle, errorToResponse } from '../../src/effect/handler.js'
import { effectBridge } from '../../src/effect/bridge.js'
import { honertia } from '../../src/middleware.js'
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  HttpError,
  Redirect,
} from '../../src/effect/errors.js'
import { HonertiaService, DatabaseService } from '../../src/effect/services.js'

// Helper to create test app with all middleware
const createApp = () => {
  const app = new Hono()

  app.use(
    '*',
    honertia({
      version: '1.0.0',
      render: (page) => JSON.stringify(page),
    })
  )

  app.use('*', async (c, next) => {
    c.set('db' as any, { name: 'test-db' })
    await next()
  })

  app.use('*', effectBridge())

  return app
}

describe('effectHandler', () => {
  test('handles successful Effect returning Response', async () => {
    const app = createApp()

    app.get(
      '/',
      effectHandler(Effect.succeed(new Response('Hello World')))
    )

    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hello World')
  })

  test('handles Effect returning Redirect', async () => {
    const app = createApp()

    app.get(
      '/',
      effectHandler(
        Effect.succeed(new Redirect({ url: '/dashboard', status: 303 }))
      )
    )

    const res = await app.request('/')
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toBe('/dashboard')
  })

  test('handles Redirect with 302 status', async () => {
    const app = createApp()

    app.get(
      '/',
      effectHandler(
        Effect.succeed(new Redirect({ url: '/login', status: 302 }))
      )
    )

    const res = await app.request('/')
    expect(res.status).toBe(302)
  })

  test('can access services from the runtime', async () => {
    const app = createApp()

    app.get(
      '/',
      effectHandler(
        Effect.gen(function* () {
          const db = yield* DatabaseService
          return new Response(JSON.stringify(db))
        })
      )
    )

    const res = await app.request('/')
    const json = await res.json()
    expect(json).toEqual({ name: 'test-db' })
  })

  test('works without effectBridge middleware', async () => {
    const app = new Hono()

    // No effectBridge, but handler should create temp runtime
    app.get(
      '/',
      effectHandler(Effect.succeed(new Response('Works')))
    )

    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Works')
  })
})

describe('effect helper', () => {
  test('creates handler from function returning Effect', async () => {
    const app = createApp()

    app.get(
      '/',
      effect(() => Effect.succeed(new Response('From function')))
    )

    const res = await app.request('/')
    expect(await res.text()).toBe('From function')
  })

  test('defers Effect creation', async () => {
    let callCount = 0

    const app = createApp()

    app.get(
      '/',
      effect(() => {
        callCount++
        return Effect.succeed(new Response(`Count: ${callCount}`))
      })
    )

    await app.request('/')
    expect(callCount).toBe(1)

    await app.request('/')
    expect(callCount).toBe(2)
  })
})

describe('handle alias', () => {
  test('is an alias for effectHandler', () => {
    expect(handle).toBe(effectHandler)
  })
})

describe('Error Handling', () => {
  describe('ValidationError', () => {
    test('returns JSON 422 for JSON requests', async () => {
      const app = createApp()

      app.post(
        '/',
        effectHandler(
          Effect.fail(
            new ValidationError({
              errors: { name: 'Required', email: 'Invalid' },
            })
          )
        )
      )

      const res = await app.request('/', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })

      expect(res.status).toBe(422)
      const json = await res.json()
      // Structured format includes validation details
      expect(json.code).toMatch(/^HON_VAL_/)
      expect(json.validation.fields.name.message).toBe('Required')
      expect(json.validation.fields.email.message).toBe('Invalid')
    })

    test('renders component with errors for Inertia requests', async () => {
      const app = createApp()

      app.post(
        '/',
        effectHandler(
          Effect.fail(
            new ValidationError({
              errors: { name: 'Required' },
              component: 'Users/Create',
            })
          )
        )
      )

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'X-Inertia': 'true' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.component).toBe('Users/Create')
      expect(json.props.errors).toEqual({ name: 'Required' })
    })

    test('redirects back without component', async () => {
      const app = createApp()

      app.post(
        '/form',
        effectHandler(
          Effect.fail(
            new ValidationError({ errors: { field: 'Error' } })
          )
        )
      )

      const res = await app.request('/form', {
        method: 'POST',
        headers: { Referer: '/form' },
      })

      expect(res.status).toBe(303)
      expect(res.headers.get('Location')).toBe('/form')
    })
  })

  describe('UnauthorizedError', () => {
    test('redirects to login by default', async () => {
      const app = createApp()

      app.get(
        '/',
        effectHandler(
          Effect.fail(
            new UnauthorizedError({ message: 'Login required' })
          )
        )
      )

      const res = await app.request('/')

      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/login')
    })

    test('redirects to custom URL', async () => {
      const app = createApp()

      app.get(
        '/',
        effectHandler(
          Effect.fail(
            new UnauthorizedError({
              message: 'Login required',
              redirectTo: '/signin',
            })
          )
        )
      )

      const res = await app.request('/')
      expect(res.headers.get('Location')).toBe('/signin')
    })

    test('uses 303 for Inertia requests', async () => {
      const app = createApp()

      app.get(
        '/',
        effectHandler(
          Effect.fail(new UnauthorizedError({ message: 'Unauthorized' }))
        )
      )

      const res = await app.request('/', {
        headers: { 'X-Inertia': 'true' },
      })

      expect(res.status).toBe(303)
    })
  })

  describe('ForbiddenError', () => {
    test('returns JSON 403', async () => {
      const app = createApp()

      app.get(
        '/',
        effectHandler(
          Effect.fail(
            new ForbiddenError({ message: 'Access denied' })
          )
        )
      )

      const res = await app.request('/')

      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.message).toBe('Access denied')
    })
  })

  describe('NotFoundError', () => {
    test('returns 404 not found', async () => {
      const app = createApp()

      app.get(
        '/',
        effectHandler(
          Effect.fail(
            new NotFoundError({ resource: 'Project', id: '123' })
          )
        )
      )

      const res = await app.request('/')
      expect(res.status).toBe(404)
    })
  })

  describe('HttpError', () => {
    test('returns custom status and message', async () => {
      const app = createApp()

      app.get(
        '/',
        effectHandler(
          Effect.fail(
            new HttpError({
              status: 429,
              message: 'Rate limited',
            })
          )
        )
      )

      const res = await app.request('/')

      expect(res.status).toBe(429)
      const json = await res.json()
      expect(json.message).toBe('Rate limited')
    })

    test('includes body in response', async () => {
      const app = createApp()

      app.get(
        '/',
        effectHandler(
          Effect.fail(
            new HttpError({
              status: 400,
              message: 'Bad request',
              body: { retryAfter: 60 },
            })
          )
        )
      )

      const res = await app.request('/')
      const json = await res.json()

      expect(json.message).toBe('Bad request')
      // Body is now in structured format under 'body' property
      expect(json.body.retryAfter).toBe(60)
    })
  })

  describe('Defects (unexpected errors)', () => {
    test('handles sync failures gracefully', async () => {
      const app = createApp()

      // Use Effect.fail instead of throwing in sync, which is more idiomatic
      app.get(
        '/',
        effectHandler(
          Effect.fail(new HttpError({ status: 500, message: 'Server error' }))
        )
      )

      const res = await app.request('/')
      expect(res.status).toBe(500)
    })

    test('handles generic errors', async () => {
      const app = createApp()

      app.get(
        '/',
        effectHandler(
          Effect.fail(new ForbiddenError({ message: 'Not allowed' }))
        )
      )

      const res = await app.request('/')
      expect(res.status).toBe(403)
    })
  })
})

describe('errorToResponse', () => {
  test('handles ValidationError with JSON preference', async () => {
    const app = createApp()

    app.get('/test', async (c) => {
      return await errorToResponse(
        new ValidationError({ errors: { field: 'Error' } }),
        c
      )
    })

    const res = await app.request('/test', {
      headers: { Accept: 'application/json' },
    })
    expect(res.status).toBe(422)
    const json = await res.json()
    // New structured format includes code and validation details
    expect(json.code).toBe('HON_VAL_004_SCHEMA_MISMATCH')
    expect(json.validation.fields.field.message).toBe('Error')
  })
})

describe('Integration Patterns', () => {
  test('full request flow with services', async () => {
    const app = createApp()

    app.get(
      '/projects/:id',
      effectHandler(
        Effect.gen(function* () {
          const db = yield* DatabaseService
          const honertia = yield* HonertiaService
          return yield* Effect.tryPromise(() =>
            honertia.render('Projects/Show', { db, id: 'test' })
          )
        })
      )
    )

    const res = await app.request('/projects/123')
    expect(res.status).toBe(200)
  })

  test('error recovery pattern', async () => {
    const app = createApp()

    app.get(
      '/',
      effectHandler(
        Effect.fail(new NotFoundError({ resource: 'Item' })).pipe(
          Effect.catchTag('NotFoundError', () =>
            Effect.succeed(new Response('Fallback content'))
          )
        )
      )
    )

    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Fallback content')
  })

  test('conditional redirect pattern', async () => {
    const app = createApp()

    app.get(
      '/',
      effectHandler(
        Effect.gen(function* () {
          const shouldRedirect = true
          if (shouldRedirect) {
            return new Redirect({ url: '/other', status: 303 })
          }
          return new Response('Stay here')
        })
      )
    )

    const res = await app.request('/')
    expect(res.status).toBe(303)
  })
})

/**
 * setupHonertia Tests
 *
 * Tests for the unified setupHonertia configuration including:
 * - Database and auth factory setup
 * - Schema configuration for route model binding
 * - Helpful error messages when configuration is missing
 */

import { describe, test, expect } from 'bun:test'
import { Hono } from 'hono'
import { Effect } from 'effect'
import { setupHonertia, registerErrorHandlers } from '../src/setup.js'
import { effectRoutes } from '../src/effect/routing.js'
import { DatabaseService, AuthService } from '../src/effect/services.js'
import { bound } from '../src/effect/binding.js'

// =============================================================================
// Test Types
// =============================================================================

type TestEnv = {
  Bindings: {
    DATABASE_URL: string
    AUTH_SECRET: string
    ENVIRONMENT: string
  }
}

// =============================================================================
// Basic setupHonertia Configuration Tests
// =============================================================================

describe('setupHonertia basic configuration', () => {
  test('sets up database on c.var.db', async () => {
    const app = new Hono<TestEnv>()

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => ({ name: 'test-db', url: 'postgres://test' }),
        },
      })
    )

    // Route that uses DatabaseService
    effectRoutes(app).get(
      '/db-test',
      Effect.gen(function* () {
        const db = yield* DatabaseService
        return new Response(JSON.stringify({ dbName: (db as any).name }))
      })
    )

    const res = await app.request('/db-test')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.dbName).toBe('test-db')
  })

  test('sets up auth on c.var.auth with access to c.var.db', async () => {
    const app = new Hono<TestEnv>()

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => ({ name: 'auth-db' }),
          auth: (c) => ({
            // Auth can access db because database runs first
            dbName: (c.var as any).db?.name,
            secret: 'test-secret',
          }),
        },
      })
    )

    // Route that uses AuthService
    effectRoutes(app).get(
      '/auth-test',
      Effect.gen(function* () {
        const auth = yield* AuthService
        return new Response(
          JSON.stringify({
            dbName: (auth as any).dbName,
            secret: (auth as any).secret,
          })
        )
      })
    )

    const res = await app.request('/auth-test')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.dbName).toBe('auth-db')
    expect(json.secret).toBe('test-secret')
  })

  test('works without database or auth configured', async () => {
    const app = new Hono<TestEnv>()

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
        },
      })
    )

    // Simple route that doesn't need db/auth
    effectRoutes(app).get(
      '/simple',
      Effect.gen(function* () {
        return new Response('OK')
      })
    )

    const res = await app.request('/simple')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
  })
})

// =============================================================================
// Schema Configuration Tests
// =============================================================================

describe('setupHonertia schema configuration', () => {
  // Mock schema for testing
  const mockSchema = {
    projects: {
      id: { name: 'id' },
      name: { name: 'name' },
    },
    users: {
      id: { name: 'id' },
      email: { name: 'email' },
    },
  }

  test('schema is available to effectRoutes via context', async () => {
    const app = new Hono<TestEnv>()

    // Mock drizzle-style db
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            get: async () => ({ id: '123', name: 'Test Project' }),
          }),
        }),
      }),
    }

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => mockDb,
          schema: mockSchema,
        },
      })
    )

    // Route with model binding - schema comes from setupHonertia
    effectRoutes(app).get(
      '/projects/{project}',
      Effect.gen(function* () {
        const project = yield* bound('project')
        return new Response(JSON.stringify(project))
      })
    )

    const res = await app.request('/projects/123')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe('123')
    expect(json.name).toBe('Test Project')
  })
})

// =============================================================================
// Configuration Error Tests
// =============================================================================

describe('setupHonertia configuration errors', () => {
  test('helpful error when using route model binding without schema', async () => {
    const app = new Hono<TestEnv>()

    // Set environment to development to see full error
    app.use('*', async (c, next) => {
      ;(c.env as any) = { ENVIRONMENT: 'development' }
      await next()
    })

    // Setup WITHOUT schema
    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => ({ name: 'test-db' }),
          // No schema configured!
        },
      })
    )

    // Register error handlers to render errors via Honertia
    registerErrorHandlers(app, {
      component: 'Error',
      showDevErrors: true,
      envKey: 'ENVIRONMENT',
      devValue: 'development',
    })

    // Route with model binding but no schema
    effectRoutes(app).get(
      '/projects/{project}',
      Effect.gen(function* () {
        const project = yield* bound('project')
        return new Response(JSON.stringify(project))
      })
    )

    const res = await app.request('/projects/123')

    // Error should be rendered via Honertia
    expect(res.status).toBe(200) // Inertia renders with 200

    const body = await res.json()
    expect(body.component).toBe('Error')
    expect(body.props.status).toBe(500)
    expect(body.props.message).toContain('schema configuration')
  })

  test('error hint references setupHonertia configuration', async () => {
    const app = new Hono<TestEnv>()

    app.use('*', async (c, next) => {
      // Set environment to development to see full error
      ;(c.env as any) = { ENVIRONMENT: 'development' }
      await next()
    })

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => ({ name: 'test-db' }),
          // No schema!
        },
      })
    )

    registerErrorHandlers(app, {
      component: 'Error',
      showDevErrors: true,
      envKey: 'ENVIRONMENT',
      devValue: 'development',
    })

    effectRoutes(app).get(
      '/users/{user}',
      Effect.gen(function* () {
        const user = yield* bound('user')
        return new Response(JSON.stringify(user))
      })
    )

    const res = await app.request('/users/456')
    const body = await res.json()

    // The hint now comes from fix suggestions and mentions schema
    expect(body.props.hint).toContain('schema')
  })

  test('error includes the specific bound key that failed', async () => {
    const app = new Hono<TestEnv>()

    app.use('*', async (c, next) => {
      ;(c.env as any) = { ENVIRONMENT: 'development' }
      await next()
    })

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => ({ name: 'test-db' }),
        },
      })
    )

    registerErrorHandlers(app, {
      component: 'Error',
      showDevErrors: true,
      envKey: 'ENVIRONMENT',
      devValue: 'development',
    })

    effectRoutes(app).get(
      '/articles/{article}',
      Effect.gen(function* () {
        const article = yield* bound('article')
        return new Response(JSON.stringify(article))
      })
    )

    const res = await app.request('/articles/789')
    const body = await res.json()

    // Error message should include the specific key
    expect(body.props.message).toContain("bound('article')")
  })
})

// =============================================================================
// Database Not Configured Tests
// =============================================================================

describe('setupHonertia database configuration errors', () => {
  test('route model binding returns 404 when database not configured', async () => {
    const app = new Hono<TestEnv>()

    const mockSchema = {
      projects: { id: { name: 'id' } },
    }

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          // database NOT configured
          schema: mockSchema,
        },
      })
    )

    effectRoutes(app).get(
      '/projects/{project}',
      Effect.gen(function* () {
        const project = yield* bound('project')
        return new Response(JSON.stringify(project))
      })
    )

    // Should 404 because there's no database to query
    const res = await app.request('/projects/123')
    expect(res.status).toBe(404)
  })

  test('helpful error when using DatabaseService without database configured', async () => {
    const app = new Hono<TestEnv>()

    app.use('*', async (c, next) => {
      ;(c.env as any) = { ENVIRONMENT: 'development' }
      await next()
    })

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          // database NOT configured!
        },
      })
    )

    registerErrorHandlers(app, {
      component: 'Error',
      showDevErrors: true,
      envKey: 'ENVIRONMENT',
      devValue: 'development',
    })

    effectRoutes(app).get(
      '/test-db',
      Effect.gen(function* () {
        const db = yield* DatabaseService
        // Try to use the db - this should throw
        const result = (db as any).select()
        return new Response(JSON.stringify(result))
      })
    )

    const res = await app.request('/test-db')
    const body = await res.json()

    expect(body.component).toBe('Error')
    expect(body.props.message).toContain('DatabaseService is not configured')
    expect(body.props.message).toContain('setupHonertia')
    // Hint now comes from fix suggestions
    expect(body.props.hint).toContain('database')
  })

  test('helpful error when using AuthService without auth configured', async () => {
    const app = new Hono<TestEnv>()

    app.use('*', async (c, next) => {
      ;(c.env as any) = { ENVIRONMENT: 'development' }
      await next()
    })

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          // auth NOT configured!
        },
      })
    )

    registerErrorHandlers(app, {
      component: 'Error',
      showDevErrors: true,
      envKey: 'ENVIRONMENT',
      devValue: 'development',
    })

    effectRoutes(app).get(
      '/test-auth',
      Effect.gen(function* () {
        const auth = yield* AuthService
        // Try to use the auth - this should throw
        const session = (auth as any).getSession()
        return new Response(JSON.stringify(session))
      })
    )

    const res = await app.request('/test-auth')
    const body = await res.json()

    expect(body.component).toBe('Error')
    expect(body.props.message).toContain('AuthService is not configured')
    expect(body.props.message).toContain('setupHonertia')
    // Hint now comes from fix suggestions
    expect(body.props.hint).toContain('auth')
  })

  test('no error when DatabaseService is accessed but not used', async () => {
    const app = new Hono<TestEnv>()

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          // database NOT configured, but we won't use it
        },
      })
    )

    effectRoutes(app).get(
      '/no-db-use',
      Effect.gen(function* () {
        // Access but don't use - should not throw
        yield* DatabaseService
        return new Response('OK')
      })
    )

    const res = await app.request('/no-db-use')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('OK')
  })
})

// =============================================================================
// Integration with effectRoutes Tests
// =============================================================================

describe('setupHonertia integration with effectRoutes', () => {
  test('effectRoutes can override schema if needed', async () => {
    const app = new Hono<TestEnv>()

    const setupSchema = {
      projects: { id: { name: 'id' } },
    }

    const routeSchema = {
      tasks: {
        id: { name: 'id' },
        title: { name: 'title' },
      },
    }

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            get: async () => ({ id: '1', title: 'Test Task' }),
          }),
        }),
      }),
    }

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => mockDb,
          schema: setupSchema,
        },
      })
    )

    // effectRoutes can pass its own schema to override
    effectRoutes(app, { schema: routeSchema }).get(
      '/tasks/{task}',
      Effect.gen(function* () {
        const task = yield* bound('task')
        return new Response(JSON.stringify(task))
      })
    )

    const res = await app.request('/tasks/1')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.title).toBe('Test Task')
  })

  test('multiple effectRoutes groups share the same schema from setupHonertia', async () => {
    const app = new Hono<TestEnv>()

    const mockSchema = {
      projects: { id: { name: 'id' }, name: { name: 'name' } },
      users: { id: { name: 'id' }, email: { name: 'email' } },
    }

    let queryCount = 0
    const mockDb = {
      select: () => ({
        from: (table: any) => ({
          where: () => ({
            get: async () => {
              queryCount++
              if (table === mockSchema.projects) {
                return { id: '1', name: 'Project A' }
              }
              if (table === mockSchema.users) {
                return { id: '2', email: 'test@example.com' }
              }
              return null
            },
          }),
        }),
      }),
    }

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => mockDb,
          schema: mockSchema,
        },
      })
    )

    // First route group
    effectRoutes(app).get(
      '/projects/{project}',
      Effect.gen(function* () {
        const project = yield* bound('project')
        return new Response(JSON.stringify(project))
      })
    )

    // Second route group - both use schema from setupHonertia
    effectRoutes(app).get(
      '/users/{user}',
      Effect.gen(function* () {
        const user = yield* bound('user')
        return new Response(JSON.stringify(user))
      })
    )

    const projectRes = await app.request('/projects/1')
    expect(projectRes.status).toBe(200)
    expect((await projectRes.json()).name).toBe('Project A')

    const userRes = await app.request('/users/2')
    expect(userRes.status).toBe(200)
    expect((await userRes.json()).email).toBe('test@example.com')

    expect(queryCount).toBe(2)
  })
})

// =============================================================================
// Full Stack Configuration Test
// =============================================================================

describe('setupHonertia full configuration', () => {
  test('complete setup with database, auth, schema, and custom middleware', async () => {
    const app = new Hono<TestEnv>()

    const mockSchema = {
      projects: { id: { name: 'id' }, ownerId: { name: 'ownerId' } },
    }

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            get: async () => ({ id: '1', ownerId: 'user-1' }),
          }),
        }),
      }),
    }

    let customMiddlewareRan = false

    app.use(
      '*',
      setupHonertia({
        honertia: {
          version: '1.0.0',
          render: (page) => JSON.stringify(page),
          database: () => mockDb,
          auth: (c) => ({
            getUser: () => ({ id: 'user-1', name: 'Test User' }),
            dbRef: (c.var as any).db, // Can access db
          }),
          schema: mockSchema,
        },
        middleware: [
          async (c, next) => {
            customMiddlewareRan = true
            await next()
          },
        ],
      })
    )

    effectRoutes(app).get(
      '/projects/{project}',
      Effect.gen(function* () {
        const project = yield* bound('project')
        const db = yield* DatabaseService
        const auth = yield* AuthService

        return new Response(
          JSON.stringify({
            project,
            hasDb: !!db,
            hasAuth: !!(auth as any).getUser,
            authHasDbRef: !!(auth as any).dbRef,
          })
        )
      })
    )

    const res = await app.request('/projects/1')
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.project.id).toBe('1')
    expect(json.hasDb).toBe(true)
    expect(json.hasAuth).toBe(true)
    expect(json.authHasDbRef).toBe(true)
    expect(customMiddlewareRan).toBe(true)
  })
})

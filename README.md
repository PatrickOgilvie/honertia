# Honertia

[![npm version](https://img.shields.io/npm/v/honertia.svg)](https://www.npmjs.com/package/honertia)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/honertia)](https://bundlephobia.com/package/honertia)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=fff)](https://hono.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=fff)](https://workers.cloudflare.com/)
[![Effect](https://img.shields.io/badge/Effect-TS-black)](https://effect.website/)

## Overview

An Inertia.js-style adapter for Hono with Effect.js integration. Inertia keeps a server-driven app but behaves like an SPA: link clicks and form posts are intercepted, a fetch/XHR request returns a JSON page object (component + props), and the client swaps the page without a full reload. Honertia layers Laravel-style route patterns and Effect actions on top of that so handlers stay clean, readable, and composable.

## Raison d'être

I've found myself wanting to use Cloudflare Workers for everything, but having come from a Laravel background nothing quite matched the DX and simplicity of Laravel x Inertia.js. When building Laravel projects I would always use Loris Leiva's laravel-actions package among other opinionated architecture decisions such as Vite, Tailwind, Bun, React etc., all of which have or will be incorporated into this project. With Cloudflare Workers the obvious choice is Hono and so we've adapted the Inertia.js protocol to run on workers+hono to mimic a Laravel-style app. Ever since learning of Effect.ts I've known that I wanted to use it for something bigger, and so we've utilised it here. Ultimately this is a workers+hono+vite+bun+laravel+inertia+effect+betterauth+planetscale mashup.

## Installation

```bash
bun add honertia
```

## Quick Start

```typescript
// src/index.ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { setupHonertia, createTemplate, createVersion, registerErrorHandlers, vite } from 'honertia'
import { Context, Layer } from 'effect'
import manifest from '../dist/manifest.json'

import { createDb } from './db'
import type { Env } from './types'
import { createAuth } from './lib/auth'
import { registerRoutes } from './routes'

const app = new Hono<Env>()
const assetVersion = createVersion(manifest)

class BindingsService extends Context.Tag('app/Bindings')<
  BindingsService,
  { KV: KVNamespace }
>() {}

// Request-scoped setup: put db/auth on c.var so Honertia/Effect can read them.
app.use('*', async (c, next) => {
  c.set('db', createDb(c.env.DATABASE_URL))
  c.set('auth', createAuth({
    db: c.var.db,
    secret: c.env.BETTER_AUTH_SECRET,
    baseURL: new URL(c.req.url).origin,
  }))
  await next()
})

// Honertia bundles the core middleware + auth loading + Effect runtime setup.
app.use('*', setupHonertia<Env, BindingsService>({
  honertia: {
    // Use your asset manifest hash so Inertia reloads on deploy.
    version: assetVersion,
    render: createTemplate((ctx) => {
      const isProd = ctx.env.ENVIRONMENT === 'production'
      return {
        title: 'My Web App',
        scripts: isProd ? ['/assets/main.js'] : [vite.script()],
        head: isProd ? '' : vite.hmrHead(),
      }
    }),
  },
  effect: {
    // Expose Cloudflare bindings to Effect handlers via a service layer.
    services: (c) => Layer.succeed(BindingsService, {
      KV: c.env.MY_KV,
    }),
  },
  // Optional: extra Hono middleware in the same chain.
  middleware: [
    logger(),
    // register additional middleware here...
  ],
}))

registerRoutes(app)
registerErrorHandlers(app)

export default app
```

```typescript
// src/routes.ts
import type { Hono } from 'hono'
import type { Env } from './types'
import { effectRoutes } from 'honertia/effect'
import { effectAuthRoutes, RequireAuthLayer } from 'honertia/auth'
import { showDashboard, listProjects, createProject, showProject, deleteProject } from './actions'

export function registerRoutes(app: Hono<Env>) {
  // Auth routes (login, register, logout, API handler) wired to better-auth.
  // CORS for /api/auth/* can be enabled via the `cors` option (see below).
  effectAuthRoutes(app, {
    loginComponent: 'Auth/Login',
    registerComponent: 'Auth/Register',
  })

  // Effect routes give you typed, DI-friendly handlers (no direct Hono ctx).
  effectRoutes(app)
    .provide(RequireAuthLayer)
    .group((route) => {
      // Grouped routes share layers and path prefixes.
      route.get('/', showDashboard) // GET example.com

      route.prefix('/projects').group((route) => {
        route.get('/', listProjects)        // GET    example.com/projects
        route.post('/', createProject)      // POST   example.com/projects
        route.get('/:id', showProject)      // GET    example.com/projects/2
        route.delete('/:id', deleteProject) // DELETE example.com/projects/2
      })
    })
}
```

### Example Action

Here's the `listProjects` action referenced above:

```typescript
// src/actions/projects/list.ts
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { DatabaseService, AuthUserService, render, type AuthUser } from 'honertia/effect'
import { schema, type Database, type Project } from '../../db'

interface ProjectsIndexProps {
  projects: Project[]
}

const fetchProjects = (
  db: Database,
  user: AuthUser
): Effect.Effect<ProjectsIndexProps, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      const projects = await db.query.projects.findMany({
        where: eq(schema.projects.userId, user.user.id),
        orderBy: (projects, { desc }) => [desc(projects.createdAt)],
      })
      return { projects }
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error)),
  })

export const listProjects = Effect.gen(function* () {
  const db = yield* DatabaseService
  const user = yield* AuthUserService
  const props = yield* fetchProjects(db as Database, user)
  return yield* render('Projects/Index', props)
})
```

The component name `Projects/Index` maps to a file on disk. A common
Vite + React layout is:

```
src/pages/Projects/Index.tsx
```

That means the folders mirror the component path, and `Index.tsx` is the file
that exports the page component. In the example below, `Link` comes from
`@inertiajs/react` because it performs Inertia client-side visits (preserving
page state and avoiding full reloads), whereas a plain `<a>` would do a full
navigation.

```tsx
// src/pages/Projects/Index.tsx
/**
 * Projects Index Page
 */

import { Link } from '@inertiajs/react'
import Layout from '~/components/Layout'
import type { PageProps, Project } from '~/types'

interface Props {
  projects: Project[]
}

export default function ProjectsIndex({ projects }: PageProps<Props>) {
  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <Link
          href="/projects/create"
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
        >
          New Project
        </Link>
      </div>
      
      <div className="bg-white rounded-lg shadow">
        {projects.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No projects yet.{' '}
            <Link href="/projects/create" className="text-indigo-600 hover:underline">
              Create your first project
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="block px-6 py-4 hover:bg-gray-50"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-sm font-medium text-gray-900">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="text-sm text-gray-500 mt-1">
                          {project.description}
                        </p>
                      )}
                    </div>
                    <span className="text-sm text-gray-400">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  )
}
```

### Vite Helpers

The `vite` helper provides dev/prod asset management:

```typescript
import { vite } from 'honertia'

vite.script()   // 'http://localhost:5173/src/main.tsx'
vite.hmrHead()  // HMR preamble script tags for React Fast Refresh
```

## Requirements

- **Runtime**: Node.js 18+ or Bun 1.0+
- **Peer Dependencies**:
  - `hono` >= 4.0.0
  - `better-auth` >= 1.0.0
- **Dependencies**:
  - `effect` >= 3.12.0

## Core Concepts

### Effect-Based Handlers

Route handlers are Effect computations that return `Response | Redirect`:

```typescript
import { Effect } from 'effect'
import {
  DatabaseService,
  AuthUserService,
  render,
  redirect,
} from 'honertia'

// Simple page render
export const showDashboard = Effect.gen(function* () {
  const db = yield* DatabaseService
  const user = yield* AuthUserService

  const projects = yield* Effect.tryPromise(() =>
    db.query.projects.findMany({
      where: eq(schema.projects.userId, user.user.id),
      limit: 5,
    })
  )

  return yield* render('Dashboard/Index', { projects })
})

// Form submission with redirect
export const createProject = Effect.gen(function* () {
  const db = yield* DatabaseService
  const user = yield* AuthUserService
  const input = yield* validateRequest(CreateProjectSchema)

  yield* Effect.tryPromise(() =>
    db.insert(schema.projects).values({
      ...input,
      userId: user.user.id,
    })
  )

  return yield* redirect('/projects')
})
```

### Services

Honertia provides these services via Effect's dependency injection:

| Service | Description |
|---------|-------------|
| `DatabaseService` | Database client (from `c.var.db`) |
| `AuthService` | Auth instance (from `c.var.auth`) |
| `AuthUserService` | Authenticated user session |
| `HonertiaService` | Page renderer |
| `RequestService` | Request context (params, query, body) |
| `ResponseFactoryService` | Response builders |

#### Custom Services

You can inject Cloudflare Worker bindings (KV, D1, Queues, Analytics Engine) as services using the `services` option in `setupHonertia`, `effectBridge`, or `effectRoutes`.

Choose the option that matches your setup:

- `setupHonertia`: recommended for most apps; keeps config in one place and applies services to every Effect handler.
- `effectBridge`: use when wiring middleware manually or when you need precise middleware ordering; applies services to all Effect handlers.
- `effectRoutes`: use when you want services scoped to a route group or different services per group.

```typescript
import { Effect, Layer, Context } from 'effect'
import { setupHonertia, effectBridge, effectRoutes } from 'honertia'

// Define your custom service
export class BindingsService extends Context.Tag('app/Bindings')<
  BindingsService,
  {
    KV: KVNamespace
    ANALYTICS: AnalyticsEngineDataset
    DB: D1Database
  }
>() {}

// Option 1: setupHonertia (global services via the one-liner setup)
app.use('*', setupHonertia<Env, BindingsService>({
  honertia: {
    version: '1.0.0',
    render: (page) => JSON.stringify(page),
  },
  effect: {
    services: (c) => Layer.succeed(BindingsService, {
      KV: c.env.MY_KV,
      ANALYTICS: c.env.ANALYTICS,
      DB: c.env.DB,
    }),
  },
}))

// Option 2: effectBridge (manual middleware wiring)
app.use('*', effectBridge<Env, BindingsService>({
  database: (c) => createDb(c.env.DATABASE_URL),
  services: (c) => Layer.succeed(BindingsService, {
    KV: c.env.MY_KV,
    ANALYTICS: c.env.ANALYTICS,
    DB: c.env.DB,
  }),
}))

// Option 3: effectRoutes (scoped to a route group)
effectRoutes<Env, BindingsService>(app, {
  services: (c) => Layer.succeed(BindingsService, {
    KV: c.env.MY_KV,
    ANALYTICS: c.env.ANALYTICS,
    DB: c.env.DB,
  }),
}).group((route) => {
  route.get('/data', getDataFromKV)
})

// Use the custom service in your actions
const getDataFromKV = Effect.gen(function* () {
  const bindings = yield* BindingsService
  const value = yield* Effect.tryPromise(() =>
    bindings.KV.get('my-key')
  )
  return yield* json({ value })
})
```

You can provide multiple bindings in any option using `Layer.mergeAll` (for example, a `QueueService` tag for a queue binding):

```typescript
app.use('*', effectBridge<Env, BindingsService | QueueService>({
  services: (c) => Layer.mergeAll(
    Layer.succeed(BindingsService, {
      KV: c.env.MY_KV,
      ANALYTICS: c.env.ANALYTICS,
      DB: c.env.DB,
    }),
    Layer.succeed(QueueService, c.env.MY_QUEUE),
  ),
}))
```

### Routing

Use `effectRoutes` for Laravel-style route definitions:

```typescript
import {
  effectRoutes,
  RequireAuthLayer,
  RequireGuestLayer,
} from 'honertia'

// Protected routes (require authentication)
effectRoutes(app)
  .provide(RequireAuthLayer)
  .prefix('/dashboard')
  .group((route) => {
    route.get('/', showDashboard)
    route.get('/settings', showSettings)
    route.post('/settings', updateSettings)
  })

// Guest-only routes
effectRoutes(app)
  .provide(RequireGuestLayer)
  .group((route) => {
    route.get('/login', showLogin)
    route.get('/register', showRegister)
  })

// Public routes (no layer)
effectRoutes(app).group((route) => {
  route.get('/about', showAbout)
  route.get('/pricing', showPricing)
})
```

## Validation

Honertia uses Effect Schema with Laravel-inspired validators:

```typescript
import { Effect, Schema as S } from 'effect'
import {
  validateRequest,
  requiredString,
  nullableString,
  email,
  password,
  redirect,
} from 'honertia'

// Define schema
const CreateProjectSchema = S.Struct({
  name: requiredString.pipe(
    S.minLength(3, { message: () => 'Name must be at least 3 characters' }),
    S.maxLength(100)
  ),
  description: nullableString,
})

// Use in handler
export const createProject = Effect.gen(function* () {
  const input = yield* validateRequest(CreateProjectSchema, {
    errorComponent: 'Projects/Create', // Re-render with errors on validation failure
  })

  // input is fully typed: { name: string, description: string | null }
  yield* insertProject(input)

  return yield* redirect('/projects')
})
```

### Available Validators

#### Strings
```typescript
import {
  requiredString,    // Trimmed, non-empty string
  nullableString,    // Converts empty to null
  required,          // Custom message: required('Name is required')
  alpha,             // Letters only
  alphaDash,         // Letters, numbers, dashes, underscores
  alphaNum,          // Letters and numbers only
  email,             // Validated email
  url,               // Validated URL
  uuid,              // UUID format
  min,               // min(5) - at least 5 chars
  max,               // max(100) - at most 100 chars
  size,              // size(10) - exactly 10 chars
} from 'honertia'
```

#### Numbers
```typescript
import {
  coercedNumber,     // Coerce string to number
  positiveInt,       // Positive integer
  nonNegativeInt,    // 0 or greater
  between,           // between(1, 100)
  gt, gte, lt, lte,  // Comparisons
} from 'honertia'
```

#### Booleans & Dates
```typescript
import {
  coercedBoolean,    // Coerce "true", "1", etc.
  checkbox,          // HTML checkbox (defaults to false)
  accepted,          // Must be truthy
  coercedDate,       // Coerce to Date
  nullableDate,      // Empty string -> null
  after,             // after(new Date())
  before,            // before('2025-01-01')
} from 'honertia'
```

#### Password
```typescript
import { password } from 'honertia'

const PasswordSchema = password({
  min: 8,
  letters: true,
  mixedCase: true,
  numbers: true,
  symbols: true,
})
```

## Response Helpers

```typescript
import {
  render,
  renderWithErrors,
  redirect,
  json,
  notFound,
  forbidden,
} from 'honertia'

// Render a page
return yield* render('Projects/Show', { project })

// Render with validation errors
return yield* renderWithErrors('Projects/Create', {
  name: 'Name is required',
})

// Redirect (303 by default for POST)
return yield* redirect('/projects')
return yield* redirect('/login', 302)

// JSON response
return yield* json({ success: true })
return yield* json({ error: 'Not found' }, 404)

// Error responses
return yield* notFound('Project')
return yield* forbidden('You cannot edit this project')
```

## Error Handling

Honertia provides typed errors:

```typescript
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  HttpError,
} from 'honertia'

// Validation errors automatically re-render with field errors
const input = yield* validateRequest(schema, {
  errorComponent: 'Projects/Create',
})

// Manual error handling
const project = yield* Effect.tryPromise(() =>
  db.query.projects.findFirst({ where: eq(id, projectId) })
)

if (!project) {
  return yield* notFound('Project', projectId)
}

if (project.userId !== user.user.id) {
  return yield* forbidden('You cannot view this project')
}
```

## Authentication

### Layers

```typescript
import { RequireAuthLayer, RequireGuestLayer } from 'honertia'

// Require authentication - fails with UnauthorizedError if no user
effectRoutes(app)
  .provide(RequireAuthLayer)
  .get('/dashboard', showDashboard)

// Require guest - fails if user IS logged in
effectRoutes(app)
  .provide(RequireGuestLayer)
  .get('/login', showLogin)
```

### Helpers

```typescript
import {
  requireAuth,
  requireGuest,
  isAuthenticated,
  currentUser,
} from 'honertia'

// In a handler
export const showProfile = Effect.gen(function* () {
  const user = yield* requireAuth('/login') // Redirect to /login if not auth'd
  return yield* render('Profile', { user: user.user })
})

// Check without failing
const authed = yield* isAuthenticated // boolean
const user = yield* currentUser       // AuthUser | null
```

### Built-in Auth Routes

```typescript
import { effectAuthRoutes } from 'honertia'

effectAuthRoutes(app, {
  loginPath: '/login',           // GET: show login page
  registerPath: '/register',     // GET: show register page
  logoutPath: '/logout',         // POST: logout and redirect
  apiPath: '/api/auth',          // Better-auth API handler
  logoutRedirect: '/login',
  loginComponent: 'Auth/Login',
  registerComponent: 'Auth/Register',
})
```

To enable CORS for the auth API handler (`/api/auth/*`), pass a `cors` config.
By default, no CORS headers are added (recommended when your UI and API share the same origin).
Use this when your frontend is on a different origin (local dev, separate domain, mobile app, etc.).

```typescript
effectAuthRoutes(app, {
  apiPath: '/api/auth',
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  },
})
```

This sets the appropriate `Access-Control-*` headers and handles `OPTIONS` preflight for the auth API routes.
Always keep the `origin` list tight; avoid `'*'` for auth endpoints, especially with `credentials: true`.

## Action Factories

For common patterns, use action factories:

```typescript
import { effectAction, dbAction, authAction } from 'honertia'

// effectAction: validation + custom handler
export const updateSettings = effectAction(
  SettingsSchema,
  (input) => Effect.gen(function* () {
    yield* saveSettings(input)
    return yield* redirect('/settings')
  }),
  { errorComponent: 'Settings/Edit' }
)

// dbAction: validation + db + auth
export const createProject = dbAction(
  CreateProjectSchema,
  (input, { db, user }) => Effect.gen(function* () {
    yield* Effect.tryPromise(() =>
      db.insert(projects).values({ ...input, userId: user.user.id })
    )
    return yield* redirect('/projects')
  }),
  { errorComponent: 'Projects/Create' }
)

// authAction: just requires auth
export const showDashboard = authAction((user) =>
  Effect.gen(function* () {
    const data = yield* fetchDashboardData(user)
    return yield* render('Dashboard', data)
  })
)
```

## React Integration

### Page Component Type

```typescript
import type { HonertiaPage } from 'honertia'

interface ProjectsProps {
  projects: Project[]
}

const ProjectsIndex: HonertiaPage<ProjectsProps> = ({ projects, errors }) => {
  return (
    <div>
      {errors?.name && <span className="error">{errors.name}</span>}
      {projects.map(p => <ProjectCard key={p.id} project={p} />)}
    </div>
  )
}

export default ProjectsIndex
```

### Shared Props

All pages receive shared props set via middleware:

```typescript
// Server: shareAuthMiddleware() adds auth data
// Client: access via props
const Layout: HonertiaPage<Props> = ({ auth, children }) => {
  return (
    <div>
      {auth?.user ? (
        <span>Welcome, {auth.user.name}</span>
      ) : (
        <a href="/login">Login</a>
      )}
      {children}
    </div>
  )
}
```

## Architecture Notes

### Request-Scoped Services

Honertia creates a fresh Effect runtime per request via `effectBridge()`. This is required for Cloudflare Workers where I/O objects cannot be shared between requests.

```typescript
// This happens automatically in effectBridge middleware:
const layer = buildContextLayer(c)      // Build layers from Hono context
const runtime = ManagedRuntime.make(layer) // New runtime per request
// ... handle request ...
await runtime.dispose()                  // Cleanup after request
```

This approach provides full type safety - your handlers declare their service requirements, and the type system ensures they're provided.

### Why Not Global Runtime?

On Cloudflare Workers, database connections and other I/O objects are isolated per request. Using a global runtime with `FiberRef` would lose type safety. The per-request runtime approach ensures:

1. Type-safe dependency injection
2. Proper resource cleanup
3. Full compatibility with Workers' isolation model

If you're using PlanetScale with Hyperdrive, the "connection" you create per request is lightweight - it's just a client pointing at Hyperdrive's persistent connection pool.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

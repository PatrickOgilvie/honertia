# Honertia

[![npm version](https://img.shields.io/npm/v/honertia.svg)](https://www.npmjs.com/package/honertia)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/honertia)](https://bundlephobia.com/package/honertia)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=fff)](https://hono.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=fff)](https://workers.cloudflare.com/)
[![Effect](https://img.shields.io/badge/Effect-TS-black)](https://effect.website/)

## Raison d'être

I've found myself wanting to use Cloudflare Workers for everything, but having come from a Laravel background nothing quite matched the DX and simplicity of Laravel x Inertia.js. When building Laravel projects I would always use Loris Leiva's laravel-actions package among other opinionated architecture decisions such as Vite, Tailwind, Bun, React etc., all of which have or will be incorporated into this project. With Cloudflare Workers the obvious choice is Hono and so we've adapted the Inertia.js protocol to run on workers+hono to mimic a Laravel-style app. Ever since learning of Effect.ts I've known that I wanted to use it for something bigger, and so we've utilised it here. Ultimately this is a workers+hono+vite+bun+laravel+inertia+effect+betterauth+planetscale mashup that delivers clean, readable, and powerful web app scaffolding.

An Inertia.js-style adapter for Hono with Effect.js integration. Build full-stack applications with type-safe server actions, Laravel-inspired validation, and seamless React rendering.

## Requirements

- **Runtime**: Node.js 18+ or Bun 1.0+
- **Peer Dependencies**:
  - `hono` >= 4.0.0
  - `better-auth` >= 1.0.0
- **Dependencies**:
  - `effect` >= 3.12.0

## Installation

```bash
bun add honertia
```

## Quick Start

```typescript
// src/index.ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { setupHonertia, createTemplate, registerErrorHandlers, vite } from 'honertia'

import { createDb } from './db'
import type { Env } from './types'
import { createAuth } from './lib/auth'
import { registerRoutes } from './routes'

const app = new Hono<Env>()

// Database & Auth
app.use('*', async (c, next) => {
  c.set('db', createDb(c.env.DATABASE_URL))
  c.set('auth', createAuth({
    db: c.var.db,
    secret: c.env.BETTER_AUTH_SECRET,
    baseURL: new URL(c.req.url).origin,
  }))
  await next()
})

// Honertia (bundles core middleware, auth loading, and Effect bridge)
app.use('*', setupHonertia<Env>({
  honertia: {
    version: '1.0.0',
    render: createTemplate((ctx) => {
      const isProd = ctx.env.ENVIRONMENT === 'production'
      return {
        title: 'Dashboard',
        scripts: isProd ? ['/assets/main.js'] : [vite.script()],
        head: isProd ? '' : vite.hmrHead(),
      }
    }),
  },
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
  // Auth routes (login, register, logout, API handler)
  effectAuthRoutes(app, {
    loginComponent: 'Auth/Login',
    registerComponent: 'Auth/Register',
  })

  // Routes that require the user to be authenticated
  effectRoutes(app)
    .provide(RequireAuthLayer)
    .group((route) => {
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
  return yield* render('Dashboard/Projects/Index', props)
})
```

### Vite Helpers

The `vite` helper provides dev/prod asset management:

```typescript
import { vite } from 'honertia'

vite.script()   // 'http://localhost:5173/src/main.tsx'
vite.hmrHead()  // HMR preamble script tags for React Fast Refresh
```

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

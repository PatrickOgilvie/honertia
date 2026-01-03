# Honertia

[![npm version](https://img.shields.io/npm/v/honertia.svg)](https://www.npmjs.com/package/honertia)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
import {
  honertia,
  createTemplate,
  loadUser,
  shareAuthMiddleware,
  effectBridge,
  effectRoutes,
  effectAuthRoutes,
  RequireAuthLayer,
} from 'honertia'

const app = new Hono()

// Core middleware
app.use('*', honertia({
  version: '1.0.0',
  render: createTemplate({
    title: 'My App',
    scripts: ['http://localhost:5173/src/main.tsx'],
  }),
}))

// Database & Auth setup (your own middleware)
app.use('*', async (c, next) => {
  c.set('db', createDb(c.env.DATABASE_URL))
  c.set('auth', createAuth({ /* config */ }))
  await next()
})

// Auth middleware
app.use('*', loadUser())
app.use('*', shareAuthMiddleware())

// Effect bridge (sets up Effect runtime per request)
app.use('*', effectBridge())

// Register routes
effectAuthRoutes(app, {
  loginComponent: 'Auth/Login',
  registerComponent: 'Auth/Register',
})

effectRoutes(app)
  .provide(RequireAuthLayer)
  .group((route) => {
    route.get('/', showDashboard)
    route.get('/projects', listProjects)
    route.post('/projects', createProject)
  })

export default app
```

### Using `setupHonertia` (Recommended)

For a cleaner setup, use `setupHonertia` which bundles all core middleware into a single call:

```typescript
import { Hono } from 'hono'
import { setupHonertia, createTemplate, effectRoutes } from 'honertia'

const app = new Hono()

app.use('*', setupHonertia({
  honertia: {
    version: '1.0.0',
    render: createTemplate({
      title: 'My App',
      scripts: ['http://localhost:5173/src/main.tsx'],
    }),
  },
  auth: {
    userKey: 'user',
    sessionCookie: 'session',
  },
  effect: {
    // Effect bridge configuration
  },
}))

export default app
```

This is equivalent to manually registering:
- `honertia()` - Core Honertia middleware
- `loadUser()` - Loads authenticated user into context
- `shareAuthMiddleware()` - Shares auth state with pages
- `effectBridge()` - Sets up Effect runtime for each request

#### Adding Custom Middleware

You can inject additional middleware that runs after the core setup:

```typescript
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

app.use('*', setupHonertia({
  honertia: {
    version: '1.0.0',
    render: createTemplate({ title: 'My App', scripts: [...] }),
  },
  middleware: [
    cors(),
    logger(),
    myCustomMiddleware(),
  ],
}))
```

The custom middleware runs in order after `effectBridge`, giving you access to all Honertia context variables.

#### Environment-Aware Templates

`createTemplate` can accept a function that receives the Hono context, enabling environment-specific configuration:

```typescript
const viteHmrHead = `
  <script type="module">
    import RefreshRuntime from 'http://localhost:5173/@react-refresh'
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
  </script>
  <script type="module" src="http://localhost:5173/@vite/client"></script>
`

app.use('*', setupHonertia({
  honertia: {
    version: '1.0.0',
    render: createTemplate((ctx) => {
      const isProd = ctx.env.ENVIRONMENT === 'production'
      return {
        title: 'My App',
        scripts: isProd
          ? ['/assets/main.js']
          : ['http://localhost:5173/src/main.tsx'],
        head: isProd
          ? '<link rel="icon" href="/favicon.svg" />'
          : `${viteHmrHead}<link rel="icon" href="/favicon.svg" />`,
      }
    }),
  },
}))
```

This pattern allows you to:
- Use Vite HMR in development, built assets in production
- Access environment variables from `ctx.env`
- Dynamically configure any template option based on request context

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

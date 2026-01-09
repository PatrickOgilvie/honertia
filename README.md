# Honertia

Inertia.js adapter for Hono with Effect.ts. Server-driven app with SPA behavior.

## CLI Commands

### Generate Action

```bash
# Basic action
honertia generate:action projects/create --method POST --path /projects

# With authentication
honertia generate:action projects/create --method POST --path /projects --auth required

# With validation schema
honertia generate:action projects/create \
  --method POST \
  --path /projects \
  --auth required \
  --schema "name:string:required, description:string:nullable"

# With route model binding
honertia generate:action projects/update \
  --method PUT \
  --path "/projects/{project}" \
  --auth required \
  --schema "name:string:required"

# Preview without writing
honertia generate:action projects/create --preview

# JSON output for programmatic use
honertia generate:action projects/create --json --preview
```

Schema format: `fieldName:type:modifier`
- Types: `string`, `number`, `boolean`, `date`, `uuid`, `email`, `url`
- Modifiers: `required` (default), `nullable`, `optional`

### Generate CRUD

```bash
# Full CRUD
honertia generate:crud projects

# With schema for create/update
honertia generate:crud projects \
  --schema "name:string:required, description:string:nullable"

# Only specific actions
honertia generate:crud projects --only index,show

# Exclude actions
honertia generate:crud projects --except destroy

# Preview all generated files
honertia generate:crud projects --preview
```

### Generate Feature

```bash
# Custom action on a resource
honertia generate:feature projects/archive \
  --method POST \
  --path "/projects/{project}/archive" \
  --auth required

# With fields
honertia generate:feature users/profile \
  --method PUT \
  --path "/profile" \
  --fields "name:string:required, bio:string:nullable"
```

### List Routes

```bash
honertia routes              # Table format
honertia routes --json       # JSON for agents
honertia routes --minimal    # METHOD PATH only
honertia routes --method get # Filter by method
honertia routes --prefix /api
honertia routes --pattern '/projects/*'
```

### Project Check

```bash
honertia check           # Run all checks
honertia check --json    # JSON output with fix suggestions
honertia check --verbose # Detailed output
honertia check --only routes,naming
```

### OpenAPI Generation

```bash
honertia generate:openapi \
  --title "My API" \
  --version "1.0.0" \
  --server https://api.example.com \
  --output openapi.json

# Only API routes
honertia generate:openapi --include /api

# Exclude internal routes
honertia generate:openapi --exclude /internal,/admin
```

### Database Migrations

```bash
honertia db status              # Show migration status
honertia db status --json       # JSON output
honertia db migrate             # Run pending migrations
honertia db migrate --preview   # Preview SQL without executing
honertia db rollback            # Rollback last migration
honertia db rollback --preview  # Preview rollback SQL
honertia db generate add_email  # Generate new migration
```

---

## Installation

```bash
bun add honertia
```

Peer dependencies: `hono >= 4.0.0`, `better-auth >= 1.0.0`

---

## Project Structure

```
src/
  index.ts          # Hono app, setupHonertia()
  routes.ts         # effectRoutes() definitions
  actions/
    projects/
      index.ts      # listProjects
      show.ts       # showProject
      create.ts     # createProject
      update.ts     # updateProject
      destroy.ts    # destroyProject
  pages/
    Projects/
      Index.tsx     # render('Projects/Index')
      Show.tsx
      Create.tsx
      Edit.tsx
  db/
    db.ts
    schema.ts
  lib/
    auth.ts
  types.ts
```

---

## Setup Examples

### Basic Setup

```typescript
// src/index.ts
import { Hono } from 'hono'
import { setupHonertia, createTemplate, createVersion, registerErrorHandlers } from 'honertia'
import manifest from '../dist/manifest.json'
import * as schema from './db/schema'
import { createDb } from './db/db'
import { createAuth } from './lib/auth'
import { registerRoutes } from './routes'

const app = new Hono<Env>()

app.use('*', setupHonertia<Env>({
  honertia: {
    version: createVersion(manifest),
    render: createTemplate((ctx) => ({
      title: 'My App',
      scripts: [manifest['src/main.tsx'].file],
      styles: manifest['src/main.tsx'].css ?? [],
    })),
    database: (c) => createDb(c.env.DATABASE_URL),
    auth: (c) => createAuth({
      db: c.var.db,
      secret: c.env.BETTER_AUTH_SECRET,
      baseURL: new URL(c.req.url).origin,
    }),
    schema,
  },
}))

registerRoutes(app)
registerErrorHandlers(app)

export default app
```

### Routes File

```typescript
// src/routes.ts
import type { Hono } from 'hono'
import type { Env } from './types'
import { effectRoutes } from 'honertia/effect'
import { effectAuthRoutes, RequireAuthLayer } from 'honertia/auth'

// Import actions
import { listProjects, showProject, createProject, updateProject, destroyProject } from './actions/projects'
import { loginUser, registerUser, logoutUser } from './actions/auth'

export function registerRoutes(app: Hono<Env>) {
  // Auth routes (login, register, logout, API)
  effectAuthRoutes(app, {
    loginComponent: 'Auth/Login',
    registerComponent: 'Auth/Register',
    loginAction: loginUser,
    registerAction: registerUser,
    logoutAction: logoutUser,
  })

  // Protected routes
  effectRoutes(app)
    .provide(RequireAuthLayer)
    .group((route) => {
      route.get('/', showDashboard)

      route.prefix('/projects').group((route) => {
        route.get('/', listProjects)
        route.post('/', createProject)
        route.get('/{project}', showProject)
        route.put('/{project}', updateProject)
        route.delete('/{project}', destroyProject)
      })
    })

  // Public routes (no auth required)
  effectRoutes(app).group((route) => {
    route.get('/about', showAbout)
    route.get('/pricing', showPricing)
  })
}
```

---

## Action Examples

### Simple GET (Public Page)

```typescript
import { Effect } from 'effect'
import { action, render } from 'honertia/effect'

export const showAbout = action(
  Effect.gen(function* () {
    return yield* render('About', {})
  })
)
```

### GET with Authentication

```typescript
import { Effect } from 'effect'
import { action, authorize, render, DatabaseService } from 'honertia/effect'
import { eq } from 'drizzle-orm'
import { projects } from '~/db/schema'

export const listProjects = action(
  Effect.gen(function* () {
    const auth = yield* authorize()
    const db = yield* DatabaseService

    const userProjects = yield* Effect.tryPromise(() =>
      db.query.projects.findMany({
        where: eq(projects.userId, auth.user.id),
        orderBy: (p, { desc }) => [desc(p.createdAt)],
      })
    )

    return yield* render('Projects/Index', { projects: userProjects })
  })
)
```

### GET with Route Model Binding

```typescript
import { Effect } from 'effect'
import { action, authorize, bound, render } from 'honertia/effect'

export const showProject = action(
  Effect.gen(function* () {
    const auth = yield* authorize()
    const project = yield* bound('project')  // Auto-fetched from {project} param

    return yield* render('Projects/Show', { project })
  })
)
```

### POST with Validation

```typescript
import { Effect, Schema as S } from 'effect'
import {
  action,
  authorize,
  validateRequest,
  DatabaseService,
  redirect,
  asTrusted,
  dbMutation,
  requiredString,
} from 'honertia/effect'
import { projects } from '~/db/schema'

const CreateProjectSchema = S.Struct({
  name: requiredString,
  description: S.optional(S.String),
})

export const createProject = action(
  Effect.gen(function* () {
    const auth = yield* authorize()
    const input = yield* validateRequest(CreateProjectSchema, {
      errorComponent: 'Projects/Create',
    })
    const db = yield* DatabaseService

    yield* dbMutation(db, async (db) => {
      await db.insert(projects).values(asTrusted({
        name: input.name,
        description: input.description ?? null,
        userId: auth.user.id,
      }))
    })

    return yield* redirect('/projects')
  })
)
```

### PUT with Route Binding and Validation

```typescript
import { Effect, Schema as S } from 'effect'
import {
  action,
  authorize,
  bound,
  validateRequest,
  DatabaseService,
  redirect,
  asTrusted,
  dbMutation,
  requiredString,
  forbidden,
} from 'honertia/effect'
import { eq } from 'drizzle-orm'
import { projects } from '~/db/schema'

const UpdateProjectSchema = S.Struct({
  name: requiredString,
  description: S.optional(S.String),
})

export const updateProject = action(
  Effect.gen(function* () {
    const auth = yield* authorize()
    const project = yield* bound('project')

    // Authorization check
    if (project.userId !== auth.user.id) {
      return yield* forbidden('You cannot edit this project')
    }

    const input = yield* validateRequest(UpdateProjectSchema, {
      errorComponent: 'Projects/Edit',
    })
    const db = yield* DatabaseService

    yield* dbMutation(db, async (db) => {
      await db.update(projects)
        .set(asTrusted({
          name: input.name,
          description: input.description ?? null,
        }))
        .where(eq(projects.id, project.id))
    })

    return yield* redirect(`/projects/${project.id}`)
  })
)
```

### DELETE with Route Binding

```typescript
import { Effect } from 'effect'
import {
  action,
  authorize,
  bound,
  DatabaseService,
  redirect,
  forbidden,
  dbMutation,
} from 'honertia/effect'
import { eq } from 'drizzle-orm'
import { projects } from '~/db/schema'

export const destroyProject = action(
  Effect.gen(function* () {
    const auth = yield* authorize()
    const project = yield* bound('project')

    if (project.userId !== auth.user.id) {
      return yield* forbidden('You cannot delete this project')
    }

    const db = yield* DatabaseService

    yield* dbMutation(db, async (db) => {
      await db.delete(projects).where(eq(projects.id, project.id))
    })

    return yield* redirect('/projects')
  })
)
```

### API Endpoint (JSON Response)

```typescript
import { Effect, Schema as S } from 'effect'
import { action, validateRequest, DatabaseService, json } from 'honertia/effect'
import { like } from 'drizzle-orm'
import { projects } from '~/db/schema'

const SearchSchema = S.Struct({
  q: S.String,
  limit: S.optional(S.NumberFromString).pipe(S.withDefault(() => 10)),
})

export const searchProjects = action(
  Effect.gen(function* () {
    const { q, limit } = yield* validateRequest(SearchSchema)
    const db = yield* DatabaseService

    const results = yield* Effect.tryPromise(() =>
      db.query.projects.findMany({
        where: like(projects.name, `%${q}%`),
        limit,
      })
    )

    return yield* json({ results, count: results.length })
  })
)
```

### Action with Role Check

```typescript
import { Effect } from 'effect'
import { action, authorize, DatabaseService, render } from 'honertia/effect'

export const adminDashboard = action(
  Effect.gen(function* () {
    // authorize() with callback checks role
    const auth = yield* authorize((a) => a.user.role === 'admin')
    const db = yield* DatabaseService

    const stats = yield* Effect.tryPromise(() =>
      db.query.users.findMany({ limit: 100 })
    )

    return yield* render('Admin/Dashboard', { stats })
  })
)
```

### Action with Custom Error Handling

```typescript
import { Effect } from 'effect'
import {
  action,
  authorize,
  DatabaseService,
  render,
  notFound,
  httpError,
} from 'honertia/effect'
import { eq } from 'drizzle-orm'
import { projects } from '~/db/schema'

export const showProject = action(
  Effect.gen(function* () {
    const auth = yield* authorize()
    const db = yield* DatabaseService
    const request = yield* RequestService
    const projectId = request.param('id')

    const project = yield* Effect.tryPromise(() =>
      db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      })
    )

    if (!project) {
      return yield* notFound('Project', projectId)
    }

    if (project.userId !== auth.user.id) {
      return yield* httpError(403, 'Access denied')
    }

    return yield* render('Projects/Show', { project })
  })
)
```

---

## Validation Examples

### String Validators

```typescript
import { Schema as S } from 'effect'
import {
  requiredString,    // Trimmed, non-empty
  nullableString,    // Empty string -> null
  email,             // Email format
  url,               // URL format
  uuid,              // UUID format
  alpha,             // Letters only
  alphaDash,         // Letters, numbers, dashes, underscores
  alphaNum,          // Letters and numbers
  min,               // min(5) - at least 5 chars
  max,               // max(100) - at most 100 chars
  size,              // size(10) - exactly 10 chars
} from 'honertia/effect'

const UserSchema = S.Struct({
  name: requiredString,
  bio: nullableString,
  email: email,
  website: S.optional(url),
  username: alphaDash.pipe(min(3), max(20)),
})
```

### Number Validators

```typescript
import { Schema as S } from 'effect'
import {
  coercedNumber,     // String -> number
  positiveInt,       // > 0
  nonNegativeInt,    // >= 0
  between,           // between(1, 100)
  gt,                // gt(0) - greater than
  gte,               // gte(0) - greater than or equal
  lt,                // lt(100)
  lte,               // lte(100)
} from 'honertia/effect'

const ProductSchema = S.Struct({
  price: coercedNumber.pipe(gte(0)),
  quantity: positiveInt,
  discount: S.optional(coercedNumber.pipe(between(0, 100))),
})
```

### Boolean and Date Validators

```typescript
import { Schema as S } from 'effect'
import {
  coercedBoolean,    // "true", "1", "on" -> true
  checkbox,          // HTML checkbox (defaults to false)
  accepted,          // Must be truthy (for terms acceptance)
  coercedDate,       // String -> Date
  nullableDate,      // Empty string -> null
  after,             // after(new Date()) - must be in future
  before,            // before('2025-12-31')
} from 'honertia/effect'

const EventSchema = S.Struct({
  isPublic: checkbox,
  termsAccepted: accepted,
  startDate: coercedDate.pipe(after(new Date())),
  endDate: S.optional(nullableDate),
})
```

### Password Validator

```typescript
import { password } from 'honertia/effect'

const RegisterSchema = S.Struct({
  email: email,
  password: password({
    min: 8,
    letters: true,
    mixedCase: true,
    numbers: true,
    symbols: true,
  }),
})
```

### Full Form Example

```typescript
import { Schema as S } from 'effect'
import {
  requiredString,
  nullableString,
  email,
  coercedNumber,
  checkbox,
  coercedDate,
  between,
} from 'honertia/effect'

const CreateEventSchema = S.Struct({
  title: requiredString.pipe(S.maxLength(200)),
  description: nullableString,
  organizerEmail: email,
  maxAttendees: coercedNumber.pipe(between(1, 10000)),
  isPublic: checkbox,
  startDate: coercedDate,
  endDate: S.optional(coercedDate),
})

// In action
const input = yield* validateRequest(CreateEventSchema, {
  errorComponent: 'Events/Create',
  messages: {
    title: 'Please enter an event title',
    organizerEmail: 'Please enter a valid email address',
  },
  attributes: {
    maxAttendees: 'maximum attendees',
  },
})
```

---

## Route Model Binding Examples

### Basic Binding (by ID)

```typescript
// Route: /projects/{project}
// Queries: SELECT * FROM projects WHERE id = :project

effectRoutes(app).get('/projects/{project}', showProject)

const showProject = action(
  Effect.gen(function* () {
    const project = yield* bound('project')
    return yield* render('Projects/Show', { project })
  })
)
```

### Binding by Slug

```typescript
// Route: /projects/{project:slug}
// Queries: SELECT * FROM projects WHERE slug = :project

effectRoutes(app).get('/projects/{project:slug}', showProject)
```

### Nested Binding (Scoped)

```typescript
// Route: /users/{user}/posts/{post}
// Queries:
//   1. SELECT * FROM users WHERE id = :user
//   2. SELECT * FROM posts WHERE id = :post AND userId = :user.id

effectRoutes(app).get('/users/{user}/posts/{post}', showUserPost)

const showUserPost = action(
  Effect.gen(function* () {
    const user = yield* bound('user')
    const post = yield* bound('post')  // Already scoped to user
    return yield* render('Users/Posts/Show', { user, post })
  })
)
```

### Mixed Notation

```typescript
// :version is a regular param, {project} is bound
effectRoutes(app).get('/api/:version/projects/{project}', showProject)

const showProject = action(
  Effect.gen(function* () {
    const request = yield* RequestService
    const version = request.param('version')  // Regular param
    const project = yield* bound('project')   // Database model
    return yield* json({ version, project })
  })
)
```

### With Param Validation

```typescript
// Validate UUID format before database lookup
effectRoutes(app).get(
  '/projects/{project}',
  showProject,
  { params: S.Struct({ project: uuid }) }
)
```

---

## Auth Examples

### Auth Routes Setup

```typescript
import { effectAuthRoutes } from 'honertia/auth'

effectAuthRoutes(app, {
  // Page components
  loginComponent: 'Auth/Login',
  registerComponent: 'Auth/Register',

  // Form actions
  loginAction: loginUser,
  registerAction: registerUser,
  logoutAction: logoutUser,

  // Paths (defaults shown)
  loginPath: '/login',
  registerPath: '/register',
  logoutPath: '/logout',
  apiPath: '/api/auth',

  // Redirects
  loginRedirect: '/',
  logoutRedirect: '/login',

  // Extended flows
  guestActions: {
    '/login/2fa': verify2FA,
    '/forgot-password': forgotPassword,
  },

  // CORS for API (if frontend on different origin)
  cors: {
    origin: ['http://localhost:5173'],
    credentials: true,
  },
})
```

### Login Action

```typescript
import { betterAuthFormAction } from 'honertia/auth'
import { Schema as S } from 'effect'
import { email, requiredString } from 'honertia/effect'

const LoginSchema = S.Struct({
  email: email,
  password: requiredString,
})

const mapLoginError = (error: { code?: string }) => {
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return { email: 'Invalid email or password' }
    case 'USER_NOT_FOUND':
      return { email: 'No account found with this email' }
    default:
      return { email: 'Login failed' }
  }
}

export const loginUser = betterAuthFormAction({
  schema: LoginSchema,
  errorComponent: 'Auth/Login',
  redirectTo: '/',
  errorMapper: mapLoginError,
  call: (auth, input, request) =>
    auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      request,
      returnHeaders: true,
    }),
})
```

### Register Action

```typescript
import { betterAuthFormAction } from 'honertia/auth'
import { Schema as S } from 'effect'
import { email, requiredString, password } from 'honertia/effect'

const RegisterSchema = S.Struct({
  name: requiredString,
  email: email,
  password: password({ min: 8, letters: true, numbers: true }),
})

const mapRegisterError = (error: { code?: string }) => {
  switch (error.code) {
    case 'USER_ALREADY_EXISTS':
      return { email: 'An account with this email already exists' }
    default:
      return { email: 'Registration failed' }
  }
}

export const registerUser = betterAuthFormAction({
  schema: RegisterSchema,
  errorComponent: 'Auth/Register',
  redirectTo: '/',
  errorMapper: mapRegisterError,
  call: (auth, input, request) =>
    auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      request,
      returnHeaders: true,
    }),
})
```

### Logout Action

```typescript
import { betterAuthLogoutAction } from 'honertia/auth'

export const logoutUser = betterAuthLogoutAction({
  redirectTo: '/login',
})
```

### Auth Layers

```typescript
import { RequireAuthLayer, RequireGuestLayer } from 'honertia/auth'

// Require logged-in user (redirects to /login if not)
effectRoutes(app)
  .provide(RequireAuthLayer)
  .group((route) => {
    route.get('/dashboard', showDashboard)
    route.get('/settings', showSettings)
  })

// Require guest (redirects to / if logged in)
effectRoutes(app)
  .provide(RequireGuestLayer)
  .group((route) => {
    route.get('/login', showLogin)
    route.get('/register', showRegister)
  })
```

### Manual Auth Check in Action

```typescript
import { authorize, isAuthenticated, currentUser } from 'honertia/effect'

// Require auth (fails if not logged in)
const auth = yield* authorize()

// Require specific role
const auth = yield* authorize((a) => a.user.role === 'admin')

// Check without failing
const isLoggedIn = yield* isAuthenticated  // boolean
const user = yield* currentUser            // AuthUser | null
```

---

## Error Handling Examples

### Throwing Errors

```typescript
import {
  notFound,
  forbidden,
  httpError,
  ValidationError,
  UnauthorizedError,
} from 'honertia/effect'

// 404 Not Found
return yield* notFound('Project', projectId)

// 403 Forbidden
return yield* forbidden('You cannot edit this project')

// Custom HTTP error
return yield* httpError(429, 'Rate limit exceeded', { retryAfter: 60 })

// Manual validation error
yield* Effect.fail(new ValidationError({
  errors: { email: 'This email is already taken' },
  component: 'Auth/Register',
}))

// Manual unauthorized
yield* Effect.fail(new UnauthorizedError({
  message: 'Session expired',
  redirectTo: '/login',
}))
```

### Error Handler Setup

```typescript
import { registerErrorHandlers } from 'honertia'

registerErrorHandlers(app, {
  component: 'Error',           // Error page component
  showDevErrors: true,          // Show details in dev
  envKey: 'ENVIRONMENT',
  devValue: 'development',
})
```

### Error Page Component

```tsx
// src/pages/Error.tsx
interface ErrorProps {
  status: number
  code: string
  title: string
  message: string
  hint?: string           // Only in dev
  fixes?: Array<{ description: string }>  // Only in dev
  source?: { file: string; line: number } // Only in dev
}

export default function Error({ status, title, message, hint, fixes }: ErrorProps) {
  return (
    <div className="error-page">
      <h1>{status}</h1>
      <h2>{title}</h2>
      <p>{message}</p>
      {hint && <p className="hint">{hint}</p>}
      {fixes?.map((fix, i) => <div key={i}>{fix.description}</div>)}
    </div>
  )
}
```

---

## Response Helpers

```typescript
import { render, redirect, json, notFound, forbidden, httpError } from 'honertia/effect'

// Render page with props
return yield* render('Projects/Index', { projects })

// Render with validation errors
return yield* renderWithErrors('Projects/Create', {
  name: 'Name is required',
})

// Redirect (303 for POST, 302 otherwise)
return yield* redirect('/projects')
return yield* redirect('/login', 302)

// JSON response
return yield* json({ success: true })
return yield* json({ error: 'Not found' }, 404)

// Error responses
return yield* notFound('Project')
return yield* forbidden('Access denied')
return yield* httpError(429, 'Rate limited')
```

---

## Services Reference

| Service | Description | Usage |
|---------|-------------|-------|
| `DatabaseService` | Drizzle database client | `const db = yield* DatabaseService` |
| `AuthService` | Better-auth instance | `const auth = yield* AuthService` |
| `AuthUserService` | Current user session | `const user = yield* AuthUserService` |
| `BindingsService` | Cloudflare bindings | `const { KV } = yield* BindingsService` |
| `RequestService` | Request context | `const req = yield* RequestService` |

### Using BindingsService

```typescript
import { BindingsService } from 'honertia/effect'

const handler = action(
  Effect.gen(function* () {
    const { KV, R2, QUEUE } = yield* BindingsService

    const cached = yield* Effect.tryPromise(() => KV.get('key'))
    yield* Effect.tryPromise(() => QUEUE.send({ type: 'event' }))

    return yield* json({ cached })
  })
)
```

---

## TypeScript Setup

```typescript
// src/types.ts
import type { Database } from '~/db/db'
import type { auth } from '~/lib/auth'
import * as schema from '~/db/schema'

export type Bindings = {
  DATABASE_URL: string
  BETTER_AUTH_SECRET: string
  KV: KVNamespace
  ENVIRONMENT?: string
}

export type Variables = {
  db: Database
  auth: typeof auth
}

export type Env = {
  Bindings: Bindings
  Variables: Variables
}

// Module augmentation for type safety
declare module 'honertia/effect' {
  interface HonertiaDatabaseType {
    type: Database
    schema: typeof schema
  }
  interface HonertiaAuthType {
    type: typeof auth
  }
  interface HonertiaBindingsType {
    type: Bindings
  }
}
```

---

## Client Setup

```tsx
// src/main.tsx
import './styles.css'
import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'

const pages = import.meta.glob('./pages/**/*.tsx')

createInertiaApp({
  resolve: (name) => {
    const page = pages[`./pages/${name}.tsx`]
    if (!page) throw new Error(`Page not found: ${name}`)
    return page()
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />)
  },
})
```

### Vite Config

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    outDir: 'dist',
    manifest: 'manifest.json',
  },
  resolve: {
    alias: { '~': path.resolve(__dirname, 'src') },
  },
})
```

---

## Environment

```toml
# wrangler.toml
[vars]
ENVIRONMENT = "production"
```

```bash
# Secrets (not in source control)
wrangler secret put DATABASE_URL
wrangler secret put BETTER_AUTH_SECRET
```

---

## Testing

Actions generated with CLI include inline tests:

```bash
# Test single action
bun test src/actions/projects/create.ts

# Test all actions in a resource
bun test src/actions/projects/

# Run project checks
honertia check --verbose
```

---

## License

MIT

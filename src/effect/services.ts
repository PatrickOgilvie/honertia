/**
 * Effect Services for Honertia
 *
 * Service tags for dependency injection via Effect.
 */

import { Context, type Effect } from 'effect'

/**
 * Augmentable interface for database type.
 * Users can extend this via module augmentation:
 *
 * @example
 * ```typescript
 * // In your project's types.d.ts or similar
 * declare module 'honertia/effect' {
 *   interface HonertiaDatabaseType {
 *     type: Database // Your database type (Drizzle, Prisma, Kysely, etc.)
 *     schema: typeof schema // Your Drizzle schema for route model binding
 *   }
 * }
 * ```
 *
 * Then use the `DatabaseService` tag to get your typed database.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HonertiaDatabaseType {}

/**
 * Error type shown when HonertiaDatabaseType.type is not configured.
 * This provides a helpful error message in IDE tooltips.
 */
interface DatabaseNotConfigured {
  readonly __error: 'DatabaseService type not configured. Add module augmentation: declare module "honertia/effect" { interface HonertiaDatabaseType { type: YourDbType } }'
  readonly __hint: 'See https://github.com/patrickogilvie/honertia#typescript-setup'
}

/**
 * Error type shown when HonertiaDatabaseType.schema is not configured.
 */
interface SchemaNotConfigured {
  readonly __error: 'Schema not configured for route model binding. Add module augmentation: declare module "honertia/effect" { interface HonertiaDatabaseType { schema: typeof schema } }'
  readonly __hint: 'This is optional - only needed if using bound() for route model binding'
}

/** Extract database type from augmented interface, shows error type if not configured */
export type DatabaseType = HonertiaDatabaseType extends { type: infer T } ? T : DatabaseNotConfigured

/** Extract schema type from augmented interface, shows error type if not configured */
export type SchemaType = HonertiaDatabaseType extends { schema: infer T } ? T : SchemaNotConfigured

/**
 * Augmentable interface for auth type.
 * Users can extend this via module augmentation:
 *
 * @example
 * ```typescript
 * declare module 'honertia/effect' {
 *   interface HonertiaAuthType {
 *     type: ReturnType<typeof betterAuth> // Your auth instance type
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HonertiaAuthType {}

/**
 * Error type shown when HonertiaAuthType.type is not configured.
 */
interface AuthNotConfigured {
  readonly __error: 'AuthService type not configured. Add module augmentation: declare module "honertia/effect" { interface HonertiaAuthType { type: YourAuthType } }'
  readonly __hint: 'This is optional - only needed if using AuthService'
}

/** Extract auth type from augmented interface, shows error type if not configured */
export type AuthType = HonertiaAuthType extends { type: infer T } ? T : AuthNotConfigured

/**
 * Augmentable interface for environment bindings type.
 * Users can extend this via module augmentation:
 *
 * @example
 * ```typescript
 * declare module 'honertia/effect' {
 *   interface HonertiaBindingsType {
 *     type: {
 *       DB: D1Database
 *       KV: KVNamespace
 *       ANALYTICS: AnalyticsEngineDataset
 *     }
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HonertiaBindingsType {}

/**
 * Error type shown when HonertiaBindingsType.type is not configured.
 */
interface BindingsNotConfigured {
  readonly __error: 'BindingsService type not configured. Add module augmentation: declare module "honertia/effect" { interface HonertiaBindingsType { type: YourBindingsType } }'
  readonly __hint: 'This is optional - BindingsService will still work but be typed as Record<string, unknown>'
}

/** Extract bindings type from augmented interface, defaults to Record<string, unknown> if not configured */
export type BindingsType = HonertiaBindingsType extends { type: infer T }
  ? T
  : Record<string, unknown>

/**
 * Database Service - Generic database client
 */
const DatabaseService_base: Context.TagClass<
  DatabaseService,
  'honertia/Database',
  DatabaseType
> = Context.Tag('honertia/Database')<DatabaseService, DatabaseType>()

export class DatabaseService extends DatabaseService_base {}

/**
 * Auth Service - Better-auth instance
 */
const AuthService_base: Context.TagClass<
  AuthService,
  'honertia/Auth',
  AuthType
> = Context.Tag('honertia/Auth')<AuthService, AuthType>()

export class AuthService extends AuthService_base {}

/**
 * Bindings Service - Environment bindings (Cloudflare D1, KV, R2, etc.)
 *
 * Automatically provided by setupHonertia. Use module augmentation for type safety:
 *
 * @example
 * ```typescript
 * // In your types.d.ts
 * declare module 'honertia/effect' {
 *   interface HonertiaBindingsType {
 *     type: { DB: D1Database; KV: KVNamespace }
 *   }
 * }
 *
 * // In your action
 * const { KV, DB } = yield* BindingsService
 * ```
 */
const BindingsService_base: Context.TagClass<
  BindingsService,
  'honertia/Bindings',
  BindingsType
> = Context.Tag('honertia/Bindings')<BindingsService, BindingsType>()

export class BindingsService extends BindingsService_base {}

/**
 * Authenticated User - Session with user data
 */
export interface AuthUser {
  user: {
    id: string
    email: string
    name: string | null
    emailVerified: boolean
    image: string | null
    createdAt: Date
    updatedAt: Date
  }
  session: {
    id: string
    userId: string
    expiresAt: Date
    token: string
    createdAt: Date
    updatedAt: Date
  }
}

export class AuthUserService extends Context.Tag('honertia/AuthUser')<
  AuthUserService,
  AuthUser
>() {}

/**
 * Email Service - Outbound email delivery
 */
export interface EmailClient {
  send: (to: string, subject: string, body: string) => Effect.Effect<void, Error>
}

export class EmailService extends Context.Tag('honertia/Email')<
  EmailService,
  EmailClient
>() {}

/**
 * Honertia Renderer - Inertia-style page rendering
 */
export interface HonertiaRenderer {
  render<T extends Record<string, unknown>>(
    component: string,
    props?: T
  ): Promise<Response>
  share(key: string, value: unknown): void
  setErrors(errors: Record<string, string>): void
}

export class HonertiaService extends Context.Tag('honertia/Honertia')<
  HonertiaService,
  HonertiaRenderer
>() {}

/**
 * Request Context - HTTP request data and environment bindings
 */
export interface RequestContext<Bindings = Record<string, unknown>> {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  /**
   * Environment bindings (Cloudflare D1, KV, R2, etc.)
   * Access via: `request.env.DB`, `request.env.KV`, etc.
   *
   * For full type safety, cast to your Bindings type:
   * ```typescript
   * const { DB, KV } = request.env as Bindings
   * ```
   */
  readonly env: Bindings
  param(name: string): string | undefined
  params(): Record<string, string>
  query(): Record<string, string>
  json<T = unknown>(): Promise<T>
  parseBody(): Promise<Record<string, unknown>>
  header(name: string): string | undefined
}

export class RequestService extends Context.Tag('honertia/Request')<
  RequestService,
  RequestContext
>() {}

/**
 * Response Factory - Create HTTP responses
 */
export interface ResponseFactory {
  redirect(url: string, status?: number): Response
  json<T>(data: T, status?: number): Response
  text(data: string, status?: number): Response
  notFound(): Response | Promise<Response>
}

export class ResponseFactoryService extends Context.Tag('honertia/ResponseFactory')<
  ResponseFactoryService,
  ResponseFactory
>() {}

/**
 * Cache Service - KV-backed caching for expensive operations
 *
 * Automatically provided by setupHonertia when KV binding is available.
 * Falls back to a no-op implementation if KV is not configured.
 *
 * @example
 * ```typescript
 * // In your action
 * const cacheService = yield* CacheService
 * const cached = yield* cacheService.get('user:123')
 * ```
 */
export interface CacheClient {
  get(key: string): Effect.Effect<string | null, CacheClientError>
  put(key: string, value: string, options?: { expirationTtl?: number }): Effect.Effect<void, CacheClientError>
  delete(key: string): Effect.Effect<void, CacheClientError>
  list(options?: { prefix?: string }): Effect.Effect<{ keys: Array<{ name: string }> }, CacheClientError>
}

/**
 * Error from cache client operations.
 */
export class CacheClientError {
  readonly _tag = 'CacheClientError'
  constructor(
    readonly reason: string,
    readonly cause?: unknown
  ) {}
}

export class CacheService extends Context.Tag('honertia/Cache')<
  CacheService,
  CacheClient
>() {}

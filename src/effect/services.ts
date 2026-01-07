/**
 * Effect Services for Honertia
 *
 * Service tags for dependency injection via Effect.
 */

import { Context } from 'effect'

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

/** Extract database type from augmented interface, defaults to unknown */
export type DatabaseType = HonertiaDatabaseType extends { type: infer T } ? T : unknown

/** Extract schema type from augmented interface, defaults to Record<string, unknown> */
export type SchemaType = HonertiaDatabaseType extends { schema: infer T } ? T : Record<string, unknown>

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

/** Extract auth type from augmented interface, defaults to unknown */
export type AuthType = HonertiaAuthType extends { type: infer T } ? T : unknown

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
 * Request Context - HTTP request data
 */
export interface RequestContext {
  readonly method: string
  readonly url: string
  readonly headers: Headers
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

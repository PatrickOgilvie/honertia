/**
 * Effect Services for Honertia
 *
 * Service tags for dependency injection via Effect.
 */

import { Context, Effect } from 'effect'

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
 *   }
 * }
 * ```
 *
 * Then `DatabaseService` will be typed as your `Database` type.
 */
export interface HonertiaDatabaseType {
  type: unknown
}

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
export interface HonertiaAuthType {
  type: unknown
}

/**
 * Database Service - Generic database client
 *
 * By default typed as `unknown`. Use module augmentation on
 * `HonertiaDatabaseType` to provide your database type.
 */
export class DatabaseService extends Context.Tag('honertia/Database')<
  DatabaseService,
  HonertiaDatabaseType['type']
>() {}

/**
 * Auth Service - Better-auth instance
 *
 * By default typed as `unknown`. Use module augmentation on
 * `HonertiaAuthType` to provide your auth type.
 */
export class AuthService extends Context.Tag('honertia/Auth')<
  AuthService,
  HonertiaAuthType['type']
>() {}

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

/**
 * Effect Services for Honertia
 *
 * Service tags for dependency injection via Effect.
 */

import { Context, Effect } from 'effect'

/**
 * Database Service - Generic database client
 */
export class DatabaseService extends Context.Tag('honertia/Database')<
  DatabaseService,
  unknown
>() {}

/**
 * Auth Service - Better-auth instance
 */
export class AuthService extends Context.Tag('honertia/Auth')<
  AuthService,
  unknown
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

/**
 * Effect Route Builder
 *
 * Laravel-style routing with Effect handlers.
 */

import { Effect, Exit, Layer, Schema as S } from 'effect'
import type { Context as HonoContext, Hono, MiddlewareHandler, Env } from 'hono'
import { effectHandler } from './handler.js'
import { buildContextLayer, type EffectBridgeConfig } from './bridge.js'
import {
  type AppError,
  Redirect,
} from './errors.js'
import {
  DatabaseService,
  AuthService,
  HonertiaService,
  RequestService,
  ResponseFactoryService,
} from './services.js'

/**
 * Type for Effect-based route handlers.
 * Error type includes Error for compatibility with Effect.tryPromise.
 */
export type EffectHandler<R = never, E extends AppError | Error = AppError | Error> = Effect.Effect<
  Response | Redirect,
  E,
  R
>

/**
 * Base services available in every route.
 */
export type BaseServices =
  | RequestService
  | ResponseFactoryService
  | HonertiaService
  | DatabaseService
  | AuthService

/**
 * Route-level configuration options.
 */
export interface EffectRouteOptions {
  /**
   * Validate route params with the provided schema.
   * Invalid values will return a 404 before the handler runs.
   */
  params?: S.Schema<Record<string, string>, Record<string, string>>
}

/**
 * Effect Route Builder with layer composition.
 */
export class EffectRouteBuilder<
  E extends Env,
  ProvidedServices = never,
  CustomServices = never
> {
  constructor(
    private readonly app: Hono<E>,
    private readonly layers: Layer.Layer<any, never, never>[] = [],
    private readonly pathPrefix: string = '',
    private readonly bridgeConfig?: EffectBridgeConfig<E, CustomServices>
  ) {}

  /**
   * Add a layer to provide services to all routes in this builder.
   * The layer's error type must be handled by the effect bridge (AppError or subtype).
   */
  provide<S, LayerErr extends AppError>(
    layer: Layer.Layer<S, LayerErr, never>
  ): EffectRouteBuilder<E, ProvidedServices | S, CustomServices> {
    return new EffectRouteBuilder(
      this.app,
      [...this.layers, layer as Layer.Layer<S, never, never>],
      this.pathPrefix,
      this.bridgeConfig
    )
  }

  /**
   * Set path prefix for all routes in this builder.
   */
  prefix(path: string): EffectRouteBuilder<E, ProvidedServices, CustomServices> {
    const normalizedPath = path.replace(/\/$/, '')
    return new EffectRouteBuilder(
      this.app,
      this.layers,
      this.pathPrefix + normalizedPath,
      this.bridgeConfig
    )
  }

  /**
   * Create a nested group with the same configuration.
   */
  group(callback: (route: EffectRouteBuilder<E, ProvidedServices, CustomServices>) => void): void {
    callback(this)
  }

  /**
   * Resolve the full path.
   */
  private resolvePath(path: string): string {
    if (this.pathPrefix) {
      return path === '/' ? this.pathPrefix : `${this.pathPrefix}${path}`
    }
    return path
  }

  /**
   * Create a Hono handler from an Effect.
   */
  private async ensureParams(
    c: HonoContext<E>,
    schema?: S.Schema<Record<string, string>, Record<string, string>>
  ): Promise<Response | null> {
    if (!schema) return null

    const rawParams = c.req.param()
    const params: Record<string, string> =
      typeof rawParams === 'string' ? {} : rawParams

    const exit = await Effect.runPromiseExit(S.decodeUnknown(schema)(params))

    if (Exit.isFailure(exit)) {
      return c.notFound() as Response
    }

    return null
  }

  private createHandler<R extends BaseServices | ProvidedServices | CustomServices>(
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): MiddlewareHandler<E> {
    const layers = this.layers
    const bridgeConfig = this.bridgeConfig

    return async (c) => {
      const validation = await this.ensureParams(c, options?.params)
      if (validation) return validation

      // Build context layer from Hono context
      const contextLayer = buildContextLayer(c, bridgeConfig)

      // Combine with provided layers
      let fullLayer: Layer.Layer<any, never, never> = contextLayer
      for (const layer of layers) {
        fullLayer = Layer.merge(fullLayer, layer)
      }

      // Run the effect with the combined layer
      const program = effect.pipe(Effect.provide(fullLayer))

      // Use the handler
      return effectHandler<E, never, AppError>(program as any)(c, async () => {})
    }
  }

  /**
   * Register a GET route.
   */
  get<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.app.get(
      this.resolvePath(path),
      this.createHandler(effect, options)
    )
  }

  /**
   * Register a POST route.
   */
  post<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.app.post(
      this.resolvePath(path),
      this.createHandler(effect, options)
    )
  }

  /**
   * Register a PUT route.
   */
  put<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.app.put(
      this.resolvePath(path),
      this.createHandler(effect, options)
    )
  }

  /**
   * Register a PATCH route.
   */
  patch<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.app.patch(
      this.resolvePath(path),
      this.createHandler(effect, options)
    )
  }

  /**
   * Register a DELETE route.
   */
  delete<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.app.delete(
      this.resolvePath(path),
      this.createHandler(effect, options)
    )
  }

  /**
   * Register a route for all HTTP methods.
   */
  all<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.app.all(
      this.resolvePath(path),
      this.createHandler(effect, options)
    )
  }
}

/**
 * Create an Effect route builder for an app.
 *
 * @example
 * effectRoutes(app)
 *   .provide(RequireAuthLayer)
 *   .prefix('/dashboard')
 *   .group((route) => {
 *     route.get('/', showDashboard)
 *     route.get('/projects', listProjects)
 *     route.post('/projects', createProject)
 *   })
 */
export function effectRoutes<E extends Env, CustomServices = never>(
  app: Hono<E>,
  config?: EffectBridgeConfig<E, CustomServices>
): EffectRouteBuilder<E, never, CustomServices> {
  return new EffectRouteBuilder(app, [], '', config)
}

/**
 * Effect Route Builder
 *
 * Laravel-style routing with Effect handlers.
 */

import { Effect, Layer } from 'effect'
import type { Hono, MiddlewareHandler, Env } from 'hono'
import { effectHandler } from './handler.js'
import { buildContextLayer, type EffectBridgeConfig } from './bridge.js'
import type { AppError } from './errors.js'
import { Redirect } from './errors.js'
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
  private createHandler<R extends BaseServices | ProvidedServices | CustomServices>(
    effect: EffectHandler<R, AppError | Error>
  ): MiddlewareHandler<E> {
    const layers = this.layers
    const bridgeConfig = this.bridgeConfig

    return async (c) => {
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
  get<R extends BaseServices | ProvidedServices | CustomServices>(    path: string,
    effect: EffectHandler<R, AppError | Error>
  ): void {
    this.app.get(this.resolvePath(path), this.createHandler(effect))
  }

  /**
   * Register a POST route.
   */
  post<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>
  ): void {
    this.app.post(this.resolvePath(path), this.createHandler(effect))
  }

  /**
   * Register a PUT route.
   */
  put<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>
  ): void {
    this.app.put(this.resolvePath(path), this.createHandler(effect))
  }

  /**
   * Register a PATCH route.
   */
  patch<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>
  ): void {
    this.app.patch(this.resolvePath(path), this.createHandler(effect))
  }

  /**
   * Register a DELETE route.
   */
  delete<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>
  ): void {
    this.app.delete(this.resolvePath(path), this.createHandler(effect))
  }

  /**
   * Register a route for all HTTP methods.
   */
  all<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>
  ): void {
    this.app.all(this.resolvePath(path), this.createHandler(effect))
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

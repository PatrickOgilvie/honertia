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
import {
  parseBindings,
  toHonoPath,
  pluralize,
  findRelation,
  BoundModels,
  type ParsedBinding,
} from './binding.js'

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
  | BoundModels

/**
 * Route-level configuration options.
 */
export interface EffectRouteOptions {
  /**
   * Validate route params with the provided schema.
   * Invalid values will return a 404 before the handler runs.
   *
   * @example
   * ```typescript
   * effectRoutes(app).get(
   *   '/projects/{project}',
   *   showProject,
   *   { params: S.Struct({ project: uuid }) }
   * )
   * ```
   */
  params?: S.Schema.Any
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
   * Validate route params against a schema.
   */
  private async ensureParams(
    c: HonoContext<E>,
    schema?: S.Schema.Any
  ): Promise<Response | null> {
    if (!schema) return null

    const rawParams = c.req.param()
    const params: Record<string, string> =
      typeof rawParams === 'string' ? {} : rawParams

    const decode = S.decodeUnknown(schema)
    const exit = await Effect.runPromiseExit(decode(params) as Effect.Effect<unknown, unknown, never>)

    if (Exit.isFailure(exit)) {
      return c.notFound() as Response
    }

    return null
  }

  /**
   * Resolve route model bindings from the database.
   * Returns a Map of binding names to resolved models, or a 404 Response if any binding fails.
   */
  private async resolveBindings(
    c: HonoContext<E>,
    bindings: ParsedBinding[],
    db: unknown,
    schema: Record<string, unknown>
  ): Promise<Map<string, unknown> | Response> {
    if (bindings.length === 0) {
      return new Map()
    }

    // Dynamic import to avoid requiring drizzle-orm for non-binding users
    const { eq } = await import('drizzle-orm')

    const models = new Map<string, unknown>()
    let parent: { tableName: string; model: Record<string, unknown> } | null = null

    for (const binding of bindings) {
      const tableName = pluralize(binding.param)
      const table = schema[tableName] as Record<string, unknown> | undefined

      if (!table) {
        return c.notFound() as Response
      }

      const paramValue = c.req.param(binding.param)
      if (!paramValue) {
        return c.notFound() as Response
      }

      // Build query with primary lookup
      const column = table[binding.column]
      if (!column) {
        return c.notFound() as Response
      }

      type QueryBuilder = { where: (c: unknown) => QueryBuilder; get: () => Promise<unknown> }
      const dbClient = db as { select: () => { from: (t: unknown) => QueryBuilder } }
      let query: QueryBuilder = dbClient.select().from(table).where(eq(column as Parameters<typeof eq>[0], paramValue))

      // If we have a parent, try to scope the query
      if (parent) {
        const relation = findRelation(schema, tableName, parent.tableName)
        if (relation) {
          const foreignKeyColumn = table[relation.foreignKey]
          if (foreignKeyColumn && parent.model[relation.references]) {
            query = query.where(eq(foreignKeyColumn as Parameters<typeof eq>[0], parent.model[relation.references]))
          }
        }
      }

      // Execute the query
      const result = await query.get()

      if (!result) {
        return c.notFound() as Response
      }

      models.set(binding.param, result)
      parent = { tableName, model: result as Record<string, unknown> }
    }

    return models
  }

  private createHandler<R extends BaseServices | ProvidedServices | CustomServices>(
    effect: EffectHandler<R, AppError | Error>,
    bindings: ParsedBinding[],
    options?: EffectRouteOptions
  ): MiddlewareHandler<E> {
    const layers = this.layers
    const bridgeConfig = this.bridgeConfig

    return async (c) => {
      const validation = await this.ensureParams(c, options?.params)
      if (validation) return validation

      // Build context layer from Hono context
      const contextLayer = buildContextLayer(c, bridgeConfig)

      // Resolve route model bindings if we have any and schema is configured
      let boundModelsLayer: Layer.Layer<BoundModels, never, never>

      if (bindings.length > 0 && bridgeConfig?.schema) {
        const db = bridgeConfig.database ? bridgeConfig.database(c) : (c as { var?: { db?: unknown } }).var?.db
        if (!db) {
          return c.notFound() as Response
        }

        const result = await this.resolveBindings(c, bindings, db, bridgeConfig.schema)
        if (result instanceof Response) {
          return result
        }

        boundModelsLayer = Layer.succeed(BoundModels, result as ReadonlyMap<string, unknown>)
      } else if (bindings.length > 0 && !bridgeConfig?.schema) {
        // Bindings exist but no schema - provide a map that signals this for better errors
        const unconfiguredMap = new Map<string, unknown>()
        unconfiguredMap.set('__schema_not_configured__', true)
        boundModelsLayer = Layer.succeed(BoundModels, unconfiguredMap as ReadonlyMap<string, unknown>)
      } else {
        // No bindings - empty bound models
        boundModelsLayer = Layer.succeed(BoundModels, new Map() as ReadonlyMap<string, unknown>)
      }

      // Combine with provided layers
      let fullLayer: Layer.Layer<any, never, never> = Layer.merge(contextLayer, boundModelsLayer)
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
   * Register a route with the given HTTP method.
   * Parses Laravel-style bindings and converts to Hono path format.
   */
  private registerRoute<R extends BaseServices | ProvidedServices | CustomServices>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'all',
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    const bindings = parseBindings(path)
    const honoPath = toHonoPath(path)
    this.app[method](this.resolvePath(honoPath), this.createHandler(effect, bindings, options))
  }

  /** Register a GET route. Supports Laravel-style route model binding: /projects/{project} */
  get<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.registerRoute('get', path, effect, options)
  }

  /** Register a POST route. Supports Laravel-style route model binding: /projects/{project} */
  post<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.registerRoute('post', path, effect, options)
  }

  /** Register a PUT route. Supports Laravel-style route model binding: /projects/{project} */
  put<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.registerRoute('put', path, effect, options)
  }

  /** Register a PATCH route. Supports Laravel-style route model binding: /projects/{project} */
  patch<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.registerRoute('patch', path, effect, options)
  }

  /** Register a DELETE route. Supports Laravel-style route model binding: /projects/{project} */
  delete<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.registerRoute('delete', path, effect, options)
  }

  /** Register a route for all HTTP methods. Supports Laravel-style route model binding: /projects/{project} */
  all<R extends BaseServices | ProvidedServices | CustomServices>(
    path: string,
    effect: EffectHandler<R, AppError | Error>,
    options?: EffectRouteOptions
  ): void {
    this.registerRoute('all', path, effect, options)
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

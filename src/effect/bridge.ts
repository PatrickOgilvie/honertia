/**
 * Hono-Effect Bridge
 *
 * Middleware that connects Hono's request handling to Effect's runtime.
 */

import { Layer, ManagedRuntime } from 'effect'
import { HonertiaConfigurationError } from './errors.js'
import type { Context as HonoContext, MiddlewareHandler, Env } from 'hono'
import {
  DatabaseService,
  AuthService,
  AuthUserService,
  HonertiaService,
  RequestService,
  ResponseFactoryService,
  type AuthUser,
  type RequestContext,
  type ResponseFactory,
  type HonertiaRenderer,
  type DatabaseType,
  type AuthType,
} from './services.js'

/**
 * Configuration for the Effect bridge.
 *
 * @typeParam E - Hono environment type
 * @typeParam CustomServices - Custom services provided via the `services` option
 *
 * @example
 * // Provide Cloudflare Worker bindings as a service
 * effectBridge<Env, BindingsService>({
 *   services: (c) => Layer.succeed(BindingsService, c.env),
 * })
 *
 * @example
 * // Provide multiple custom services
 * effectBridge<Env, BindingsService | LoggerService>({
 *   services: (c) => Layer.mergeAll(
 *     Layer.succeed(BindingsService, c.env),
 *     Layer.succeed(LoggerService, createLogger(c)),
 *   ),
 * })
 */
export interface EffectBridgeConfig<E extends Env, CustomServices = never> {
  /**
   * Custom services to provide to all Effect handlers.
   * Return a Layer that provides your custom services.
   */
  services?: (c: HonoContext<E>) => Layer.Layer<CustomServices, never, never>
  /**
   * Drizzle schema for route model binding.
   * Usually configured via `setupHonertia({ honertia: { schema } })`.
   * Can also be passed here for standalone effectBridge usage.
   */
  schema?: Record<string, unknown>
}

/**
 * Symbol for storing Effect runtime in Hono context.
 */
const EFFECT_RUNTIME = Symbol('effectRuntime')

/**
 * Symbol for storing schema in Hono context.
 */
const EFFECT_SCHEMA = Symbol('effectSchema')

/**
 * Creates a proxy that throws a helpful error when any property is accessed.
 * Used when a service (database, auth) is not configured but the user tries to use it.
 */
function createUnconfiguredServiceProxy(
  serviceName: string,
  configPath: string,
  example: string
): unknown {
  const message = `${serviceName} is not configured. Add it to setupHonertia: setupHonertia({ honertia: { ${configPath} } })`

  return new Proxy(
    {},
    {
      get(_, prop) {
        // Allow certain properties that might be checked without meaning to "use" the service
        if (prop === 'then' || prop === Symbol.toStringTag || prop === Symbol.iterator) {
          return undefined
        }
        throw new HonertiaConfigurationError({
          message,
          hint: `Example: ${example}`,
        })
      },
    }
  )
}

/**
 * Extend Hono context with Effect runtime and schema.
 */
declare module 'hono' {
  interface ContextVariableMap {
    [EFFECT_RUNTIME]?: ManagedRuntime.ManagedRuntime<
      | DatabaseService
      | AuthService
      | AuthUserService
      | HonertiaService
      | RequestService
      | ResponseFactoryService,
      never
    >
    [EFFECT_SCHEMA]?: Record<string, unknown>
  }
}

/**
 * Create a RequestContext from Hono context.
 */
function createRequestContext<E extends Env>(c: HonoContext<E>): RequestContext {
  return {
    method: c.req.method,
    url: c.req.url,
    headers: c.req.raw.headers,
    param: (name: string) => c.req.param(name),
    params: () => {
      const params = c.req.param()
      return typeof params === 'string' ? {} : params
    },
    query: () => c.req.query(),
    json: <T>() => c.req.json<T>(),
    parseBody: () => c.req.parseBody() as Promise<Record<string, unknown>>,
    header: (name: string) => c.req.header(name),
  }
}

/**
 * Create a ResponseFactory from Hono context.
 */
function createResponseFactory<E extends Env>(c: HonoContext<E>): ResponseFactory {
  return {
    redirect: (url: string, status = 302) => c.redirect(url, status as 301 | 302 | 303 | 307 | 308),
    json: <T>(data: T, status = 200) => c.json(data, status as any),
    text: (data: string, status = 200) => c.text(data, status as any),
    notFound: () => c.notFound(),
  }
}

/**
 * Create a HonertiaRenderer from Hono context.
 */
function createHonertiaRenderer<E extends Env>(c: HonoContext<E>): HonertiaRenderer {
  const honertia = (c as any).var?.honertia
  if (!honertia) {
    return {
      render: async () => c.text('Honertia not configured', 500),
      share: () => {},
      setErrors: () => {},
    }
  }
  return {
    render: (component, props) => honertia.render(component, props),
    share: (key, value) => honertia.share(key, value),
    setErrors: (errors) => honertia.setErrors(errors),
  }
}

/**
 * Build the Effect layer from Hono context.
 */
export function buildContextLayer<E extends Env, CustomServices = never>(
  c: HonoContext<E>,
  config?: EffectBridgeConfig<E, CustomServices>
): Layer.Layer<
  | RequestService
  | ResponseFactoryService
  | HonertiaService
  | DatabaseService
  | AuthService
  | AuthUserService
  | CustomServices,
  never,
  never
> {
  const requestLayer = Layer.succeed(RequestService, createRequestContext(c))
  const responseLayer = Layer.succeed(ResponseFactoryService, createResponseFactory(c))
  const honertiaLayer = Layer.succeed(HonertiaService, createHonertiaRenderer(c))

  // Database layer - provide helpful error proxy if not configured
  const db = (c as any).var?.db
  const databaseLayer = Layer.succeed(
    DatabaseService,
    (db ??
      createUnconfiguredServiceProxy(
        'DatabaseService',
        'database: (c) => createDb(...)',
        'database: (c) => drizzle(c.env.DB)'
      )) as DatabaseType
  )

  // Auth layer - provide helpful error proxy if not configured
  const auth = (c as any).var?.auth
  const authLayer = Layer.succeed(
    AuthService,
    (auth ??
      createUnconfiguredServiceProxy(
        'AuthService',
        'auth: (c) => createAuth(...)',
        'auth: (c) => betterAuth({ database: c.var.db, ... })'
      )) as AuthType
  )

  let baseLayer = Layer.mergeAll(
    requestLayer,
    responseLayer,
    honertiaLayer,
    databaseLayer,
    authLayer
  )

  if ((c as any).var?.authUser) {
    baseLayer = Layer.merge(baseLayer, Layer.succeed(AuthUserService, (c as any).var.authUser as AuthUser))
  }

  // Merge custom services if provided
  if (config?.services) {
    const customServicesLayer = config.services(c)
    baseLayer = Layer.merge(baseLayer, customServicesLayer)
  }

  return baseLayer as Layer.Layer<
    | RequestService
    | ResponseFactoryService
    | HonertiaService
    | DatabaseService
    | AuthService
    | AuthUserService
    | CustomServices,
    never,
    never
  >
}

/**
 * Get the Effect runtime from Hono context.
 */
export function getEffectRuntime<E extends Env>(
  c: HonoContext<E>
): ManagedRuntime.ManagedRuntime<any, never> | undefined {
  return (c as any).var?.[EFFECT_RUNTIME]
}

/**
 * Middleware that sets up the Effect runtime for each request.
 */
export function effectBridge<E extends Env, CustomServices = never>(
  config?: EffectBridgeConfig<E, CustomServices>
): MiddlewareHandler<E> {
  return async (c, next) => {
    const layer = buildContextLayer(c, config)
    const runtime = ManagedRuntime.make(layer)

    // Store runtime in context
    c.set(EFFECT_RUNTIME as any, runtime)

    // Store schema in context for route model binding
    if (config?.schema) {
      c.set(EFFECT_SCHEMA as any, config.schema)
    }

    try {
      await next()
    } finally {
      // Cleanup runtime after request
      await runtime.dispose()
    }
  }
}

/**
 * Get the schema from Hono context (set by effectBridge).
 */
export function getEffectSchema<E extends Env>(
  c: HonoContext<E>
): Record<string, unknown> | undefined {
  return (c as any).var?.[EFFECT_SCHEMA]
}

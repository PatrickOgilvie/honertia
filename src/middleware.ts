/**
 * Honertia Middleware
 */

import type { Context, MiddlewareHandler } from 'hono'
import type { HonertiaConfig, HonertiaInstance, PageObject, RenderOptions } from './types.js'
import { HEADERS } from './types.js'

declare module 'hono' {
  interface ContextVariableMap {
    honertia: HonertiaInstance
  }
}

async function resolveValue<T>(value: T | (() => T | Promise<T>)): Promise<T> {
  if (typeof value === 'function') {
    return await (value as () => T | Promise<T>)()
  }
  return value
}

function filterPartialProps(
  props: Record<string, unknown>,
  include?: string,
  exclude?: string
): Record<string, unknown> {
  let filteredProps = { ...props }

  if (include) {
    const includeKeys = include.split(',').map(k => k.trim())
    filteredProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => 
        includeKeys.includes(key) || key === 'errors'
      )
    )
  }

  if (exclude) {
    const excludeKeys = exclude.split(',').map(k => k.trim())
    filteredProps = Object.fromEntries(
      Object.entries(filteredProps).filter(([key]) => 
        !excludeKeys.includes(key) || key === 'errors'
      )
    )
  }

  return filteredProps
}

export function honertia(config: HonertiaConfig): MiddlewareHandler {
  return async (c: Context, next) => {
    const sharedProps: Record<string, unknown | (() => unknown | Promise<unknown>)> = {}
    let errors: Record<string, string> = {}

    const getVersion = () => 
      typeof config.version === 'function' ? config.version() : config.version

    const isHonertia = c.req.header(HEADERS.HONERTIA) === 'true'
    const clientVersion = c.req.header(HEADERS.VERSION)
    const version = getVersion()

    // Version mismatch - force full reload
    if (isHonertia && clientVersion && clientVersion !== version && c.req.method === 'GET') {
      return c.body(null, {
        status: 409,
        headers: { [HEADERS.LOCATION]: c.req.url },
      })
    }

    const instance: HonertiaInstance = {
      share(key: string, value: unknown | (() => unknown | Promise<unknown>)) {
        sharedProps[key] = value
      },

      getShared() {
        return { ...sharedProps }
      },

      setErrors(newErrors: Record<string, string>) {
        errors = { ...errors, ...newErrors }
      },

      async render<T extends Record<string, unknown>>(
        component: string,
        props: T = {} as T,
        options: RenderOptions = {}
      ): Promise<Response> {
        // Resolve lazy shared props
        const resolvedShared: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(sharedProps)) {
          resolvedShared[key] = await resolveValue(value)
        }

        let mergedProps: Record<string, unknown> = {
          ...resolvedShared,
          ...props,
        }

        // Add errors
        if (Object.keys(errors).length > 0) {
          mergedProps.errors = { 
            ...(mergedProps.errors as Record<string, string> || {}),
            ...errors 
          }
        }
        if (!mergedProps.errors) {
          mergedProps.errors = {}
        }

        // Handle partial reloads
        if (isHonertia) {
          const partialComponent = c.req.header(HEADERS.PARTIAL_COMPONENT)
          const partialData = c.req.header(HEADERS.PARTIAL_DATA)
          const partialExcept = c.req.header(HEADERS.PARTIAL_EXCEPT)

          if (partialComponent === component && (partialData || partialExcept)) {
            mergedProps = filterPartialProps(mergedProps, partialData, partialExcept)
          }
        }

        const page: PageObject = {
          component,
          props: mergedProps as Record<string, unknown> & { errors?: Record<string, string> },
          url: new URL(c.req.url).pathname + new URL(c.req.url).search,
          version,
          ...(options.clearHistory !== undefined && { clearHistory: options.clearHistory }),
          ...(options.encryptHistory !== undefined && { encryptHistory: options.encryptHistory }),
        }

        if (isHonertia) {
          return c.json(page, 200, {
            [HEADERS.HONERTIA]: 'true',
            'Vary': HEADERS.HONERTIA,
          })
        }

        const html = await config.render(page, c)
        return c.html(html, 200, {
          'Vary': HEADERS.HONERTIA,
        })
      },
    }

    c.set('honertia', instance)
    await next()

    // Convert 302 to 303 for non-GET requests
    // Guard against c.res being undefined (no handler matched)
    if (
      isHonertia &&
      c.res &&
      c.res.status === 302 &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)
    ) {
      const location = c.res.headers.get('Location')
      if (location) {
        c.res = new Response(null, {
          status: 303,
          headers: { 'Location': location, 'Vary': HEADERS.HONERTIA },
        })
      }
    }
  }
}

export { HEADERS }

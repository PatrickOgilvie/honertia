/**
 * Route Model Binding
 *
 * Laravel-style route model binding for Effect routes.
 * Automatically resolves route parameters to database models.
 */

import { Context, Data, Effect } from 'effect'
import type { Table } from 'drizzle-orm'
import type { HonertiaDatabaseType } from './services.js'

/**
 * Error thrown when a bound model is not found in the BoundModels context.
 * This indicates a programming error - the binding key doesn't match any resolved model.
 */
export class BoundModelNotFound extends Data.TaggedError('BoundModelNotFound')<{
  readonly key: string
}> {
  get message() {
    return `No bound model found for key: '${this.key}'. Ensure the route uses {${this.key}} binding syntax.`
  }
}

/**
 * Parsed binding from route path.
 */
export interface ParsedBinding {
  /** The parameter name (e.g., 'project' from '{project}') */
  param: string
  /** The column to query (e.g., 'id' or 'slug' from '{project:slug}') */
  column: string
}

/**
 * Parse Laravel-style bindings from a route path.
 *
 * @example
 * parseBindings('/users/{user}/posts/{post:slug}')
 * // => [{ param: 'user', column: 'id' }, { param: 'post', column: 'slug' }]
 */
export function parseBindings(path: string): ParsedBinding[] {
  const regex = /\{(\w+)(?::(\w+))?\}/g
  const bindings: ParsedBinding[] = []
  let match

  while ((match = regex.exec(path)) !== null) {
    bindings.push({
      param: match[1],
      column: match[2] ?? 'id',
    })
  }

  return bindings
}

/**
 * Convert Laravel-style route to Hono-style route.
 *
 * @example
 * toHonoPath('/users/{user}/posts/{post:slug}')
 * // => '/users/:user/posts/:post'
 */
export function toHonoPath(path: string): string {
  return path.replace(/\{(\w+)(?::\w+)?\}/g, ':$1')
}

/**
 * Service tag for bound models.
 * Provides access to resolved route models in handlers.
 */
export class BoundModels extends Context.Tag('honertia/BoundModels')<
  BoundModels,
  ReadonlyMap<string, unknown>
>() {}

/**
 * Type-safe accessor for bound models.
 *
 * @example
 * const showProject = Effect.gen(function* () {
 *   const project = yield* bound('project')
 *   return inertia('Projects/Show', { project })
 * })
 */
export const bound = <K extends string>(
  key: K
): Effect.Effect<
  K extends keyof HonertiaDatabaseType['schema']
    ? HonertiaDatabaseType['schema'][K] extends Table
      ? HonertiaDatabaseType['schema'][K]['$inferSelect']
      : unknown
    : unknown,
  BoundModelNotFound,
  BoundModels
> =>
  Effect.gen(function* () {
    const models = yield* BoundModels
    const model = models.get(key)
    if (!model) {
      return yield* Effect.fail(new BoundModelNotFound({ key }))
    }
    return model as any
  })

/**
 * Pluralize a singular word.
 * Handles common English pluralization rules.
 *
 * @example
 * pluralize('user')     // 'users'
 * pluralize('category') // 'categories'
 * pluralize('box')      // 'boxes'
 * pluralize('class')    // 'classes'
 */
export function pluralize(word: string): string {
  // Words ending in vowel + y: just add 's' (day -> days)
  if (/[aeiou]y$/i.test(word)) return word + 's'
  // Words ending in consonant + y: replace y with ies (category -> categories)
  if (/y$/i.test(word)) return word.slice(0, -1) + 'ies'
  // Words ending in s, x, z, ch, sh: add 'es' (box -> boxes, class -> classes)
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return word + 'es'
  // Default: add 's'
  return word + 's'
}

/**
 * Information about a relation between tables.
 */
export interface RelationInfo {
  /** Foreign key column on the child table (e.g., 'userId') */
  foreignKey: string
  /** Referenced column on the parent table (e.g., 'id') */
  references: string
}

/**
 * Find a relation from child table to parent table.
 * Uses Drizzle's relations metadata to discover foreign keys.
 *
 * @param schema - The Drizzle schema object
 * @param childTableName - Name of the child table (e.g., 'posts')
 * @param parentTableName - Name of the parent table (e.g., 'users')
 * @returns Relation info or null if no relation found
 */
export function findRelation(
  schema: Record<string, unknown>,
  childTableName: string,
  parentTableName: string
): RelationInfo | null {
  // Look for relations definition (e.g., postsRelations)
  const relationsKey = `${childTableName}Relations`
  const relations = schema[relationsKey]

  if (!relations || typeof relations !== 'object') {
    return null
  }

  // Drizzle stores relations config - we need to inspect it
  // The relations object has a config property with the relation definitions
  const config = (relations as any).config

  if (!config || typeof config !== 'function') {
    return null
  }

  // Try to extract relation info by calling the config
  // This is a bit hacky but necessary to introspect Drizzle relations
  try {
    const relationDefs = config({
      one: (table: any, opts: any) => ({ type: 'one', table, ...opts }),
      many: (table: any, opts: any) => ({ type: 'many', table, ...opts }),
    })

    for (const [_name, rel] of Object.entries(relationDefs)) {
      const relation = rel as any
      if (relation.type !== 'one') continue

      // Check if this relation points to the parent table
      const relatedTableName = getTableName(relation.table)
      if (relatedTableName === parentTableName && relation.fields && relation.references) {
        return {
          foreignKey: getColumnName(relation.fields[0]),
          references: getColumnName(relation.references[0]),
        }
      }
    }
  } catch {
    // If introspection fails, fall back to convention
  }

  return null
}

/**
 * Get table name from a Drizzle table object.
 */
function getTableName(table: unknown): string {
  if (table && typeof table === 'object') {
    // Drizzle tables have a Symbol for the table name
    const symbols = Object.getOwnPropertySymbols(table)
    for (const sym of symbols) {
      if (sym.description === 'drizzle:Name') {
        return (table as any)[sym] as string
      }
    }
    // Fallback: check for _ property
    if ('_' in table && typeof (table as any)._ === 'object') {
      return (table as any)._.name
    }
  }
  return ''
}

/**
 * Get column name from a Drizzle column object.
 */
function getColumnName(column: unknown): string {
  if (column && typeof column === 'object') {
    if ('name' in column) {
      return (column as any).name as string
    }
  }
  return ''
}

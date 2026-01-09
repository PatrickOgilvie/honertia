/**
 * Route Model Binding
 *
 * Laravel-style route model binding for Effect routes.
 * Automatically resolves route parameters to database models.
 */

import { Context, Data, Effect, Schema as S } from 'effect'
import type { Table } from 'drizzle-orm'
import type { SchemaType } from './services.js'
import { RouteConfigurationError } from './errors.js'

/**
 * Drizzle column interface for type inference.
 */
interface DrizzleColumn {
  columnType: string
  dataType: string
  name: string
}

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
 * Pluralize a key for schema lookup.
 * Matches the runtime pluralize() function logic.
 */
type Pluralize<S extends string> =
  S extends `${infer _}${'a' | 'e' | 'i' | 'o' | 'u'}y` ? `${S}s` :           // day → days (vowel + y)
  S extends `${infer Base}y` ? `${Base}ies` :                                  // category → categories
  S extends `${infer _}${'s' | 'ss' | 'x' | 'z' | 'zz' | 'ch' | 'sh'}` ? `${S}es` : // class, buzz, box, match → +es
  `${S}s`                                                                       // project → projects

/**
 * Error type shown when trying to use bound() without schema configured.
 */
interface BoundModelNotConfigured<K extends string> {
  readonly __error: `Cannot infer type for bound('${K}'). Schema not configured for route model binding.`
  readonly __hint: 'Add module augmentation: declare module "honertia/effect" { interface HonertiaDatabaseType { schema: typeof schema } }'
}

/**
 * Lookup a table type from schema, trying pluralized key first.
 * Shows helpful error if schema is not configured.
 */
export type BoundModel<K extends string> =
  // Check if schema is configured (has __error means it's the error type)
  SchemaType extends { __error: string }
    ? BoundModelNotConfigured<K>
    : Pluralize<K> extends keyof SchemaType
      ? SchemaType[Pluralize<K>] extends Table
        ? SchemaType[Pluralize<K>]['$inferSelect']
        : unknown
      : K extends keyof SchemaType
        ? SchemaType[K] extends Table
          ? SchemaType[K]['$inferSelect']
          : unknown
        : unknown

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
  BoundModel<K>,
  BoundModelNotFound | RouteConfigurationError,
  BoundModels
> =>
  Effect.gen(function* () {
    const models = yield* BoundModels

    // Check if schema was not configured (sentinel value set by routing.ts)
    if (models.has('__schema_not_configured__')) {
      return yield* new RouteConfigurationError({
        message: `Route model binding requires schema configuration. Cannot resolve bound('${key}') without schema.`,
        hint: `Pass your schema to setupHonertia: setupHonertia({ honertia: { schema } })`
      })
    }

    const model = models.get(key)
    if (!model) {
      return yield* new BoundModelNotFound({ key })
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

/**
 * Map a Drizzle column type to an Effect Schema for URL param validation.
 * URL params are always strings, so numeric types use string-to-number transforms.
 *
 * @param columnType - The Drizzle columnType (e.g., 'PgUUID', 'PgInteger')
 * @returns An Effect Schema that validates the URL param string
 */
export function columnTypeToSchema(columnType: string): S.Schema.Any {
  switch (columnType) {
    // UUID types
    case 'PgUUID':
      return S.UUID

    // Integer types - URL params are strings, so we parse to number
    case 'PgInteger':
    case 'PgSmallInt':
    case 'PgBigInt53':
    case 'PgSerial':
    case 'PgSmallSerial':
    case 'PgBigSerial53':
    case 'SQLiteInteger':
    case 'MySqlInt':
    case 'MySqlTinyInt':
    case 'MySqlSmallInt':
    case 'MySqlMediumInt':
    case 'MySqlBigInt53':
    case 'MySqlSerial':
      return S.NumberFromString.pipe(S.int())

    // BigInt types that exceed JS number precision
    case 'PgBigInt64':
    case 'PgBigSerial64':
    case 'MySqlBigInt64':
      return S.BigInt

    // Numeric/Decimal types
    case 'PgNumeric':
    case 'PgDoublePrecision':
    case 'PgReal':
    case 'MySqlFloat':
    case 'MySqlDouble':
    case 'MySqlDecimal':
    case 'SQLiteReal':
      return S.NumberFromString

    // Boolean - less common in URL params but possible
    // SQLite stores booleans as integers (0/1)
    case 'PgBoolean':
    case 'MySqlBoolean':
    case 'SQLiteBoolean':
      return S.transform(
        S.String,
        S.Boolean,
        {
          decode: (s) => s.toLowerCase() === 'true' || s === '1',
          encode: (b) => b ? 'true' : 'false'
        }
      )

    // String types (default for text, varchar, etc.)
    case 'PgText':
    case 'PgVarchar':
    case 'PgChar':
    case 'MySqlVarChar':
    case 'MySqlText':
    case 'MySqlChar':
    case 'SQLiteText':
    default:
      return S.String
  }
}

/**
 * Infer an Effect Schema for route params based on database column types.
 * Looks up each binding's column in the schema and builds a struct schema.
 *
 * @param bindings - Parsed route bindings
 * @param schema - The Drizzle schema object
 * @returns An Effect Schema for validating route params, or null if inference fails
 */
export function inferParamsSchema(
  bindings: ParsedBinding[],
  schema: Record<string, unknown>
): S.Schema.Any | null {
  if (bindings.length === 0) return null

  const fields: Record<string, S.Schema.Any> = {}

  for (const binding of bindings) {
    const tableName = pluralize(binding.param)
    const table = schema[tableName] as Record<string, unknown> | undefined

    if (!table) {
      // Table not found - can't infer, let it fail at query time
      return null
    }

    const column = table[binding.column] as DrizzleColumn | undefined
    if (!column || typeof column !== 'object' || !('columnType' in column)) {
      // Column not found or not a Drizzle column - can't infer
      return null
    }

    fields[binding.param] = columnTypeToSchema(column.columnType)
  }

  return S.Struct(fields)
}

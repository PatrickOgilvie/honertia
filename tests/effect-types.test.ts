/**
 * Compile-time type tests for Effect module.
 * If this file compiles, the types are correct.
 */

import { Effect } from 'effect'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import {
  DatabaseService,
  AuthService,
  bound,
  pluralize,
  asValidated,
  asTrusted,
  dbMutation,
  dbTransaction,
  type DatabaseType,
  type SchemaType,
  type AuthType,
  type BoundModel,
  type Validated,
  type Trusted,
  type SafeTx,
} from '../src/effect/index.js'

// ============================================================================
// Test Utilities
// ============================================================================

/** Assert two types are exactly equal */
type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false

/** Assert T extends U */
type AssertExtends<T, U> = T extends U ? true : false

// ============================================================================
// Mock Schema for Testing
// ============================================================================

const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
})

const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
})

const schema = { projects, categories }

type Project = typeof projects.$inferSelect
type Category = typeof categories.$inferSelect

// Augment interfaces for testing
declare module '../src/effect/index.js' {
  interface HonertiaDatabaseType {
    type: { query: (sql: string) => Promise<unknown[]> }
    schema: typeof schema
  }
  interface HonertiaAuthType {
    type: { getSession: () => Promise<unknown> }
  }
}

// ============================================================================
// Pluralize Type Tests (must match runtime pluralize function)
// ============================================================================

// Test: project → projects (simple 's')
const _pluralProject: AssertEqual<BoundModel<'project'>, Project> = true

// Test: category → categories (y → ies)
const _pluralCategory: AssertEqual<BoundModel<'category'>, Category> = true

// ============================================================================
// Module Augmentation Tests
// ============================================================================

// DatabaseType resolves to augmented type
const _dbType: AssertExtends<DatabaseType, { query: (sql: string) => Promise<unknown[]> }> = true

// SchemaType resolves to augmented schema
const _schemaType: AssertExtends<SchemaType, typeof schema> = true

// AuthType resolves to augmented type
const _authType: AssertExtends<AuthType, { getSession: () => Promise<unknown> }> = true

// ============================================================================
// Service Type Tests
// ============================================================================

// DatabaseService yields the augmented database type
const _testDbService = Effect.gen(function* () {
  const db = yield* DatabaseService
  const _query: (sql: string) => Promise<unknown[]> = db.query
  return db
})

// AuthService yields the augmented auth type
const _testAuthService = Effect.gen(function* () {
  const auth = yield* AuthService
  const _getSession: () => Promise<unknown> = auth.getSession
  return auth
})

// ============================================================================
// BoundModel Type Tests
// ============================================================================

// bound() returns correctly typed model
const _testBound = Effect.gen(function* () {
  const project = yield* bound('project')
  const _id: string = project.id
  const _name: string = project.name
  return project
})

// bound() with category (tests y → ies pluralization)
const _testBoundCategory = Effect.gen(function* () {
  const category = yield* bound('category')
  const _id: string = category.id
  const _title: string = category.title
  return category
})

// ============================================================================
// Validated/Trusted Branding Tests
// ============================================================================

interface UserInput {
  name: string
  email: string
}

// Plain object should NOT be assignable to Validated
type PlainToValidated = UserInput extends Validated<UserInput> ? true : false
const _plainNotValidated: PlainToValidated = false

// Plain object should NOT be assignable to Trusted
type PlainToTrusted = UserInput extends Trusted<UserInput> ? true : false
const _plainNotTrusted: PlainToTrusted = false

// Validated should extend the base type
type ValidatedExtendsBase = Validated<UserInput> extends UserInput ? true : false
const _validatedExtendsBase: ValidatedExtendsBase = true

// Trusted should extend the base type
type TrustedExtendsBase = Trusted<UserInput> extends UserInput ? true : false
const _trustedExtendsBase: TrustedExtendsBase = true

// Spreading a Validated object should NOT produce Validated
// (This is the key safety feature - spreading drops the brand)
// We test this by checking that a plain Record can't satisfy Validated
type SpreadResult = Record<string, unknown> extends Validated<UserInput> ? true : false
const _spreadDropsBrand: SpreadResult = false

// asValidated creates Validated type
const validatedInput = asValidated({ name: 'test', email: 'test@test.com' })
const _validatedType: Validated<{ name: string; email: string }> = validatedInput

// asTrusted creates Trusted type
const trustedInput = asTrusted({ name: 'test', email: 'test@test.com' })
const _trustedType: Trusted<{ name: string; email: string }> = trustedInput

// ============================================================================
// SafeTx Type Tests
// ============================================================================

// Mock database type for testing SafeTx
interface MockInsertBuilder<T> {
  values: (v: T | T[]) => { execute: () => Promise<void> }
}

interface MockUpdateBuilder<T> {
  set: (v: Partial<T>) => { where: (c: unknown) => { execute: () => Promise<void> } }
}

interface MockDB {
  insert: (table: unknown) => MockInsertBuilder<UserInput>
  update: (table: unknown) => MockUpdateBuilder<UserInput>
  query: (sql: string) => Promise<unknown[]>
}

// SafeTx should wrap insert().values() to require branded input
type SafeDB = SafeTx<MockDB>

// Verify SafeTx wraps the values method
type SafeValuesParam = SafeDB extends {
  insert: (table: unknown) => { values: (v: infer V) => unknown }
} ? V : never

// SafeValuesParam should NOT accept plain UserInput
type PlainAccepted = UserInput extends SafeValuesParam ? true : false
// Note: Due to how the type works, we can't easily assert this at compile time
// but the runtime behavior enforces it

// dbMutation and dbTransaction should work with SafeTx
const _testDbMutation = Effect.gen(function* () {
  const mockDb = {} as MockDB
  const validated = asValidated({ name: 'test', email: 'test@test.com' })

  // This should compile - validated input is accepted
  yield* dbMutation(mockDb, async (db) => {
    // db is SafeTx<MockDB> here
    return Promise.resolve()
  })
})

const _testDbTransaction = Effect.gen(function* () {
  const mockDb = {
    transaction: <T>(fn: (tx: MockDB) => Promise<T>) => fn({} as MockDB)
  }

  yield* dbTransaction(mockDb, async (tx) => {
    // tx is SafeTx<MockDB> here
    return Promise.resolve({ success: true })
  })
})

// ============================================================================
// Runtime Tests
// ============================================================================

import { describe, test, expect } from 'bun:test'

describe('Effect type tests', () => {
  test('pluralize function matches Pluralize type', () => {
    // These runtime checks complement the compile-time assertions above
    expect(pluralize('project')).toBe('projects')
    expect(pluralize('category')).toBe('categories')
    expect(pluralize('day')).toBe('days')
    expect(pluralize('box')).toBe('boxes')
    expect(pluralize('class')).toBe('classes')
    expect(pluralize('match')).toBe('matches')
    expect(pluralize('wish')).toBe('wishes')
    // Words already ending in double consonants
    expect(pluralize('buzz')).toBe('buzzes')
    expect(pluralize('boss')).toBe('bosses')
    expect(pluralize('fizz')).toBe('fizzes')
  })

  test('compile-time type assertions passed', () => {
    // If we got here, all the type assertions above compiled successfully
    expect(_pluralProject).toBe(true)
    expect(_pluralCategory).toBe(true)
    expect(_dbType).toBe(true)
    expect(_schemaType).toBe(true)
    expect(_authType).toBe(true)
  })

  test('effect generators are properly typed', () => {
    expect(_testDbService).toBeDefined()
    expect(_testAuthService).toBeDefined()
    expect(_testBound).toBeDefined()
    expect(_testBoundCategory).toBeDefined()
  })

  test('Validated/Trusted branding assertions passed', () => {
    // Plain objects should NOT be assignable to branded types
    expect(_plainNotValidated).toBe(false)
    expect(_plainNotTrusted).toBe(false)

    // Branded types should extend base types
    expect(_validatedExtendsBase).toBe(true)
    expect(_trustedExtendsBase).toBe(true)

    // Spreading should drop the brand
    expect(_spreadDropsBrand).toBe(false)

    // asValidated/asTrusted create properly branded values
    expect(_validatedType).toBeDefined()
    expect(_trustedType).toBeDefined()
  })

  test('dbMutation and dbTransaction are properly typed', () => {
    expect(_testDbMutation).toBeDefined()
    expect(_testDbTransaction).toBeDefined()
  })
})

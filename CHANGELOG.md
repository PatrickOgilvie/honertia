# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.13] - 2026-01-07

### Fixed

- Added `BoundModels` to `BaseServices` type - handlers using `bound()` now correctly satisfy route builder type constraints
- Fixed `HonertiaDatabaseType` interface for proper module augmentation - removed index signature and made `schema` non-optional so user declarations don't conflict with base interface modifiers

## [0.1.12] - 2026-01-07

### Added

- **Laravel-style route model binding**: Routes now support `{param}` syntax that automatically resolves database models
  - `effectRoutes(app, { schema }).get('/projects/{project}', handler)` queries the `projects` table by `id`
  - `{param:column}` syntax for binding by non-id columns: `/projects/{project:slug}`
  - Nested routes auto-scope via Drizzle relations: `/users/{user}/posts/{post}` queries posts where `userId = user.id`
  - `bound('project')` accessor to retrieve resolved models in handlers
  - Zero overhead for routes without `{bindings}` syntax
- Route helpers now accept a `params` schema to validate route parameters and automatically return 404s when the schema fails
- `BoundModels` service and `bound()` helper exported from `honertia/effect`
- `parseBindings()` and `toHonoPath()` utilities for custom route handling
- `drizzle-orm` as optional peer dependency for route model binding
- `schema` property on `HonertiaDatabaseType` for typed route model binding
- Comprehensive test suite for route binding with 75+ test cases

## [0.1.11] - 2026-01-06

### Fixed

- Safe write wrappers now accept single branded values even when the underlying `values` signature is inferred as array-only.

## [0.1.10] - 2026-01-06

### Changed

- Brands for validated/trusted inputs are now nominal so merges/spreads require explicit re-branding via `asTrusted`.
- Updated db helper docs and examples to explain the explicit trust boundary and show safe merge patterns.

### Added

- Branding safety tests now cover explicit trusted merges and ensure spreads drop branding.

## [0.1.9] - 2026-01-05

### Fixed

- Module augmentation now actually works in emitted `.d.ts` files; `DatabaseService` and `AuthService` preserve `HonertiaDatabaseType['type']` and `HonertiaAuthType['type']`.
- Module augmentation no longer conflicts with interface merging by using index-signature placeholders and if not we will move onto something else lol.

### Changed

- `DatabaseService` and `AuthService` now expose the augmented types directly (no extra wrapper needed - probably).

### Removed

- `TypedDatabase` and `TypedAuth` alias exports. Hopefully this preserves the clean `yield* DatabaseService` that I was willing to sacrifice everything for. 

## [0.1.8] - 2026-01-05

### Fixed

- Module augmentation for `HonertiaDatabaseType` and `HonertiaAuthType` now works correctly (interfaces use `type` property directly instead of conditional types that were evaluated at library compile time)

## [0.1.7] - 2026-01-05

### Added

- `HonertiaDatabaseType` and `HonertiaAuthType` augmentable interfaces for typed services via module augmentation
- TypeScript section in README explaining how to use module augmentation for `DatabaseService` and `AuthService`
- Documentation clarifying query-level vs `authorize()` checks for resource ownership

### Changed

- `DatabaseService` and `AuthService` now use augmentable interfaces instead of `unknown`

## [0.1.6] - 2026-01-05

### Added

- `ValidateOptions` interface with JSDoc documentation for all options
- Better error handling for malformed JSON request bodies (returns clear `ValidationError` instead of confusing field errors)
- Tests for `attributes` option through `validateRequest`
- Tests for nested field paths (`user.email`), array indices (`tags.1`), and deeply nested paths
- README documentation for all `validateRequest` options (`errorComponent`, `messages`, `attributes`)

### Changed

- Simplified `validate` function signature from curried `validate(schema, options)(data)` to direct `validate(schema, data, options)`
- Simplified `formatSchemaErrors` path extraction logic
- Improved `getValidationData` error handling

## [0.1.5] - 2026-01-05

### Changed

- Changed how `dbTransaction` works so that the API is more consistent

## [0.1.4] - 2026-01-05

### Added

- `action` wrapper for Effect-based actions
- `authorize` helper for authentication and authorization checks
- `dbTransaction` helper for database transactions with automatic rollback

### Changed

- Actions are now composed via `yield*` helpers/services instead of factory functions

### Removed

- Action factories `effectAction`, `dbAction`, `authAction`, `simpleAction`
- Action helpers `injectUser`, `dbOperation`, `prepareData`, `preparedAction`

## [0.1.3] - 2026-01-05

### Added

- `betterAuthFormAction` factory for streamlined form-based authentication (login/register)
- `betterAuthLogoutAction` factory for logout with automatic cookie clearing
- `loginAction`, `registerAction`, `logoutAction` options for `effectAuthRoutes` config
- `guestActions` option for registering additional guest-only POST routes (2FA, forgot password, etc.)
- `AuthActionEffect` type export for typing custom auth actions
- Error mapping support to translate better-auth error codes to field-level validation errors
- Dynamic `redirectTo` support (string or function) for auth actions
- Automatic Set-Cookie header forwarding from better-auth responses
- Fallback cookie clearing when better-auth doesn't return Set-Cookie headers
- Comprehensive test coverage for auth form actions

### Changed

- `effectAuthRoutes` now supports unified auth route configuration (pages + actions in one call)
- README now documents the full better-auth form action pattern with examples

## [0.1.2] - 2026-01-04

### Changed

- `createVersion` now accepts Vite manifest entries (including `file`, `css`, and `assets`)
- README Tailwind v4 setup docs now reference manifest-driven scripts/styles

## [0.1.1] - 2026-01-04

### Added

- Custom services support for Effect bridge/routes via the `services` layer hook
- Custom services support in `setupHonertia` effect configuration
- Cloudflare bindings documentation and examples for custom services
- Custom services tests covering `setupHonertia` and route-only usage

### Changed

- Effect route builder typing to include custom services in handler requirements

## [0.1.0] - 2026-01-03

### Added

- Initial release
- Inertia.js-style server-driven SPA adapter for Hono
- Effect.js integration with per-request runtime
- Laravel-inspired validation with Effect Schema
- Type-safe route handlers returning `Response | Redirect`
- Services: `DatabaseService`, `AuthService`, `AuthUserService`, `HonertiaService`, `RequestService`, `ResponseFactoryService`
- Authentication layers: `RequireAuthLayer`, `RequireGuestLayer`
- Route grouping with `effectRoutes()` and `effectAuthRoutes()`
- Response helpers: `render`, `renderWithErrors`, `redirect`, `json`, `notFound`, `forbidden`
- Validation helpers: `requiredString`, `nullableString`, `email`, `password`, `coercedNumber`, etc.
- Action factories: `effectAction`, `dbAction`, `authAction`
- React integration with `HonertiaPage` type
- Full Cloudflare Workers compatibility

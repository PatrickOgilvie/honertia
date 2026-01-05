# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

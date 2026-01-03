# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

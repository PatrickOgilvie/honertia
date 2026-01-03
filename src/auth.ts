/**
 * Honertia Auth
 *
 * Re-exports all authentication and authorization functionality.
 * Import from 'honertia/auth' for auth-related functionality.
 */

export {
  RequireAuthLayer,
  RequireGuestLayer,
  isAuthenticated,
  currentUser,
  requireAuth,
  requireGuest,
  shareAuth,
  shareAuthMiddleware,
  effectAuthRoutes,
  loadUser,
  type AuthRoutesConfig,
} from './effect/auth.js'

// Re-export auth-related services
export {
  AuthService,
  AuthUserService,
  type AuthUser,
} from './effect/services.js'

// Re-export auth-related errors
export {
  UnauthorizedError,
  ForbiddenError,
} from './effect/errors.js'

/**
 * Effect Module Barrel Export
 *
 * Re-exports all Effect-related functionality.
 */

// Services
export {
  DatabaseService,
  AuthService,
  AuthUserService,
  HonertiaService,
  RequestService,
  ResponseFactoryService,
  type AuthUser,
  type HonertiaRenderer,
  type RequestContext,
  type ResponseFactory,
  type HonertiaDatabaseType,
  type HonertiaAuthType,
} from './services.js'

// Errors
export {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  HttpError,
  Redirect,
  type AppError,
} from './errors.js'

// Schema Validators
export * from './schema.js'

// Validation Helpers
export {
  getValidationData,
  formatSchemaErrors,
  validate,
  validateRequest,
  asValidated,
  asTrusted,
  type Validated,
  type Trusted,
} from './validation.js'

// Bridge
export {
  effectBridge,
  buildContextLayer,
  getEffectRuntime,
  type EffectBridgeConfig,
} from './bridge.js'

// Handler
export {
  effectHandler,
  effect,
  handle,
  errorToResponse,
} from './handler.js'

// Action Composables
export {
  action,
  authorize,
  dbMutation,
  dbTransaction,
  type SafeTx,
} from './action.js'

// Response Helpers
export {
  redirect,
  render,
  renderWithErrors,
  json,
  text,
  notFound,
  forbidden,
  httpError,
  prefersJson,
  jsonOrRender,
  share,
} from './responses.js'

// Routing
export {
  EffectRouteBuilder,
  effectRoutes,
  type EffectHandler,
  type BaseServices,
} from './routing.js'

// Auth
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
  betterAuthFormAction,
  betterAuthLogoutAction,
  loadUser,
  type AuthRoutesConfig,
  type BetterAuthFormActionConfig,
  type BetterAuthLogoutConfig,
  type BetterAuthActionResult,
} from './auth.js'

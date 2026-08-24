export {
  CallSchema,
  DenialReasonSchema,
  LimitsSchema,
  OfficeIdSchema,
  ProjectionSchema,
  ResourceGrantSchema,
  ScopeSchema,
  ScopeStateSchema,
  type Call,
  type Decision,
  type DenialReason,
  type Limits,
  type Scope,
  type ScopeState,
} from "./schema.js";

export {
  ArgBindingSchema,
  OfficeSpecSchema,
  buildRegistry,
  resolverSafeFields,
  type ArgBinding,
  type OfficeRegistry,
  type OfficeSpec,
} from "./office-spec.js";

export { evaluate } from "./evaluate.js";
export { detectInjection, project, type ProjectionResult } from "./project.js";

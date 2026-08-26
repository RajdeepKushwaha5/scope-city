/**
 * What the server sends back when asked "what would this office cost".
 *
 * Declared here rather than imported from `@scope-city/yard` because the city
 * receives this over HTTP: it is a wire shape that happens to match a type on
 * the server today, and treating it as the same type would hide the day they
 * diverge behind a compile that still passes.
 */
export interface CounterfactualView {
  readonly office: string;
  readonly summary: string;
  readonly before: {
    readonly offices: number;
    readonly exposedFields: number;
    readonly unnarrowableOffices: number;
    readonly chainedPaths: number;
  };
  readonly after: {
    readonly offices: number;
    readonly exposedFields: number;
    readonly unnarrowableOffices: number;
    readonly chainedPaths: number;
  };
  readonly newFindings: readonly {
    readonly kind: string;
    readonly severity: "critical" | "warning" | "note";
    readonly office: string;
    readonly summary: string;
    readonly detail?: readonly string[];
    readonly remedy?: string;
  }[];
  readonly newDistricts: readonly string[];
}

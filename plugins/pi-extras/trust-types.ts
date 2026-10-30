/**
 * The project-trust report both the host and the app use. Kept free of Node
 * imports so the frontend can import the type without pulling in `node:fs`.
 */
export type DefaultProjectTrust = "ask" | "always" | "never";
export type TrustDecision = boolean | null;
export type TrustStatus = "trusted" | "untrusted" | "no-resources" | "unknown";

export interface TrustCheck {
  /** The path that was checked, as the caller passed it. */
  path: string;
  /** Machine that answered the check; the host entry leaves it null and the server fills it. */
  hostId: string | null;
  /** The trust store this check read, as Pi resolves it on that machine. */
  storePath: string;
  /** Pi's canonical form of that path, which is what trust keys use. */
  canonicalPath: string;
  /** Absolute paths of the trust-gated resources Pi found. */
  resources: string[];
  /** The saved decision that applies, before the global default. */
  savedDecision: TrustDecision;
  /** The canonical directory that saved decision belongs to. */
  savedDecisionPath: string | null;
  defaultProjectTrust: DefaultProjectTrust;
  /** Whether this bb thread loads those resources. False is what the plugin warns about. */
  trusted: boolean;
  status: TrustStatus;
  /** Whether the user can fix this by saving a decision for this workspace. */
  canTrust: boolean;
  error: string | null;
}

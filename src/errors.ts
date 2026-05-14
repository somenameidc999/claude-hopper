/**
 * A hopper error always carries a remediation message — never raw.
 * `code` lets callers branch on specific failure modes without parsing strings.
 */
export class HopperError extends Error {
  constructor(
    message: string,
    public readonly remediation: string,
    public readonly code: string = "HOPPER_ERROR",
  ) {
    super(message);
    this.name = "HopperError";
  }
}

export function isHopperError(e: unknown): e is HopperError {
  return e instanceof HopperError;
}

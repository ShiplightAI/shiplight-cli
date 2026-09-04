export const REUSABLE_STEP_PENDING_REFERENCE_ID = 0;

type MaybeReferenceId = number | undefined | null;

// Indicates whether a statement currently tracks a reusable step by reference.
export const hasReusableReference = (referenceId: MaybeReferenceId): referenceId is number =>
  typeof referenceId === "number";

// Identifies the transient "awaiting template selection" state created when converting to reusable.
export const isPendingReusableReference = (referenceId: MaybeReferenceId): boolean =>
  referenceId === REUSABLE_STEP_PENDING_REFERENCE_ID;

// Identifies references that already point to a saved reusable template.
export const isResolvedReusableReference = (referenceId: MaybeReferenceId): boolean =>
  typeof referenceId === "number" && referenceId > REUSABLE_STEP_PENDING_REFERENCE_ID;


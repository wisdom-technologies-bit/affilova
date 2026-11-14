// The policy version recorded when a user accepts the terms during onboarding.
//
// The legal text behind /terms-of-service and /privacy-policy is NOT final and
// has not been approved by counsel. This value marks the acceptances collected
// while that is true, so they can be told apart from acceptances of the approved
// documents later. When counsel approves the wording the version must change,
// and anyone who accepted an earlier version has accepted a different document.
//
// It is stored verbatim in public.policy_acceptances.version, next to the policy
// name, and is never shown to a user.

export const POLICY_VERSION = "draft-2026-11-13"

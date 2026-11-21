import { POLICY_VERSIONS } from "@/lib/site-config"

// The policy version recorded when a user accepts the terms during onboarding.
//
// Kept aligned with POLICY_VERSIONS in lib/site-config.ts so legacy
// become_vendor / become_affiliate signatures record the same draft version as
// record_policy_acceptance(). When counsel approves the wording, update
// POLICY_VERSIONS in lib/site-config.ts.
export const POLICY_VERSION = POLICY_VERSIONS.terms_of_service

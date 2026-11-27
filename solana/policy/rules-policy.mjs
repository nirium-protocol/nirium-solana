// A small reference policy engine, for demos and tests. Real deployments plug in their own.
//
// Rules, checked against what is actually about to be signed (context.authorization):
//   - the mint must be in `allowAssets` (if given),
//   - the destination owner must be in `allowPayTo` (if given),
//   - the fee payer must be in `allowFeePayers` (if given; e.g. PayAI's /supported signers),
//   - amount > `maxAmount` gives DENY,
//   - amount > `approvalAbove` (and <= maxAmount) gives WAIT: a person has to approve it,
//   - anything else gives ALLOW, bound to this transaction, valid for `ttlMs`.

export function createRulesPolicy({
  maxAmount, approvalAbove, allowPayTo, allowAssets, allowFeePayers, ttlMs = 30_000, policyVersion = "rules-v1",
  now = Date.now, onDecision,
} = {}) {
  if (maxAmount === undefined) throw new Error("createRulesPolicy: maxAmount (base units) is required");
  const max = BigInt(maxAmount);
  const approval = approvalAbove === undefined ? undefined : BigInt(approvalAbove);
  const payTo = allowPayTo ? new Set(allowPayTo) : undefined;
  const assets = allowAssets ? new Set(allowAssets) : undefined;
  const feePayers = allowFeePayers ? new Set(allowFeePayers) : undefined;

  return {
    now,
    onDecision,
    async evaluate(ctx) {
      const a = ctx.authorization;
      const amount = BigInt(a.amount);
      if (assets && !assets.has(a.mint)) return { decision: "DENY", reason: "token not allowed", policyVersion };
      if (payTo && !payTo.has(a.to)) return { decision: "DENY", reason: "destination not allowed", policyVersion };
      if (feePayers && !feePayers.has(a.feePayer)) return { decision: "DENY", reason: "fee payer is not an allowed facilitator", policyVersion };
      if (amount > max) return { decision: "DENY", reason: `amount ${amount} above limit ${max}`, policyVersion };
      if (approval !== undefined && amount > approval) return { decision: "WAIT", reason: `amount ${amount} needs approval (above ${approval})`, policyVersion };
      return { decision: "ALLOW", contextHash: ctx.contextHash, expiresAt: now() + ttlMs, policyVersion };
    },
  };
}

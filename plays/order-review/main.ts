#!/usr/bin/env -S rote play run
/**
 * @rote-frontmatter
 * ---
 * name: order-review
 * description: Review an order amendment from current company facts and shipment rules; produce a quote requiring fresh approval.
 * provenance:
 *   author: hello@trusynth.com
 * metadata:
 *   rote_version: 0.82.0
 *   version: 0.0.1
 *   status: draft
 *   kind: atomic
 *   flow_type: parallel
 *   execution_model: steps_with_presentation
 *   requires_endpoints: []
 *   requires_sessions: false
 *   hardcode_audit:
 *     schema: 2
 *     suspicion_count: 6
 *     audit_sha256: a480c293f0260859003c1973e1f474551a55788a67c544b3f042217e8f21a6c6
 *   exploration_model: null
 * parameters:
 * - name: input
 *   param_type: string
 *   required: true
 *   default: null
 *   description: Play parameter
 *   example: null
 *   valid_values: null
 * - name: quantity
 *   param_type: string
 *   required: true
 *   default: null
 *   description: Play parameter
 *   example: null
 *   valid_values: null
 * - name: budgetCents
 *   param_type: string
 *   required: true
 *   default: null
 *   description: Play parameter
 *   example: null
 *   valid_values: null
 * - name: output
 *   param_type: string
 *   required: true
 *   default: null
 *   description: Play parameter
 *   example: null
 *   valid_values: null
 * - name: procedure
 *   param_type: string
 *   required: true
 *   default: null
 *   description: Play parameter
 *   example: null
 *   valid_values: null
 * steps:
 *   bun:
 *     type: process.exec
 *     argv:
 *     - bun
 *     - $procedure
 *     - input=$input
 *     - quantity=$quantity
 *     - budgetCents=$budgetCents
 *     - output=$output
 * ---
 */

const presentationSdk = await import("__ROTE_PRESENTATION_SDK__").catch((cause) => {
  throw new Error(
    "This is a rote steps presentation program. Run it with `rote play run <name>`.",
    { cause },
  );
});
const { FlowOutput, loadPresentationContext, stepName } = presentationSdk;

const out = new FlowOutput();
const ctx = await loadPresentationContext();
out.setRunStatus(ctx.run.status);

const renderedSteps: Record<string, unknown> = {};

// Takes the step handle (not the name) so every `stepName("...")` at the
// call sites stays a literal that lint can verify against `steps:`.
function renderStep(step: ReturnType<typeof ctx.step>): unknown {
  switch (step.outcome.status) {
    case "completed":
      return step.outcome.output.body;
    case "restored": {
      const source = step.outcome.output.source;
      if (source?.status === "partial") {
        return {
          status: "partial",
          body: step.outcome.output.body,
          diagnostics: source.diagnostics,
          additional_diagnostics: source.additional_diagnostics,
        };
      }
      // A clean restored step completed in an earlier run, so it reads like one.
      return step.outcome.output.body;
    }
    case "partial":
      return {
        status: "partial",
        body: step.outcome.output.output.body,
        diagnostics: step.outcome.output.diagnostics,
      };
    case "skipped":
      return { status: "skipped", reason: step.outcome.output.reason };
    case "failed":
      return { status: "failed", message: step.outcome.output.message };
    case "blocked":
      return {
        status: "blocked",
        reason: step.outcome.output.reason,
        blocked_by: step.outcome.output.blocked_by ?? [],
      };
    default:
      // Unreachable while this body matches the SDK. A play exported before a new
      // outcome status was added lands here instead, so name the remedy.
      throw new Error(
        `unsupported step outcome: ${JSON.stringify(step.outcome)}. ` +
          `Re-export the play to regenerate this switch.`,
      );
  }
}
renderedSteps["bun"] = renderStep(ctx.step(stepName("bun")));

const headlinePrefix = (() => {
  switch (ctx.run.status) {
    case "succeeded":
      return "";
    case "partial":
      return "INCOMPLETE: ";
    case "failed":
      return "FAILED: ";
  }
})();
out.human(`${headlinePrefix}Rendered ${Object.keys(renderedSteps).length} step(s).`);
out.summary(`${headlinePrefix}Rendered ${Object.keys(renderedSteps).length} step(s).`);
out.result({
  run_id: ctx.run.run_id,
  status: ctx.run.status,
  complete: ctx.run.status === "succeeded",
  steps: renderedSteps,
});

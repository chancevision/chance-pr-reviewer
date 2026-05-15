import { z } from "zod";

export const severityEnum = z.enum(["critical", "warning", "suggestion"]);
export type Severity = z.infer<typeof severityEnum>;

export const verdictEnum = z.enum(["VERY_SAFE", "SAFE", "CAUTION", "RISKY"]);
export type Verdict = z.infer<typeof verdictEnum>;

export const securityVerdictEnum = z.enum(["cleared", "flagged"]);
export type SecurityVerdict = z.infer<typeof securityVerdictEnum>;

export const dimensionSchema = z.object({
  score: z.number().int().min(1).max(5),
  issues: z.array(z.string()),
  highlights: z.array(z.string()),
});

export const inlineCommentSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  severity: severityEnum,
  comment: z.string(),
});

export const reviewSchema = z.object({
  summary: z.string(),
  reproducibility: z.object({
    possible: z.boolean(),
    method: z.string(),
    detail: z.string(),
  }),
  behaviorProof: z.object({
    present: z.boolean(),
    evidence: z.string(),
  }),
  dimensions: z.object({
    codeQuality: dimensionSchema,
    security: dimensionSchema,
    performance: dimensionSchema,
    testing: dimensionSchema,
    consistency: dimensionSchema,
  }),
  overallScore: z.number().min(1).max(5),
  verdict: verdictEnum,
  securityVerdict: z.object({
    status: securityVerdictEnum,
    detail: z.string(),
  }),
  acceptanceCriteria: z.array(z.string()),
  nextStep: z.string(),
  relatedContributors: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      reason: z.string(),
    }),
  ),
  inlineComments: z.array(inlineCommentSchema),
});

export type ReviewResult = z.infer<typeof reviewSchema>;
export type InlineComment = z.infer<typeof inlineCommentSchema>;
export type Dimension = z.infer<typeof dimensionSchema>;

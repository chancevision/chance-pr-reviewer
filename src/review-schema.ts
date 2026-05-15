import { z } from "zod";

export const severityEnum = z.enum(["critical", "warning", "suggestion"]);
export type Severity = z.infer<typeof severityEnum>;

export const verdictEnum = z.enum(["VERY_SAFE", "SAFE", "CAUTION", "RISKY"]);
export type Verdict = z.infer<typeof verdictEnum>;

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
  dimensions: z.object({
    codeQuality: dimensionSchema,
    security: dimensionSchema,
    performance: dimensionSchema,
    testing: dimensionSchema,
    consistency: dimensionSchema,
  }),
  overallScore: z.number().min(1).max(5),
  verdict: verdictEnum,
  inlineComments: z.array(inlineCommentSchema),
});

export type ReviewResult = z.infer<typeof reviewSchema>;
export type InlineComment = z.infer<typeof inlineCommentSchema>;
export type Dimension = z.infer<typeof dimensionSchema>;

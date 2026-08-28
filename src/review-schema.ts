import { z } from "zod";

export const severityEnum = z.enum(["critical", "warning", "suggestion"]);
export type Severity = z.infer<typeof severityEnum>;

export const confidenceEnum = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceEnum>;

export const securityStatusEnum = z.enum(["cleared", "flagged"]);
export type SecurityStatus = z.infer<typeof securityStatusEnum>;

export const findingSchema = z.object({
  severity: severityEnum,
  title: z.string(),
  detail: z.string(),
});

export const inlineCommentSchema = z.object({
  file: z.string(),
  line: z.number().positive().transform((v) => Math.round(v)),
  severity: severityEnum,
  comment: z.string(),
});

export const reviewSchema = z.object({
  summary: z.string(),
  security: z.object({
    status: securityStatusEnum,
    detail: z.string(),
  }),
  findings: z.array(findingSchema).default([]),
  inlineComments: z.array(inlineCommentSchema).default([]),
  confidence: confidenceEnum,
});

export type ReviewResult = z.infer<typeof reviewSchema>;
export type InlineComment = z.infer<typeof inlineCommentSchema>;
export type Finding = z.infer<typeof findingSchema>;

export type ReviewEvent = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

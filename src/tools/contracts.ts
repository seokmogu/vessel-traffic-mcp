import { z } from 'zod/v4';

import { providerCapabilityValues, providerTransportValues, sourceConfidenceValues } from '../providers/types.js';

const providerCapabilitySchema = z.enum(providerCapabilityValues);
const providerTransportSchema = z.enum(providerTransportValues);
const sourceConfidenceSchema = z.enum(sourceConfidenceValues);

const sourceMetadataSchema = z.object({
  provider: z.string(),
  adapterVersion: z.string(),
  transport: providerTransportSchema,
  coverage: z.string().optional(),
  confidence: sourceConfidenceSchema.optional(),
  termsNote: z.string().optional(),
});

const providerStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  authState: z.enum(['not_required', 'configured', 'missing', 'disabled']),
  status: z.enum(['available', 'degraded', 'unavailable']),
  capabilities: z.array(providerCapabilitySchema),
  source: sourceMetadataSchema,
  retrievedAt: z.iso.datetime(),
  quota: z
    .object({
      state: z.enum(['not_applicable', 'unknown', 'available', 'limited', 'exhausted']),
      note: z.string().optional(),
    })
    .optional(),
  caveats: z.array(z.string()),
});

const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: providerTransportSchema,
  capabilities: z.array(providerCapabilitySchema),
  coverage: z.string(),
  auth: z.object({
    required: z.boolean(),
    mode: z.enum(['none', 'byok-profile', 'one-time']),
  }),
  caveats: z.array(z.string()),
  source: sourceMetadataSchema,
});

export const providerStatusOutputSchema = {
  providers: z.array(providerStatusSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
  }),
};

export const dataSourcesOutputSchema = {
  sources: z.array(dataSourceSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    fixtureBacked: z.number().int().nonnegative(),
    liveBacked: z.number().int().nonnegative(),
  }),
};

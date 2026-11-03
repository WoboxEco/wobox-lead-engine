import { z } from 'zod';

export const VENTURES = ['wobox_food', 'wobox_fashion', 'loop'] as const;
export type Venture = (typeof VENTURES)[number];

export const STAGES = [
  'new',
  'enriched',
  'qualified',
  'nurturing',
  'contacted',
  'meeting_booked',
  'discarded',
] as const;
export type Stage = (typeof STAGES)[number];

// Deal stages: reemplazan a HubSpot como fuente de verdad del pipeline de ventas
// post-meeting. Un company entra aca desde meeting_booked, o directo si el sales
// team lo carga manualmente (equivalente a como cargaban en HubSpot).
export const DEAL_STAGES = [
  'deal_sin_contacto',
  'deal_contacto',
  'deal_presentacion',
  'deal_negociacion',
  'deal_onboarding',
  'deal_ganado',
  'deal_perdido',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const BUYER_PERSONAS = ['BP1', 'BP2', 'BP3', 'BP4', 'BP5', 'BP6'] as const;
export type BuyerPersona = (typeof BUYER_PERSONAS)[number];

export const APPROACH_TYPES = ['warm_intro', 'nurture', 'direct'] as const;
export type ApproachType = (typeof APPROACH_TYPES)[number];

export const CHANNELS = [
  'linkedin',
  'email',
  'whatsapp',
  'phone',
  'in_person',
  'instagram_dm',
  'calendly',
  'internal',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const SCORING_MODELS = [
  'scoring-wobox-v1',
  'scoring-wobox-fashion-v1',
  'scoring-loop-v1',
] as const;
export type ScoringModel = (typeof SCORING_MODELS)[number];

export const woboxScoreSchema = z.object({
  total_score: z.number().int().min(1).max(100),
  vertical_score: z.number().int().min(0).max(100),
  scale_score: z.number().int().min(0).max(100),
  overstock_score: z.number().int().min(0).max(100),
  franchise_score: z.number().int().min(0).max(100),
  region_score: z.number().int().min(0).max(100),
  ai_reasoning: z.string().min(1),
});
export type WoboxScore = z.infer<typeof woboxScoreSchema>;

export const loopScoreSchema = z.object({
  total_score: z.number().int().min(1).max(100),
  recurrence_score: z.number().int().min(0).max(100),
  subsector_score: z.number().int().min(0).max(100),
  digital_score: z.number().int().min(0).max(100),
  scale_score: z.number().int().min(0).max(100),
  region_score: z.number().int().min(0).max(100),
  buyer_persona: z.enum(BUYER_PERSONAS),
  ai_reasoning: z.string().min(1),
});
export type LoopScore = z.infer<typeof loopScoreSchema>;

export function isWoboxVenture(v: Venture): v is 'wobox_food' | 'wobox_fashion' {
  return v === 'wobox_food' || v === 'wobox_fashion';
}

export function scoringModelForVenture(v: Venture): ScoringModel {
  if (v === 'wobox_fashion') return 'scoring-wobox-fashion-v1';
  return isWoboxVenture(v) ? 'scoring-wobox-v1' : 'scoring-loop-v1';
}

export function stageForScore(score: number): Stage {
  if (score >= 80) return 'qualified';
  if (score >= 50) return 'qualified';
  return 'discarded';
}

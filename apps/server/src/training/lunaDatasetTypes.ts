import { z } from 'zod';

export const lunaTrainingTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1),
});

export const lunaTrainingStateSchema = z.object({
  surface: z.enum(['discord', 'desktop', 'browser', 'dm']),
  callerName: z.string().min(1),
  bondTier: z.string().min(1),
  relationship: z.array(z.string()),
  facts: z.array(z.string()),
  concepts: z.array(z.string()),
  life: z.array(z.string()),
  hoursSinceContact: z.number().nullable(),
  absenceNote: z.string().nullable(),
  selfConcept: z.array(z.string()).optional(),
  goals: z.array(z.string()).optional(),
  opinions: z.array(z.string()).optional(),
  archetype: z.string().nullable().optional(),
  recentTurns: z.array(lunaTrainingTurnSchema),
  researchSnippet: z.string().nullable().optional(),
});

export const lunaTrainingRecordSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['live_voice', 'live_dm', 'synthetic', 'exported']),
  createdAt: z.string().datetime(),
  input: lunaTrainingStateSchema.extend({
    userMessage: z.string().min(1),
  }),
  output: z.object({
    assistant: z.string().min(1),
  }),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1),
  })).min(3),
});

export type LunaTrainingTurn = z.infer<typeof lunaTrainingTurnSchema>;
export type LunaTrainingState = z.infer<typeof lunaTrainingStateSchema>;
export type LunaTrainingRecord = z.infer<typeof lunaTrainingRecordSchema>;

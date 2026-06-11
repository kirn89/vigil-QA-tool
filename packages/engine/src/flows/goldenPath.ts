import { z } from 'zod';

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('goto'), path: z.string().startsWith('/') }),
  z.object({ kind: z.literal('click'), selector: z.string().min(1), description: z.string() }),
  z.object({ kind: z.literal('fill'), selector: z.string().min(1), value: z.string(), description: z.string() }),
  z.object({ kind: z.literal('expect_text'), text: z.string().min(1) }),
  z.object({ kind: z.literal('expect_url'), pattern: z.string().min(1) }),
]);

export const stepSchema = z.object({ id: z.string().min(1), action: actionSchema });

export const goldenPathSchema = z.object({
  name: z.string().min(1),
  requiresLogin: z.boolean().default(false),
  steps: z.array(stepSchema).min(1).max(30),
});

export type StepAction = z.infer<typeof actionSchema>;
export type Step = z.infer<typeof stepSchema>;
export type GoldenPath = z.infer<typeof goldenPathSchema>;

export interface InterpolationContext {
  email?: string;
  password?: string;
  runId: string;
}

/** Substitutes {{email}} / {{password}} / {{unique}} placeholders. {{unique}} is
 *  deliberately prefixed `vigil-test+` so synthetic data is recognizable (spec §6). */
export function interpolate(value: string, ctx: InterpolationContext): string {
  return value
    .replaceAll('{{email}}', ctx.email ?? '')
    .replaceAll('{{password}}', ctx.password ?? '')
    .replaceAll('{{unique}}', `vigil-test+${ctx.runId}`);
}

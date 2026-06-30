export interface CheckRequestDeps {
  getApp(appId: string): Promise<{ id: string; previewUrl: string | null } | null>;
  hasActiveJob(appId: string): Promise<boolean>;
  insertJob(appId: string, environment: 'production' | 'preview'): Promise<string>;
}
export type CheckRequestResult = { ok: true; jobId: string } | { ok: false; reason: 'not_found' | 'no_preview' | 'busy' };

export async function createCheckJob(deps: CheckRequestDeps, appId: string, environment: 'production' | 'preview'): Promise<CheckRequestResult> {
  const app = await deps.getApp(appId);
  if (!app) return { ok: false, reason: 'not_found' };
  if (environment === 'preview' && !app.previewUrl) return { ok: false, reason: 'no_preview' };
  if (await deps.hasActiveJob(appId)) return { ok: false, reason: 'busy' };
  const jobId = await deps.insertJob(appId, environment);
  return { ok: true, jobId };
}

'use server';
import { createClient } from '../../../../lib/supabase/server.js';
import { createCheckJob, type CheckRequestResult } from '../../../../lib/checkRequest.js';
import { latestJob } from '../../../../lib/data.js';

export async function requestCheck(appId: string, environment: 'production' | 'preview'): Promise<CheckRequestResult> {
  const sb = await createClient();
  return createCheckJob({
    getApp: async (id) => {
      const { data } = await sb.from('apps').select('id,preview_url').eq('id', id).maybeSingle();
      return data ? { id: data.id, previewUrl: data.preview_url } : null;
    },
    hasActiveJob: async (id) => {
      const { count } = await sb.from('jobs').select('id', { count: 'exact', head: true })
        .eq('app_id', id).in('status', ['queued', 'running']);
      return (count ?? 0) > 0;
    },
    insertJob: async (id, env) => {
      const { data, error } = await sb.from('jobs').insert({ app_id: id, type: 'check_now', environment: env }).select('id').single();
      if (error) throw error;
      return data.id;
    },
  }, appId, environment);
}

export async function pollJob(appId: string) {
  return latestJob(appId);
}

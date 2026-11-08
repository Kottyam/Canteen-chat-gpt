import { supabase, supabaseEnabled } from '../supabase';

export interface Poll {
  id: string;
  title: string;
  options: string[];
  allowMultiple: boolean;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
}

export interface PollResponse {
  memberId: string;
  memberName: string;
  selectedOptions: string[];
  submittedAt: string;
}

const missing = (e: any) => ['42P01', '42703', 'PGRST205'].includes(String(e?.code || '')) || /poll|does not exist|schema cache/i.test(String(e?.message || ''));

export async function loadActivePoll(): Promise<Poll | null> {
  if (!supabaseEnabled || !supabase) return null;
  const { data, error } = await supabase.from('polls').select('*').eq('enabled', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) { if (missing(error)) return null; throw error; }
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    options: Array.isArray(data.options) ? data.options : [],
    allowMultiple: !!data.allow_multiple,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    enabled: !!data.enabled,
  };
}

export async function savePoll(input: { title: string; options: string[]; allowMultiple: boolean; startsAt: string; endsAt: string; enabled: boolean }): Promise<Poll> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  // Disable other polls for this canteen first (simple single-active model)
  await supabase.from('polls').update({ enabled: false }).eq('enabled', true);
  const { data, error } = await supabase.from('polls').insert({
    title: input.title.trim(),
    options: input.options.filter(o => o.trim()),
    allow_multiple: input.allowMultiple,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    enabled: input.enabled,
  }).select().single();
  if (error) throw error;
  return {
    id: data.id,
    title: data.title,
    options: data.options,
    allowMultiple: data.allow_multiple,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    enabled: data.enabled,
  };
}

export async function setPollEnabled(id: string, enabled: boolean): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const { error } = await supabase.from('polls').update({ enabled }).eq('id', id);
  if (error) throw error;
}

export async function submitPollResponse(pollId: string, memberId: string, memberName: string, selected: string[]): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const { error } = await supabase.from('poll_responses').upsert({
    poll_id: pollId,
    member_id: memberId,
    member_name: memberName,
    selected_options: selected,
    submitted_at: new Date().toISOString(),
  }, { onConflict: 'poll_id,member_id' });
  if (error) throw error;
}

export async function loadPollResponses(pollId: string): Promise<PollResponse[]> {
  if (!supabaseEnabled || !supabase) return [];
  const { data, error } = await supabase.from('poll_responses').select('*').eq('poll_id', pollId).order('submitted_at');
  if (error) { if (missing(error)) return []; throw error; }
  return (data || []).map((r: any) => ({
    memberId: r.member_id,
    memberName: r.member_name || r.member_id,
    selectedOptions: Array.isArray(r.selected_options) ? r.selected_options : [],
    submittedAt: r.submitted_at,
  }));
}

export function isPollOpen(poll: Poll | null): boolean {
  if (!poll || !poll.enabled) return false;
  const now = Date.now();
  return now >= new Date(poll.startsAt).getTime() && now <= new Date(poll.endsAt).getTime();
}

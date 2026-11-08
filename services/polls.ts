import { supabase, supabaseEnabled } from '../supabase';

export interface PollQuestion {
  id: string;
  text: string;
  options: string[];
  allowMultiple: boolean;
}

export interface Poll {
  id: string;
  title: string;
  questions: PollQuestion[];
  startsAt: string;
  endsAt: string;
  enabled: boolean;
}

export interface PollResponse {
  memberId: string;
  memberName: string;
  answers: Record<string, string[]>; // questionId -> selected options
  submittedAt: string;
}

const missing = (e: any) => ['42P01', '42703', 'PGRST205'].includes(String(e?.code || '')) || /poll|does not exist|schema cache/i.test(String(e?.message || ''));

async function myCanteenId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('profiles').select('canteen_id').eq('id', (await supabase.auth.getUser()).data.user?.id).maybeSingle();
  return data?.canteen_id || null;
}

export async function loadActivePoll(): Promise<Poll | null> {
  if (!supabaseEnabled || !supabase) return null;
  const { data, error } = await supabase.from('polls').select('*').eq('enabled', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) { if (missing(error)) return null; throw error; }
  if (!data) return null;
  const questions: PollQuestion[] = Array.isArray(data.questions) ? data.questions : [];
  return {
    id: data.id,
    title: data.title,
    questions,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    enabled: !!data.enabled,
  };
}

export async function savePoll(input: { title: string; questions: PollQuestion[]; startsAt: string; endsAt: string; enabled: boolean }): Promise<Poll> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const canteenId = await myCanteenId();
  if (!canteenId) throw new Error('No canteen found for current user.');
  await supabase.from('polls').update({ enabled: false }).eq('enabled', true);
  const { data, error } = await supabase.from('polls').insert({
    canteen_id: canteenId,
    title: input.title.trim(),
    questions: input.questions,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    enabled: input.enabled,
  }).select().single();
  if (error) throw error;
  return {
    id: data.id,
    title: data.title,
    questions: data.questions || [],
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

export async function submitPollResponse(pollId: string, memberId: string, memberName: string, answers: Record<string, string[]>): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const canteenId = await myCanteenId();
  if (!canteenId) throw new Error('No canteen found.');
  const { error } = await supabase.from('poll_responses').upsert({
    poll_id: pollId,
    canteen_id: canteenId,
    member_id: memberId,
    member_name: memberName,
    answers,
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
    answers: r.answers || {},
    submittedAt: r.submitted_at,
  }));
}

export function isPollOpen(poll: Poll | null): boolean {
  if (!poll || !poll.enabled) return false;
  const now = Date.now();
  return now >= new Date(poll.startsAt).getTime() && now <= new Date(poll.endsAt).getTime();
}

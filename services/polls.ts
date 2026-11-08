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
  createdAt?: string;
}

export interface PollResponse {
  memberId: string;
  memberName: string;
  answers: Record<string, string[]>;
  submittedAt: string;
}

const missing = (e: any) => ['42P01', '42703', 'PGRST205'].includes(String(e?.code || '')) || /poll|does not exist|schema cache/i.test(String(e?.message || ''));

async function myCanteenId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('profiles').select('canteen_id').eq('id', (await supabase.auth.getUser()).data.user?.id).maybeSingle();
  return data?.canteen_id || null;
}

function mapPoll(r: any): Poll {
  return {
    id: r.id,
    title: r.title,
    questions: Array.isArray(r.questions) ? r.questions : [],
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    enabled: !!r.enabled,
    createdAt: r.created_at,
  };
}


async function notifyAll(poll: Poll) {
  if (!supabase) return;
  const reminderAt = new Date(new Date(poll.endsAt).getTime() - 10 * 60 * 1000);
  const endAt = new Date(poll.endsAt);
  const { data: members } = await supabase.from('profiles').select('id, canteen_id').eq('role', 'employee').eq('status', 'active');
  const { data: admins } = await supabase.from('profiles').select('id, canteen_id').eq('role', 'admin').eq('status', 'active');

  const insert = async (rows: any[], title: string, message: string, type: string, when: Date) => {
    for (const r of rows) {
      await supabase.from('notifications').insert({
        recipient_id: r.id,
        canteen_id: r.canteen_id,
        notification_type: type,
        title,
        message,
        payload: { poll_id: poll.id, screen: 'orders' },
        created_at: when.toISOString(),
      }).select().maybeSingle();
    }
  };

  // Immediate: poll open
  await insert(members || [], 'New Poll', `"${poll.title}" is open. Please submit your response.`, 'poll_open', new Date());
  // 10 min before end
  if (reminderAt > new Date()) {
    await insert(members || [], 'Poll ending soon', `"${poll.title}" ends in 10 minutes. Please submit.`, 'poll_reminder', reminderAt);
    await insert(admins || [], 'Poll ending soon', `"${poll.title}" ends in 10 minutes. Please remind members.`, 'poll_reminder_admin', reminderAt);
  }
  // On end
  await insert(members || [], 'Poll ended', `"${poll.title}" has ended.`, 'poll_ended', endAt);
  await insert(admins || [], 'Poll results ready', `"${poll.title}" has ended. Results are ready.`, 'poll_results', endAt);
}

export async function loadActivePoll(): Promise<Poll | null> {
  if (!supabaseEnabled || !supabase) return null;
  const { data, error } = await supabase.from('polls').select('*').eq('enabled', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) { if (missing(error)) return null; console.warn('loadActivePoll', error); return null; }
  return data ? mapPoll(data) : null;
}

export async function loadRecentPolls(days = 10): Promise<Poll[]> {
  if (!supabaseEnabled || !supabase) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('polls').select('*').gte('created_at', since).order('created_at', { ascending: false });
  if (error) { if (missing(error)) return []; throw error; }
  return (data || []).map(mapPoll);
}

export async function deletePoll(id: string): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const { error } = await supabase.from('polls').delete().eq('id', id);
  if (error) throw error;
}

export async function cleanupOldPolls(days = 10): Promise<void> {
  if (!supabaseEnabled || !supabase) return;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('polls').delete().lt('created_at', cutoff);
}

export async function savePoll(input: { title: string; questions: PollQuestion[]; startsAt: string; endsAt: string; enabled: boolean }): Promise<Poll> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  const canteenId = await myCanteenId();
  if (!canteenId) throw new Error('No canteen found for current user.');
  if (input.enabled) await supabase.from('polls').update({ enabled: false }).eq('enabled', true);
  const { data, error } = await supabase.from('polls').insert({
    canteen_id: canteenId,
    title: input.title.trim(),
    questions: input.questions,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    enabled: input.enabled,
  }).select().single();
  if (error) throw error;
  const saved = mapPoll(data);
  if (saved.enabled) await notifyAll(saved);
  return saved;
}

export async function setPollEnabled(id: string, enabled: boolean): Promise<void> {
  if (!supabaseEnabled || !supabase) throw new Error('Not connected');
  if (enabled) await supabase.from('polls').update({ enabled: false }).neq('id', id).eq('enabled', true);
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

export function isPollEnded(poll: Poll): boolean {
  return Date.now() > new Date(poll.endsAt).getTime();
}

import { supabase, supabaseEnabled } from '../supabase';
import { computePoolingBills, PoolingResult } from '../supabase/functions/_shared/poolingBilling';
import { loadPoolingInput, poolingPayload } from '../supabase/functions/_shared/poolingInputs';

export async function previewPoolingBills(month: number, year: number, messCutMinDays: number) {
  if (!supabaseEnabled || !supabase) throw new Error('Supabase is not enabled.');
  const { data: canteenId, error } = await supabase.rpc('current_canteen_id');
  if (error || !canteenId) throw error || new Error('Canteen not found.');
  const input = await loadPoolingInput(supabase, { canteenId, year, month, messCutMinDays });
  return { result: computePoolingBills(input), memberNames: input.memberNames };
}
export async function loadPoolingRun(month: number, year: number) {
  if (!supabaseEnabled || !supabase) return null;
  const { data, error } = await supabase.from('pooling_bill_runs').select('id,status,computed_at,published_at,expense_total_paise,unallocated_paise,pooling_bill_lines(employee_id,total_paise,monthly_bill_id)').eq('bill_year', year).eq('bill_month', month).maybeSingle();
  if (error) return null;
  return data;
}
export async function savePoolingRun(result: PoolingResult) {
  if (!supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('save_pooling_bill_run', { p_month: result.month, p_year: result.year, p_payload: poolingPayload(result) });
  if (error) throw error; return data;
}
export async function publishPoolingBill(runId: string, employeeId: string) {
  if (!supabase) throw new Error('Supabase is not enabled.');
  const { data, error } = await supabase.rpc('publish_pooling_bill', { p_run_id: runId, p_employee_id: employeeId });
  if (error) throw error; return data;
}

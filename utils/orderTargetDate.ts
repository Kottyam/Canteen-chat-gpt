import { supabase } from '../supabase';
import { formatDate } from './helpers';

export type OrderFor = 'today' | 'tomorrow';

export const getOrderTargetDate = (orderFor: OrderFor, now = new Date()): string => {
  const businessDate = formatDate(now);
  if (orderFor === 'today') return businessDate;
  const [year,month,day]=businessDate.split('-').map(Number);
  return formatDate(new Date(Date.UTC(year,month-1,day+1,12)));
};

export const loadOrderForSetting = async (): Promise<OrderFor> => {
  if (!supabase) return 'today';
  const { data, error } = await supabase
    .from('order_window_settings')
    .select('order_for')
    .maybeSingle();
  if (error || !data) return 'today';
  return data.order_for === 'tomorrow' ? 'tomorrow' : 'today';
};

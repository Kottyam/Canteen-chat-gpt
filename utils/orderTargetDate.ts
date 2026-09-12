import { supabase } from '../supabase';
import { formatDate } from './helpers';

export type OrderFor = 'today' | 'tomorrow';

export const getOrderTargetDate = (orderFor: OrderFor, now = new Date()): string => {
  if (orderFor === 'today') return formatDate(now);
  const nextDay = new Date(now.getTime());
  nextDay.setDate(nextDay.getDate() + 1);
  return formatDate(nextDay);
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

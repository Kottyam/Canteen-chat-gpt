import { supabase } from '../supabase';

export interface OrderWindowStatus {
  holiday: boolean;
  windowOpen: boolean;
  title: string;
  message: string;
}

export const loadOrderWindowStatus = async (targetDate: string, targetLabel: string): Promise<OrderWindowStatus> => {
  if (!supabase) {
    return {
      holiday: false,
      windowOpen: true,
      title: '',
      message: '',
    };
  }

  const { data: holidayData, error: holidayError } = await supabase.rpc('is_holiday_for_date', { p_date: targetDate });
  const holiday = !holidayError && holidayData === true;

  if (holiday) {
    return {
      holiday: true,
      windowOpen: false,
      title: 'Holiday',
      message: `${targetLabel} is a holiday. Orders are not available.`,
    };
  }

  const { data: windowData, error: windowError } = await supabase.rpc('employee_order_window_open');
  const windowOpen = !windowError && windowData !== false;

  if (!windowOpen) {
    return {
      holiday: false,
      windowOpen: false,
      title: 'Ordering is currently closed',
      message: `${targetLabel} order window is currently closed.`,
    };
  }

  return {
    holiday: false,
    windowOpen: true,
    title: '',
    message: '',
  };
};

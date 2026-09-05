// Payment state helpers intentionally use the unique payment-batch UUID.
// Keeping these transitions batch-specific prevents employee/month state from
// leaking between independent payment requests.
export type PaymentBatchAction = 'confirm' | 'mark_paid' | 'mark_not_received';

export function isPaymentBatchActionable(status: string, action: PaymentBatchAction) {
  if (action === 'confirm') return status === 'unpaid' || status === 'not_received';
  if (action === 'mark_paid') return status === 'unpaid' || status === 'pending_verification' || status === 'not_received';
  return status === 'pending_verification';
}

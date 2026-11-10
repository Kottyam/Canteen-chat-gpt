export const ADMIN_ADJUSTMENT_MIN = -10000;

export type UnbilledAdminRoom = { published: boolean; available: number };

export function parseAdminAdjustmentAmount(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return { ok: false, error: 'Enter a non-zero amount.' };
  if (n < ADMIN_ADJUSTMENT_MIN) return { ok: false, error: `Amount cannot be below ${ADMIN_ADJUSTMENT_MIN}.` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

export function negativeAdjustmentBlocked(amount: number, room: UnbilledAdminRoom | null): string | null {
  if (!(amount < 0)) return null;
  if (!room || room.published) {
    return "This month's bill is already published. Date the minus amount in the current unbilled month.";
  }
  const available = Math.max(0, Math.round(Number(room.available || 0) * 100) / 100);
  if (available <= 0 || Math.abs(amount) - available > 1e-9) {
    return `Minus amount can't exceed this member's unbilled amount (₹${available.toFixed(2)})`;
  }
  return null;
}

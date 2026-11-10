export const formatSignedRupees = (n: number) => {
  const v = Math.abs(Number(n) || 0).toFixed(2);
  return Number(n) < 0 ? `−₹${v}` : `₹${v}`;
};
export const signedRupeeClass = (n: number) => (Number(n) < 0 ? 'font-semibold text-red-600' : '');

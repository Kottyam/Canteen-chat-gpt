import React, { useState } from 'react';
import { supabase } from '../../supabase';

const DeleteBillHistory: React.FC = () => {
  const [selectedMonth, setSelectedMonth] = useState('');
  const [deleting, setDeleting] = useState(false);

  const deleteBillHistory = async () => {
    if (!supabase || !selectedMonth || deleting) return;

    const monthLabel = new Date(`${selectedMonth}-01T00:00:00`).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
    });
    const confirmed = window.confirm(
      `Delete Bill History for ${monthLabel}?\n\nThis will permanently delete all published bills and related payment history for the selected month. Underlying food orders will not be deleted.`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc('admin_delete_bill_history_for_date', {
        p_date: `${selectedMonth}-01`,
      });
      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      const deletedBills = Number(result?.deleted_bills || 0);
      const deletedPayments = Number(result?.deleted_payments || 0);

      if (deletedBills === 0) {
        alert(`No published bill history was found for ${monthLabel}.`);
      } else {
        alert(`Bill history deleted for ${monthLabel}. ${deletedBills} bill${deletedBills === 1 ? '' : 's'} and ${deletedPayments} payment batch${deletedPayments === 1 ? '' : 'es'} removed.`);
        window.dispatchEvent(new CustomEvent('gocanteen:bill-history-deleted', { detail: { month: selectedMonth } }));
      }
    } catch (error: any) {
      alert(error?.message || 'Could not delete bill history. No changes were completed.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-lg border border-red-200 p-4">
      <h4 className="font-bold text-red-700">Delete Bill History</h4>
      <p className="mt-1 text-sm text-gray-600">Delete published bill and payment history for one selected month.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="month"
          value={selectedMonth}
          onChange={(event) => setSelectedMonth(event.target.value)}
          aria-label="Bill history month"
          className="rounded-md border px-3 py-2.5"
        />
        <button
          type="button"
          onClick={() => void deleteBillHistory()}
          disabled={!selectedMonth || deleting || !supabase}
          className="rounded-md bg-red-600 px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete Bill History'}
        </button>
      </div>
    </div>
  );
};

export default DeleteBillHistory;

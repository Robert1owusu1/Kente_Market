// FILE LOCATION: src/Pages/Vendor/VendorWholesale.tsx
// DESCRIPTION: Vendor view of B2B bulk quote requests (Phase 3, Step 9). Respond
//   with a unit price; buyers then accept/decline. Needs the bulk_wholesale plan
//   feature (enforced server-side).
import { toast } from 'react-toastify';
import { FaBoxes, FaSpinner } from 'react-icons/fa';
import { useGetVendorBulkQuotesQuery, useSendVendorQuoteMutation } from '../../slices/wholesaleApiSlice';
import { formatCurrency } from '../../utils/formatCurrency';

const statusChip: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  quoted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  declined: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const VendorWholesale = () => {
  const { data = [], isLoading } = useGetVendorBulkQuotesQuery();
  const [sendQuote, { isLoading: sending }] = useSendVendorQuoteMutation();

  const respond = async (id: number) => {
    const price = window.prompt('Unit price for this bulk order (GHS per item):');
    if (price === null) return;
    const unitPrice = Number(price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) { toast.error('Enter a valid unit price'); return; }
    const note = window.prompt('Note to the buyer (optional):') ?? undefined;
    try {
      await sendQuote({ id, unitPrice, note, validDays: 14 }).unwrap();
      toast.success('Quote sent to the buyer');
    } catch (e) {
      toast.error((e as { data?: { message?: string } })?.data?.message || 'Could not send quote');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><FaBoxes /> Wholesale requests</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Bulk buyers asking for a quote on your products. Respond with a unit price.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><FaSpinner className="animate-spin h-7 w-7 text-primary" /></div>
      ) : data.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-8 text-center text-gray-500 dark:text-gray-400">No wholesale requests yet.</div>
      ) : (
        <div className="space-y-3">
          {data.map((q) => (
            <div key={q.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{q.productTitle}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Qty <strong>{q.quantity}</strong>{q.companyName ? ` · ${q.companyName}` : ''} · {q.buyerName}
                </div>
                {q.message && <div className="text-xs text-gray-400 mt-1 italic">"{q.message}"</div>}
                {q.quotedUnitPrice != null && (
                  <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">Quoted {formatCurrency(q.quotedUnitPrice, 'GHS')}/unit</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusChip[q.status] || statusChip.declined}`}>{q.status}</span>
                {['pending', 'quoted'].includes(q.status) && (
                  <button onClick={() => respond(q.id)} disabled={sending}
                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
                    {q.status === 'quoted' ? 'Re-quote' : 'Send quote'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VendorWholesale;

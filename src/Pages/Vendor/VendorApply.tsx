// Pages/Vendor/VendorApply.jsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useApplyVendorMutation, useGetMyVendorProfileQuery } from '../../slices/vendorsApiSlice';
import Loader from '../../components/loader/Loader';
import { FaStore, FaShieldAlt, FaCheckCircle, FaUniversity, FaMobileAlt } from 'react-icons/fa';

const inputCls =
  'w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:border-primary text-gray-900 dark:text-white';

const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5';

const MOMO_PROVIDERS = [
  { code: 'MTN', name: 'MTN Mobile Money' },
  { code: 'VOD', name: 'Vodafone Cash' },
  { code: 'ATL', name: 'AirtelTigo Money' },
  { code: 'TGO', name: 'Telecel Cash' },
];

type ApplyForm = {
  businessName: string;
  contactPhone: string;
  payoutType: string;
  bankName: string;
  accountNumber: string;
  bankCode: string;
  momoProvider: string;
  momoNumber: string;
};

const VendorApply = () => {
  const navigate = useNavigate();
  const { data: existing, isLoading, isError } = useGetMyVendorProfileQuery() as {
    data?: {
      vendor?: {
        businessName?: string;
        contactPhone?: string;
        payoutType?: string;
        bankName?: string;
        accountNumber?: string;
        bankCode?: string;
        momoProvider?: string;
        momoNumber?: string;
        [key: string]: unknown;
      };
    };
    isLoading: boolean;
    isError: boolean;
  };

  const [applyVendor, { isLoading: applying }] = useApplyVendorMutation();

  const [form, setForm] = useState<ApplyForm>({
    businessName: '',
    contactPhone: '',
    payoutType: 'bank',
    bankName: '',
    accountNumber: '',
    bankCode: '',
    momoProvider: '',
    momoNumber: '',
  });

  useEffect(() => {
    if (existing?.vendor) {
      setForm({
        businessName: existing.vendor.businessName || '',
        contactPhone: existing.vendor.contactPhone || '',
        payoutType: existing.vendor.payoutType || 'bank',
        bankName: existing.vendor.bankName || '',
        accountNumber: existing.vendor.accountNumber || '',
        bankCode: existing.vendor.bankCode || '',
        momoProvider: existing.vendor.momoProvider || '',
        momoNumber: existing.vendor.momoNumber || '',
      });
    }
  }, [existing]);

  const set = (k: keyof ApplyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }) as ApplyForm);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.businessName) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (form.payoutType === 'momo') {
      if (!form.momoProvider || !form.momoNumber) {
        toast.error('Please enter your mobile money provider and number');
        return;
      }
    } else if (!form.bankName || !form.accountNumber || !form.bankCode) {
      toast.error('Please fill in all bank fields');
      return;
    }
    try {
      const res = (await applyVendor(form).unwrap()) as { message?: string };
      toast.success(res.message || 'Vendor application submitted!');
      navigate('/vendor');
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || err?.message || 'Failed to submit application');
    }
  };

  if (isLoading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader /></div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
          <FaStore className="text-3xl text-primary" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold">
          {isError || !existing?.vendor ? 'Become a Seller' : 'Update Your Seller Profile'}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-md mx-auto">
          Add your bank or mobile money (Momo) details to receive escrow payouts when customers receive your products.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 sm:p-8 mb-6">
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
          <FaShieldAlt className="mt-0.5 text-amber-500" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Payouts are held in escrow and released only after customers confirm delivery of their
            orders. A platform commission is deducted on release.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className={labelCls}>Business name *</label>
            <input className={inputCls} value={form.businessName} onChange={set('businessName')} placeholder="e.g. Kente Designs GH" />
          </div>

          <div>
            <label className={labelCls}>Contact phone</label>
            <input className={inputCls} value={form.contactPhone} onChange={set('contactPhone')} placeholder="+233 ..." />
          </div>

          <div>
            <label className={labelCls}>Payout method *</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, payoutType: 'bank' }))}
                className={`flex items-center gap-3 border rounded-lg px-4 py-3 text-left transition-colors ${
                  form.payoutType === 'bank'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                }`}
              >
                <FaUniversity className="text-xl" />
                <span>
                  <span className="block font-semibold text-sm">Bank account</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">Receive payouts to a bank account</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, payoutType: 'momo' }))}
                className={`flex items-center gap-3 border rounded-lg px-4 py-3 text-left transition-colors ${
                  form.payoutType === 'momo'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                }`}
              >
                <FaMobileAlt className="text-xl" />
                <span>
                  <span className="block font-semibold text-sm">Mobile money (Momo)</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">Receive payouts to your MoMo wallet</span>
                </span>
              </button>
            </div>
          </div>

          {form.payoutType === 'momo' ? (
            <div className="space-y-5">
              <div>
                <label className={labelCls}>Mobile money provider *</label>
                <select
                  className={inputCls}
                  value={form.momoProvider}
                  onChange={set('momoProvider')}
                >
                  <option value="">Select provider</option>
                  {MOMO_PROVIDERS.map((p) => (
                    <option key={p.code} value={p.code}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Mobile money number *</label>
                <input
                  className={inputCls}
                  value={form.momoNumber}
                  onChange={set('momoNumber')}
                  placeholder="e.g. 0551234567"
                  inputMode="numeric"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className={labelCls}>Bank name *</label>
                  <input className={inputCls} value={form.bankName} onChange={set('bankName')} placeholder="e.g. GCB Bank" />
                </div>
                <div>
                  <label className={labelCls}>Bank code *</label>
                  <input className={inputCls} value={form.bankCode} onChange={set('bankCode')} placeholder="e.g. 050112" />
                </div>
              </div>

              <div>
                <label className={labelCls}>Account number *</label>
                <input className={inputCls} value={form.accountNumber} onChange={set('accountNumber')} placeholder="0123456789012" inputMode="numeric" />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={applying}
            className="w-full flex items-center justify-center gap-2 bg-primary text-white py-3 px-6 rounded-lg hover:bg-primary/90 transition-colors font-semibold disabled:opacity-60"
          >
            <FaCheckCircle />
            {applying ? 'Submitting...' : isError || !existing?.vendor ? 'Submit Application' : 'Update Details'}
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Not ready yet? <Link to="/" className="text-primary hover:underline">Continue shopping</Link>
      </p>
    </div>
  );
};

export default VendorApply;
// Pges/Vendor/VendorApply.jsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useApplyVendorMutation, useGetMyVendorProfileQuery } from '../../slices/vendorsApiSlice';
import Loader from '../../components/loader/Loader.jsx';
import { FaStore, FaShieldAlt, FaCheckCircle } from 'react-icons/fa';

const inputCls =
  'w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:border-primary text-gray-900 dark:text-white';

const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5';

const VendorApply = () => {
  const navigate = useNavigate();
  const { data: existing, isLoading, isError } = useGetMyVendorProfileQuery();

  const [applyVendor, { isLoading: applying }] = useApplyVendorMutation();

  const [form, setForm] = useState({
    businessName: '',
    contactPhone: '',
    bankName: '',
    accountNumber: '',
    bankCode: '',
  });

  useEffect(() => {
    if (existing?.vendor) {
      setForm({
        businessName: existing.vendor.businessName || '',
        contactPhone: existing.vendor.contactPhone || '',
        bankName: existing.vendor.bankName || '',
        accountNumber: existing.vendor.accountNumber || '',
        bankCode: existing.vendor.bankCode || '',
      });
    }
  }, [existing]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.businessName || !form.bankName || !form.accountNumber || !form.bankCode) {
      toast.error('Please fill in all required fields');
      return;
    }
    try {
      const res = await applyVendor(form).unwrap();
      toast.success(res.message || 'Vendor application submitted!');
      navigate('/vendor');
    } catch (err) {
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
          Add your bank details to receive escrow payouts when customers receive your products.
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
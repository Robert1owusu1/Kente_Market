// Pages/adminDashboardPages/Certificates/CertificatesAdminPage.jsx
// Admin: issue authenticity certificates against paid orders + list all.
import { useState } from 'react';
import { FaCertificate, FaPlus, FaSpinner, FaCheckCircle, FaTimesCircle, FaTimes } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useGetAllCertificatesQuery, useIssueCertificateMutation } from '../../../slices/marketplaceApiSlice';

const formatDate = (d) => {
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return 'N/A';
  }
};

const IssueModal = ({ onClose }) => {
  const [orderId, setOrderId] = useState('');
  const [productId, setProductId] = useState('');
  const [issue, { isLoading }] = useIssueCertificateMutation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!orderId.trim()) return toast.error('Order ID is required');
    try {
      const res = await issue({
        orderId: parseInt(orderId),
        productId: productId ? parseInt(productId) : undefined,
      }).unwrap();
      if (res.certificate) {
        toast.success(`Certificate ${res.certificate.certificateNumber} issued`);
      } else {
        toast.success(res.message || 'Certificate issued');
      }
      onClose();
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to issue certificate');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FaCertificate /> Issue certificate
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><FaTimes /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Issues a certified provenance record (pattern, weaver, workshop) against a paid order. Numbered KT-YYYY-00001...
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Order ID</label>
            <input type="number" value={orderId} onChange={(e) => setOrderId(e.target.value)} required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Product ID (optional)</label>
            <input type="number" value={productId} onChange={(e) => setProductId(e.target.value)}
              placeholder="Defaults to first vendor product in the order"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white" />
          </div>
          <button type="submit" disabled={isLoading}
            className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2">
            {isLoading ? <FaSpinner className="animate-spin" /> : <FaPlus />} Issue certificate
          </button>
        </form>
      </div>
    </div>
  );
};

const CertificatesAdminPage = () => {
  const [showIssue, setShowIssue] = useState(false);
  const { data: certificates = [], isLoading, isError } = useGetAllCertificatesQuery();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Authenticity Certificates</h2>
        <button
          onClick={() => setShowIssue(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 inline-flex items-center gap-2 text-sm"
        >
          <FaPlus /> Issue certificate
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center"><FaSpinner className="animate-spin h-10 w-10 text-indigo-600 mx-auto" /></div>
      ) : isError ? (
        <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
          <p className="text-red-600 dark:text-red-400 font-medium">Failed to load certificates.</p>
        </div>
      ) : certificates.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
          <FaCertificate className="mx-auto text-4xl mb-4 opacity-50" />
          <p>No certificates issued yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {certificates.map((c) => (
            <div key={c.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-5 border-l-4 border-amber-500">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-amber-600 dark:text-amber-400">{c.certificateNumber}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  c.status === 'revoked'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                }`}>
                  {c.status === 'revoked' ? <FaTimesCircle /> : <FaCheckCircle />}
                  {c.status}
                </span>
              </div>
              <p className="font-bold text-gray-900 dark:text-white">{c.patternName || 'Kente piece'}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Weaver: {c.weaverName || '—'}
                {c.workshop || c.village ? ` · ${c.workshop || c.village}` : ''}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {c.productTitle || `Product #${c.productId}`}
                {c.orderNumber ? ` · Order ${c.orderNumber}` : ''}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Registered {formatDate(c.dateRegistered)}</p>
            </div>
          ))}
        </div>
      )}

      {showIssue && <IssueModal onClose={() => setShowIssue(false)} />}
    </div>
  );
};

export default CertificatesAdminPage;
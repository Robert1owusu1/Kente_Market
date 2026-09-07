// Pages/Certificates/MyCertificates.jsx
// Authenticity certificates for the customer's purchases, with a public
// verification box (anyone can confirm a certificate number or QR token).
import { useState } from 'react';
import { FaSpinner, FaCertificate, FaMedal, FaCheckCircle, FaTimesCircle, FaSearch, FaQrcode } from 'react-icons/fa';
import { useGetMyCertificatesQuery, useVerifyCertificateQuery } from '../../slices/marketplaceApiSlice';

interface CertificateView {
  id?: number | string;
  certificateNumber?: string;
  patternName?: string;
  weaverName?: string;
  productImage?: string;
  workshop?: string;
  village?: string;
  dateRegistered?: string;
  orderNumber?: string;
  status?: string;
  [key: string]: unknown;
}

interface VerifyResult {
  verified?: boolean;
  message?: string;
  certificate?: CertificateView | null;
  [key: string]: unknown;
}

const formatDate = (d: string | number) => {
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return 'N/A';
  }
};

const CertificateCard = ({ c }: { c: CertificateView }) => (
  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5 border-t-4 border-amber-500 relative overflow-hidden">
    <div className="absolute right-3 top-3 text-amber-200 dark:text-amber-800">
      <FaCertificate className="text-4xl" />
    </div>
    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1">
      <FaMedal />
      <span className="font-semibold">{c.certificateNumber}</span>
    </div>
    {c.productImage ? (
      <img src={c.productImage} alt={c.patternName} className="w-16 h-16 rounded-lg object-cover my-3" />
    ) : null}
    <h3 className="font-bold text-gray-900 dark:text-white">{c.patternName || 'Authentic Kente'}</h3>
    <p className="text-sm text-gray-600 dark:text-gray-400">
      Woven by <span className="font-medium text-gray-800 dark:text-gray-200">{c.weaverName || 'Verified artisan'}</span>
      {c.workshop ? ` · ${c.workshop}` : ''}{c.village ? ` · ${c.village}` : ''}
    </p>
    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Registered {formatDate(c.dateRegistered || '')}</p>
    <p className="text-xs text-gray-500 dark:text-gray-400">
      {c.orderNumber ? `Order ${c.orderNumber}` : ''}
    </p>
    <span className={`inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${
      c.status === 'revoked'
        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    }`}>
      {c.status === 'revoked' ? <FaTimesCircle /> : <FaCheckCircle />}
      {c.status === 'revoked' ? 'Revoked' : 'Active'}
    </span>
  </div>
);

const VerifyBox = () => {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useVerifyCertificateQuery(submitted ?? '', { skip: !submitted });
  const verifyResult = data as unknown as VerifyResult | undefined;
  const apiErr = error as { data?: { message?: string }; message?: string } | undefined;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
        <FaQrcode className="text-amber-600" /> Verify a certificate
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Enter a certificate number (e.g. KT-2026-00001) or scan the QR token printed on the certificate.
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim()); }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Certificate number or QR token"
          className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={!query.trim() || isLoading}
          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-2"
        >
          {isLoading ? <FaSpinner className="animate-spin" /> : <FaSearch />} Check
        </button>
      </form>

      {isError && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          {apiErr?.data?.message || 'No certificate found for that number.'}
        </p>
      )}
      {data && !isError && verifyResult && (
        <div className={`mt-4 rounded-lg p-4 ${verifyResult.verified ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
          {verifyResult.certificate ? (
            <>
              <p className="font-semibold text-gray-900 dark:text-white mb-1">
                {verifyResult.verified ? 'Authentic — verified' : 'Verification failed'}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {verifyResult.verified
                  ? `${verifyResult.certificate.certificateNumber} — ${verifyResult.certificate.patternName}, woven by ${verifyResult.certificate.weaverName || 'a verified artisan'}, registered ${formatDate(verifyResult.certificate.dateRegistered || '')}.`
                  : verifyResult.message}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300">{verifyResult.message}</p>
          )}
        </div>
      )}
    </div>
  );
};

const MyCertificates = () => {
  const { data: certificates = [], isLoading, isError } = useGetMyCertificatesQuery();

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <FaSpinner className="animate-spin h-10 w-10 text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] bg-gray-50 dark:bg-gray-900 py-12">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="flex items-center gap-3 mb-2">
          <FaCertificate className="text-2xl text-amber-600" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Authenticity Certificates</h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-2xl">
          Every certified Kente piece carries a verified provenance record of its pattern, weaver and workshop.
        </p>

        {isError && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-red-600 dark:text-red-400">
            Failed to load your certificates.
          </div>
        )}

        <div className="space-y-4 mb-12">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">My certificates</h2>
          {certificates.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
              <FaCertificate className="mx-auto text-5xl text-gray-300 dark:text-gray-600 mb-4" />
              <p>You have no certificates yet.</p>
              <p className="text-sm mt-1">Certificates are issued after a delivered order is verified.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {certificates.map((c) => <CertificateCard key={c.id} c={c as unknown as CertificateView} />)}
            </div>
          )}
        </div>

        <VerifyBox />
      </div>
    </div>
  );
};

export default MyCertificates;
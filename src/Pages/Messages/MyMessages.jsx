// Pages/Messages/MyMessages.jsx
// Customer inbox: enquiries sent to vendors + vendor replies.
import { FaSpinner, FaEnvelope, FaStore, FaReply, FaClock } from 'react-icons/fa';
import { Link } from 'react-router-dom';
import { useGetMyMessagesQuery } from '../../slices/marketplaceApiSlice';

const statusBadge = (status) => {
  const map = {
    open: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    replied: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    closed: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  };
  return map[status] || map.open;
};

const formatDate = (d) => {
  try {
    return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'N/A';
  }
};

const MyMessages = () => {
  const { data: messages = [], isLoading, isError } = useGetMyMessagesQuery();

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <FaSpinner className="animate-spin h-10 w-10 text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] bg-gray-50 dark:bg-gray-900 py-12">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="flex items-center gap-3 mb-8">
          <FaEnvelope className="text-2xl text-amber-600" />
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">My Messages</h1>
        </div>

        {isError && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-red-600 dark:text-red-400">
            Failed to load your messages.
          </div>
        )}

        {messages.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-12 text-center">
            <FaEnvelope className="mx-auto text-5xl text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-600 dark:text-gray-400 mb-2">No messages yet.</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
              Visit an artisan store and ask about a custom Kente design.
            </p>
            <Link to="/vendors" className="inline-block text-amber-600 dark:text-amber-400 font-semibold">
              Browse artisan stores →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <div key={m.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <FaStore className="text-amber-600" />
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {m.businessName || `Store #${m.vendorId}`}
                    </span>
                    {m.productTitle && (
                      <Link to={`/product/${m.productId}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                        · {m.productTitle}
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge(m.status)}`}>
                      {m.status}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <FaClock /> {formatDate(m.created_at)}
                    </span>
                  </div>
                </div>

                <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{m.subject}</h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm whitespace-pre-line">{m.body}</p>

                {m.reply && (
                  <div className="mt-4 bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 rounded-r-lg p-3">
                    <p className="text-xs font-semibold text-green-700 dark:text-green-400 flex items-center gap-1 mb-1">
                      <FaReply /> Store replied
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{m.reply}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyMessages;
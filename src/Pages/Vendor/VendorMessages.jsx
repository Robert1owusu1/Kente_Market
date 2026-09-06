// Pages/Vendor/VendorMessages.jsx
// Vendor inbox: customer enquiries with inline reply + close.
import { useState } from 'react';
import { FaSpinner, FaEnvelope, FaReply, FaCheckDouble } from 'react-icons/fa';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  useGetVendorMessagesQuery,
  useReplyToVendorMessageMutation,
  useCloseVendorMessageMutation,
} from '../../slices/marketplaceApiSlice';

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
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'N/A';
  }
};

const MessageCard = ({ m }) => {
  const [reply, setReply] = useState(m.reply || '');
  const [replying, setReplying] = useState(false);
  const [sendReply] = useReplyToVendorMessageMutation();
  const [close] = useCloseVendorMessageMutation();

  const handleReply = async () => {
    if (!reply.trim()) return toast.error('Reply is required');
    setReplying(true);
    try {
      await sendReply({ id: m.id, reply: reply.trim() }).unwrap();
      toast.success('Reply sent');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  const handleClose = async () => {
    try {
      await close(m.id).unwrap();
      toast.success('Message closed');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to close message');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-3">
          {m.profile_picture ? (
            <img src={m.profile_picture} alt={m.firstName} className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-indigo-600 dark:text-indigo-300 font-bold">
              {(m.firstName || 'C')[0]}
            </div>
          )}
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">
              {m.firstName} {m.lastName}
            </p>
            {m.productTitle && (
              <Link to={`/product/${m.productId}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                {m.productTitle}
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge(m.status)}`}>
            {m.status}
          </span>
          <span className="text-xs text-gray-400">{formatDate(m.created_at)}</span>
        </div>
      </div>

      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{m.subject}</h3>
      <p className="text-gray-600 dark:text-gray-400 text-sm whitespace-pre-line mb-4">{m.body}</p>

      {m.status !== 'closed' && (
        <div className="border-t dark:border-gray-700 pt-4 space-y-3">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            placeholder="Write your reply to the customer..."
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
          />
          <div className="flex gap-2">
            <button
              onClick={handleReply}
              disabled={replying}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-2 text-sm"
            >
              {replying ? <FaSpinner className="animate-spin" /> : <FaReply />} Reply
            </button>
            {m.status === 'open' && (
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 inline-flex items-center gap-2 text-sm"
              >
                <FaCheckDouble /> Close
              </button>
            )}
          </div>
        </div>
      )}

      {m.reply && m.status !== 'open' && (
        <div className="mt-4 bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 rounded-r-lg p-3">
          <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">
            <FaReply className="inline mr-1" /> Your reply{m.replied_at ? ` · ${formatDate(m.replied_at)}` : ''}
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{m.reply}</p>
        </div>
      )}
    </div>
  );
};

const VendorMessages = () => {
  const { data: messages = [], isLoading, isError } = useGetVendorMessagesQuery();

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <FaSpinner className="animate-spin h-10 w-10 text-indigo-600 mx-auto" />
        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading messages...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load messages.</p>
      </div>
    );
  }

  const openCount = messages.filter((m) => m.status === 'open').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Customer Messages</h2>
        <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-sm font-medium">
          {openCount} open
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-10 text-center text-gray-600 dark:text-gray-400">
          <FaEnvelope className="mx-auto text-4xl mb-4 opacity-50" />
          <p>No messages from customers yet.</p>
        </div>
      ) : (
        messages.map((m) => <MessageCard key={m.id} m={m} />)
      )}
    </div>
  );
};

export default VendorMessages;
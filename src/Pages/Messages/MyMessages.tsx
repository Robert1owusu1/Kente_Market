// Pages/Messages/MyMessages.jsx
// Customer inbox: full buyer <-> vendor conversation threads with follow-ups.
import { useState } from 'react';
import { FaSpinner, FaEnvelope, FaStore, FaReply, FaClock } from 'react-icons/fa';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  useGetMyMessagesQuery,
  useReplyToCustomerMessageMutation,
} from '../../slices/marketplaceApiSlice';

interface MessagePost {
  id?: number | string;
  sender?: string;
  body?: string;
  created_at?: string;
}

interface MessageView {
  id?: number | string;
  businessName?: string;
  vendorId?: number | string;
  productTitle?: string;
  productId?: number | string;
  status?: string;
  created_at?: string;
  subject?: string;
  body?: string;
  reply?: string;
  posts?: MessagePost[];
}

interface Bubble {
  sender: string;
  body: string;
  created_at?: string;
}

// The thread header holds the opening customer message; message_posts holds
// everything after it (and for threads created before threading existed, the
// first post may be the vendor reply). Assemble the display list ensuring the
// opening message isn't duplicated.
const buildBubbles = (m: MessageView): Bubble[] => {
  const bubbles: Bubble[] = [{ sender: 'customer', body: m.body || '', created_at: m.created_at }];
  (m.posts || []).forEach((p, i) => {
    if (i === 0 && p.sender === 'customer') return; // opening post == m.body
    bubbles.push({ sender: p.sender || 'customer', body: p.body || '', created_at: p.created_at });
  });
  return bubbles;
};

const statusBadge = (status: string) => {
  const map = {
    open: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    replied: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    closed: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  } as const;
  return map[status as keyof typeof map] || map.open;
};

const formatDate = (d: string | number) => {
  try {
    return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'N/A';
  }
};

const MessageCard = ({ m }: { m: MessageView }) => {
  const [followUp, setFollowUp] = useState('');
  const [sending, setSending] = useState(false);
  const [sendFollowUp] = useReplyToCustomerMessageMutation();
  const bubbles = buildBubbles(m);
  const closed = m.status === 'closed';

  const handleSend = async () => {
    if (!followUp.trim()) return toast.error('Reply is required');
    setSending(true);
    try {
      await sendFollowUp({ id: m.id as number | string, body: followUp.trim() }).unwrap();
      toast.success('Reply sent');
      setFollowUp('');
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-5">
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
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusBadge(m.status || '')}`}>
            {m.status}
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <FaClock /> {formatDate(m.created_at || '')}
          </span>
        </div>
      </div>

      <h3 className="font-semibold text-gray-900 dark:text-white mb-3">{m.subject}</h3>

      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {bubbles.map((b, i) => (
          <div key={i} className={`flex ${b.sender === 'customer' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-line ${
              b.sender === 'customer'
                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100'
                : 'bg-green-50 dark:bg-green-900/30 text-gray-700 dark:text-gray-200'
            }`}>
              <p className="text-[10px] font-semibold mb-1 opacity-70">
                {b.sender === 'customer' ? 'You' : m.businessName || 'Store'}
                {b.created_at ? ` · ${formatDate(b.created_at)}` : ''}
              </p>
              {b.body}
            </div>
          </div>
        ))}
      </div>

      {!closed && (
        <div className="border-t dark:border-gray-700 pt-4 mt-4 space-y-3">
          <textarea
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            rows={2}
            placeholder="Follow up with the store..."
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
          />
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-60 inline-flex items-center gap-2 text-sm"
          >
            {sending ? <FaSpinner className="animate-spin" /> : <FaReply />} Send reply
          </button>
        </div>
      )}
    </div>
  );
};

const MyMessages = () => {
  const { data: rawMessages = [], isLoading, isError } = useGetMyMessagesQuery();
  const messages = (rawMessages as unknown as MessageView[]);

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
              <MessageCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyMessages;
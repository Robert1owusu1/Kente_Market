// components/Messages/AskModal.tsx
// Shared "Ask the weaver" modal used by both the product page and the storefront.
// Thread-aware: it first looks for an existing conversation (vendor + product)
// so enquiries reuse the thread instead of spawning duplicates, per the
// message-weaver CTA plan.
import { useState } from 'react';
import type React from 'react';
import {
  FaTimes, FaEnvelope, FaSpinner, FaReply, FaCheckCircle,
  FaComments, FaUser, FaStore,
} from 'react-icons/fa';
import { toast } from 'react-toastify';
import {
  useFindMessageThreadQuery,
  useSendVendorMessageMutation,
  useReplyToCustomerMessageMutation,
} from '../../slices/marketplaceApiSlice';
import type { VendorMessage } from '../../slices/apiTypes';

interface AskModalProps {
  vendorId?: number | string;
  vendorName?: string;
  productId?: number | string;
  onClose: () => void;
}

const AskModal = ({ vendorId, vendorName, productId, onClose }: AskModalProps) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [followUp, setFollowUp] = useState('');

  const {
    data: threadData,
    isLoading: threadLoading,
    refetch: refetchThread,
  } = useFindMessageThreadQuery(
    { vendorId: vendorId ?? 0, productId: productId ? Number(productId) : undefined },
    { skip: !vendorId },
  );

  const [sendMessage, { isLoading: sending }] = useSendVendorMessageMutation();
  const [sendFollowUp, { isLoading: replying }] = useReplyToCustomerMessageMutation();

  const thread = (threadData?.thread as VendorMessage | undefined) ?? null;
  const posts = (thread?.posts || []) as Array<{ id: number | string; sender: string; body: string }>;

  const handleNewEnquiry = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and message are required');
      return;
    }
    try {
      await sendMessage({
        vendorId,
        productId: productId ? Number(productId) : undefined,
        subject: subject.trim(),
        body: body.trim(),
      }).unwrap();
      toast.success('Message sent to the weaver');
      onClose();
    } catch (err) {
      const apiErr = err as { data?: { message?: string }; message?: string; error?: string } | undefined;
      toast.error(apiErr?.data?.message || 'Failed to send message');
    }
  };

  const handleFollowUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!followUp.trim()) {
      toast.error('Write a message first');
      return;
    }
    if (thread?.id == null) return;
    try {
      await sendFollowUp({ id: thread.id, body: followUp.trim() }).unwrap();
      setFollowUp('');
      toast.success('Reply sent');
      await refetchThread();
    } catch (err) {
      const apiErr = err as { data?: { message?: string }; message?: string; error?: string } | undefined;
      toast.error(apiErr?.data?.message || 'Failed to send reply');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            {thread ? (
              <>
                <FaComments className="inline text-amber-500 mr-2" />
                Continue conversation with {vendorName || 'your weaver'}
              </>
            ) : (
              <>
                <FaEnvelope className="inline text-amber-500 mr-2" />
                Ask {vendorName || 'your weaver'}
              </>
            )}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <FaTimes />
          </button>
        </div>

        {threadLoading ? (
          <div className="flex justify-center py-8 text-gray-400">
            <FaSpinner className="animate-spin h-6 w-6" />
          </div>
        ) : thread ? (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <FaStore className="text-amber-500" />
                <span className="font-semibold">{thread.subject}</span>
                <span
                  className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                    thread.status === 'replied'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : thread.status === 'closed'
                        ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  }`}
                >
                  {thread.status === 'replied' ? 'Replied' : thread.status === 'closed' ? 'Closed' : 'Open'}
                </span>
              </p>
              {thread.status === 'replied' && thread.reply && (
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
                  {thread.reply}
                </p>
              )}
            </div>

            {posts.length > 0 && (
              <div className="space-y-2">
                {posts.slice(-3).map((post) => (
                  <div
                    key={String(post.id)}
                    className={`flex items-start gap-2 text-sm ${
                      post.sender === 'customer' ? '' : 'flex-row-reverse'
                    }`}
                  >
                    {post.sender === 'customer' ? (
                      <FaUser className="mt-0.5 text-amber-500 shrink-0" />
                    ) : (
                      <FaStore className="mt-0.5 text-emerald-500 shrink-0" />
                    )}
                    <span
                      className={`max-w-[80%] px-3 py-2 rounded-lg ${
                        post.sender === 'customer'
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                          : 'bg-emerald-50 dark:bg-emerald-900/30 text-gray-800 dark:text-gray-200'
                      }`}
                    >
                      {post.body}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {thread.status === 'closed' ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                This conversation is closed. Start a new one by asking the weaver again below.
              </p>
            ) : (
              <form onSubmit={handleFollowUp} className="space-y-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Follow up
                </label>
                <textarea
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  maxLength={5000}
                  rows={3}
                  placeholder="Continue the conversation..."
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={replying}
                  className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {replying ? <FaSpinner className="animate-spin" /> : <FaReply />} Send follow-up
                </button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleNewEnquiry} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={255}
                placeholder={productId ? 'e.g. Question about this piece' : 'e.g. Custom order in blue & gold'}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Message
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={5000}
                rows={4}
                placeholder="Tell the weaver what you are looking for..."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={sending}
              className="w-full px-4 py-2.5 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {sending ? <FaSpinner className="animate-spin" /> : <FaEnvelope />} Send enquiry
            </button>
            {productId && (
              <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                <FaCheckCircle /> We'll attach this product to your enquiry so the weaver has context.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

export default AskModal;
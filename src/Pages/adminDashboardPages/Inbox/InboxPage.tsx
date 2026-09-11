// Pages/adminDashboardPages/Inbox/InboxPage.jsx
// Admin inbox: contact submissions, support tickets, and buyer <-> vendor messages.
import React, { useState } from 'react';
import {
  FaEnvelope, FaLifeRing, FaComments, FaSpinner, FaTrash, FaReply,
  FaCheck, FaTimes, FaInbox,
} from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useListContactsQuery, useDeleteContactMutation } from '../../../slices/miscApiSlice';
import {
  useListAllTicketsQuery,
  useReplyTicketMutation,
  useUpdateTicketStatusMutation,
} from '../../../slices/supportApiSlice';
import {
  useGetAllMessagesQuery,
  useReplyToVendorMessageMutation,
  useCloseVendorMessageMutation,
} from '../../../slices/marketplaceApiSlice';

type Tab = 'contact' | 'support' | 'messages';

interface ContactItem {
  id?: number | string;
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  created_at?: string;
  createdAt?: string;
  [key: string]: unknown;
}

interface TicketItem {
  id?: number | string;
  userId?: number | string;
  subject?: string;
  message?: string;
  category?: string;
  reply?: string;
  status?: string;
  repliedAt?: string;
  created_at?: string;
  createdAt?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  [key: string]: unknown;
}

interface MsgItem {
  id?: number | string;
  vendorId?: number | string;
  customerId?: number | string;
  subject?: string;
  body?: string;
  reply?: string;
  status?: string;
  created_at?: string;
  replied_at?: string;
  productTitle?: string;
  businessName?: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string;
  [key: string]: unknown;
}

type BusinessItem = ContactItem | TicketItem | MsgItem;

const statusBadge: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  answered: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  replied: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  closed: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
};

const formatDate = (value?: string | number) => {
  if (!value) return 'N/A';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  } catch {
    return 'Invalid Date';
  }
};

const StatusPill = ({ status }: { status?: string }) => (
  <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadge[status ?? ''] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
    {status || 'unknown'}
  </span>
);

const InboxPage = () => {
  const [tab, setTab] = useState<Tab>('contact');
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    data: contacts = [],
    isLoading: contactsLoading,
  } = useListContactsQuery();
  const [deleteContact, { isLoading: deletingContact }] = useDeleteContactMutation();

  const {
    data: tickets = [],
    isLoading: ticketsLoading,
  } = useListAllTicketsQuery();
  const [replyTicket] = useReplyTicketMutation();
  const [updateTicketStatus, { isLoading: updatingTicket }] = useUpdateTicketStatusMutation();

  const {
    data: messages = [],
    isLoading: messagesLoading,
  } = useGetAllMessagesQuery();
  const [replyToMessage] = useReplyToVendorMessageMutation();
  const [closeMessage] = useCloseVendorMessageMutation();

  const contactsList = contacts as ContactItem[];
  const ticketsList = tickets as TicketItem[];
  const messagesList = messages as MsgItem[];

  const refresh = () => {
    setOpenReplyId(null);
    setReplyText('');
  };

  // ---------- Contact ----------
  const handleDeleteContact = async (id: number | string) => {
    if (!window.confirm('Delete this contact message? This cannot be undone.')) return;
    setBusyId(String(id));
    try {
      await deleteContact(id).unwrap();
      toast.success('Message deleted');
    } catch (error) {
      const err = error as { data?: { message?: string } };
      toast.error(err?.data?.message || 'Failed to delete message');
    } finally {
      setBusyId(null);
    }
  };

  // ---------- Support ----------
  const handleReplyTicket = async (ticket: TicketItem) => {
    if (!replyText.trim()) {
      toast.error('Reply is required');
      return;
    }
    setBusyId(String(ticket.id));
    try {
      await replyTicket({ id: ticket.id as number | string, reply: replyText.trim() }).unwrap();
      toast.success('Reply saved');
      refresh();
    } catch (error) {
      const err = error as { data?: { message?: string } };
      toast.error(err?.data?.message || 'Failed to save reply');
    } finally {
      setBusyId(null);
    }
  };

  const handleTicketStatus = async (ticket: TicketItem, status: string) => {
    setBusyId(String(ticket.id));
    try {
      await updateTicketStatus({ id: ticket.id as number | string, status }).unwrap();
      toast.success(`Ticket ${status}`);
    } catch (error) {
      const err = error as { data?: { message?: string } };
      toast.error(err?.data?.message || 'Failed to update ticket');
    } finally {
      setBusyId(null);
    }
  };

  // ---------- Vendor messages ----------
  const handleReplyMessage = async (msg: MsgItem) => {
    if (!replyText.trim()) {
      toast.error('Reply is required');
      return;
    }
    setBusyId(String(msg.id));
    try {
      await replyToMessage({ id: msg.id as number | string, reply: replyText.trim() }).unwrap();
      toast.success('Reply sent');
      refresh();
    } catch (error) {
      const err = error as { data?: { message?: string } };
      toast.error(err?.data?.message || 'Failed to send reply');
    } finally {
      setBusyId(null);
    }
  };

  const handleCloseMessage = async (msg: MsgItem) => {
    setBusyId(String(msg.id));
    try {
      await closeMessage(msg.id as number | string).unwrap();
      toast.success('Message closed');
    } catch (error) {
      const err = error as { data?: { message?: string } };
      toast.error(err?.data?.message || 'Failed to close message');
    } finally {
      setBusyId(null);
    }
  };

  const renderReplyPanel = (item: BusinessItem, onSend: () => void) => {
    if (openReplyId !== String(item.id)) return null;
    return (
      <div className="mt-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Type your reply..."
          rows={3}
          className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={onSend}
            disabled={busyId === String(item.id) || !replyText.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <FaReply /> {busyId === String(item.id) ? 'Sending...' : 'Send'}
          </button>
          <button
            onClick={() => { setOpenReplyId(null); setReplyText(''); }}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const tabButton = (id: Tab, label: string, icon: React.ReactNode, count: number) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition ${
        tab === id
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span className={`px-2 py-0.5 rounded-full text-xs ${tab === id ? 'bg-white/20' : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200'}`}>
          {count}
        </span>
      )}
    </button>
  );

  const renderTable = (head: React.ReactNode, body: React.ReactNode, loading: boolean, emptyText: string) => (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
      {loading ? (
        <div className="p-8 text-center">
          <FaSpinner className="animate-spin h-8 w-8 text-indigo-600 mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      ) : body === null ? (
        <div className="p-12 text-center text-gray-500 dark:text-gray-400">
          <FaInbox className="mx-auto text-4xl mb-4 opacity-50" />
          {emptyText}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr className="text-left text-sm text-gray-600 dark:text-gray-400">{head}</tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Inbox</h2>
          <p className="text-sm text-gray-500 mt-1">Contact submissions, support tickets, and messages</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabButton('contact', 'Contact', <FaEnvelope />, contactsList.length)}
        {tabButton('support', 'Support', <FaLifeRing />, ticketsList.filter((t) => t.status === 'open' || t.status === 'pending').length)}
        {tabButton('messages', 'Messages', <FaComments />, messagesList.filter((m) => m.status === 'open').length)}
      </div>

      {/* Contact tab */}
      {tab === 'contact' && renderTable(
        <>
          <th className="px-4 py-3">From</th>
          <th className="px-4 py-3">Subject</th>
          <th className="px-4 py-3">Message</th>
          <th className="px-4 py-3">Date</th>
          <th className="px-4 py-3">Actions</th>
        </>,
        contactsList.length === 0 ? null : (
          contactsList.map((c) => (
            <tr key={String(c.id)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
              <td className="px-4 py-3">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{c.name || 'Anonymous'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{c.email}</p>
                {c.phone && <p className="text-xs text-gray-500 dark:text-gray-400">{String(c.phone)}</p>}
              </td>
              <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-[160px] truncate">{c.subject || 'No subject'}</td>
              <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs">
                <p className="line-clamp-3 whitespace-pre-wrap">{String(c.message || '')}</p>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{formatDate(c.created_at || c.createdAt)}</td>
              <td className="px-4 py-3">
                <button
                  onClick={() => handleDeleteContact(c.id as number | string)}
                  disabled={busyId === String(c.id) || deletingContact}
                  className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900 rounded disabled:opacity-50"
                  title="Delete"
                >
                  <FaTrash />
                </button>
              </td>
            </tr>
          ))
        ),
        contactsLoading,
        'No contact submissions yet'
      )}

      {/* Support tab */}
      {tab === 'support' && renderTable(
        <>
          <th className="px-4 py-3">Customer</th>
          <th className="px-4 py-3">Subject</th>
          <th className="px-4 py-3">Message</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Date</th>
          <th className="px-4 py-3">Actions</th>
        </>,
        ticketsList.length === 0 ? null : (
          ticketsList.map((t) => (
            <tr key={String(t.id)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 align-top">
              <td className="px-4 py-3">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {`${t.firstName || ''} ${t.lastName || ''}`.trim() || `User #${t.userId}`}
                </p>
                {t.email && <p className="text-xs text-gray-500 dark:text-gray-400">{t.email}</p>}
              </td>
              <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-[160px]">
                <p className="truncate">{t.subject || 'No subject'}</p>
                {t.category && <span className="text-xs text-indigo-600 dark:text-indigo-400">{String(t.category)}</span>}
              </td>
              <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs">
                <p className="whitespace-pre-wrap line-clamp-3">{String(t.message || '')}</p>
                {t.reply && (
                  <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/30 rounded text-xs text-green-800 dark:text-green-200">
                    <strong>Reply:</strong> {String(t.reply)}
                  </div>
                )}
              </td>
              <td className="px-4 py-3"><StatusPill status={t.status as string} /></td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{formatDate(t.created_at || t.createdAt)}</td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  {t.status !== 'closed' && (
                    <button
                      onClick={() => { setOpenReplyId(openReplyId === String(t.id) ? null : String(t.id)); setReplyText(''); }}
                      className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded"
                      title="Reply"
                    >
                      <FaReply />
                    </button>
                  )}
                  {t.status !== 'closed' && (
                    <button
                      onClick={() => handleTicketStatus(t, 'closed')}
                      disabled={busyId === String(t.id) || updatingTicket}
                      className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
                      title="Close"
                    >
                      <FaTimes />
                    </button>
                  )}
                  {t.status === 'closed' && (
                    <button
                      onClick={() => handleTicketStatus(t, 'open')}
                      disabled={busyId === String(t.id) || updatingTicket}
                      className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900 rounded disabled:opacity-50"
                      title="Reopen"
                    >
                      <FaCheck />
                    </button>
                  )}
                </div>
                {renderReplyPanel(t, () => handleReplyTicket(t))}
              </td>
            </tr>
          ))
        ),
        ticketsLoading,
        'No support tickets yet'
      )}

      {/* Messages tab */}
      {tab === 'messages' && renderTable(
        <>
          <th className="px-4 py-3">Customer</th>
          <th className="px-4 py-3">Vendor</th>
          <th className="px-4 py-3">Subject</th>
          <th className="px-4 py-3">Message</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Date</th>
          <th className="px-4 py-3">Actions</th>
        </>,
        messagesList.length === 0 ? null : (
          messagesList.map((m) => (
            <tr key={String(m.id)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 align-top">
              <td className="px-4 py-3">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {`${m.customerFirstName || ''} ${m.customerLastName || ''}`.trim() || 'Customer'}
                </p>
                {m.customerEmail && <p className="text-xs text-gray-500 dark:text-gray-400">{m.customerEmail}</p>}
              </td>
              <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{m.businessName || `Vendor #${m.vendorId}`}</td>
              <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-[140px]">
                <p className="truncate">{m.subject || 'No subject'}</p>
                {m.productTitle && <p className="text-xs text-indigo-600 dark:text-indigo-400 truncate">{m.productTitle}</p>}
              </td>
              <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs">
                <p className="whitespace-pre-wrap line-clamp-3">{String(m.body || '')}</p>
                {m.reply && (
                  <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/30 rounded text-xs text-green-800 dark:text-green-200">
                    <strong>Reply:</strong> {String(m.reply)}
                  </div>
                )}
              </td>
              <td className="px-4 py-3"><StatusPill status={m.status as string} /></td>
              <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{formatDate(m.created_at)}</td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  {m.status !== 'closed' && (
                    <button
                      onClick={() => { setOpenReplyId(openReplyId === String(m.id) ? null : String(m.id)); setReplyText(''); }}
                      className="p-2 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded"
                      title="Reply"
                    >
                      <FaReply />
                    </button>
                  )}
                  {m.status !== 'closed' && (
                    <button
                      onClick={() => handleCloseMessage(m)}
                      disabled={busyId === String(m.id)}
                      className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
                      title="Close"
                    >
                      <FaTimes />
                    </button>
                  )}
                </div>
                {renderReplyPanel(m, () => handleReplyMessage(m))}
              </td>
            </tr>
          ))
        ),
        messagesLoading,
        'No messages yet'
      )}
    </div>
  );
};

export default InboxPage;
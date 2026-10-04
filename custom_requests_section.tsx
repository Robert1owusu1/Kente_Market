const RequestCard = ({
  request,
  onAccept,
  onCancel,
  navigate,
}: {
  request: any;
  onAccept: (id: number | string) => Promise<void>;
  onCancel: (id: number | string, reason: string) => Promise<void>;
  navigate: (path: string) => void;
}) => {
  const meta = STATUS_META[request.status] || STATUS_META.pending;
  const Icon = meta.icon;
  const price = Number(request.vendorQuotePrice) || 0;
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const handleAccept = async () => {
    try {
      await onAccept(request.id as number);
      toast.success("Quote accepted — you can now pay to lock it in.");
    } catch {
      toast.error("Could not accept the quote. Try again.");
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please tell us why you're cancelling — it helps the weavers.");
      return;
    }
    try {
      await onCancel(request.id as number, cancelReason.trim());
      toast.success("Request cancelled.");
      setShowCancel(false);
      setCancelReason("");
    } catch {
      toast.error("Could not cancel the request.");
    }
  };

  return (
    <div key={String(request.id)} className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">
              {request.baseProductTitle || "Custom kente"} · {request.yards} yd
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{request.vendorBusinessName}</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${meta.color}`}>
          <Icon /> {meta.label}
        </span>
      </div>

      <StatusTimeline status={request.status} />

      {!request.status.includes("ed") && (request.status === "pending" || request.status === "quoted") && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Needed by: <span className="font-medium">{request.neededForDate?.slice(0, 10)} {request.neededForTime}</span> ·{" "}
          <FaPalette className="inline text-primary" /> {request.colours?.length ? request.colours.join(", ") : "—"} ·{request.dominantColour ? ` ${request.dominantColour} dominant ·` : ""}{" "}
          <FaYarn className="inline text-primary" /> {request.threadTypes?.length ? request.threadTypes.join(", ") : "—"}
        </p>
      )}

      {request.vendorMessage && (
        <div className="rounded-xl bg-gray-100 dark:bg-gray-700/50 p-3 text-sm text-gray-700 dark:text-gray-300 mb-3">
          <span className="font-semibold text-primary">{request.vendorBusinessName}:</span> {request.vendorMessage}
        </div>
      )}

      {(request.status === "quoted" || request.status === "accepted") && price > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary/5 border border-primary/20 p-3 mb-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Vendor quote</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">GHS {price.toLocaleString()}</p>
            {request.vendorCanMeet ? (
              <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><FaCheckCircle /> Can meet your timeline</p>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">Range: cannot meet your exact date</p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              You pay the full quote now. Half releases to the weaver right away; the rest is held in escrow until your kente is delivered.
            </p>
          </div>
          {request.status === "quoted" ? (
            <div className="flex gap-2">
              <button
                onClick={handleAccept}
                className="px-4 py-2 bg-primary text-white rounded-xl font-semibold flex items-center gap-2"
              >
                <FaHandshake /> Accept & Pay
              </button>
              <button onClick={() => setShowCancel(true)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300">
                Decline
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate(`/custom-requests/${request.id}/checkout`)}
              className="px-4 py-2 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-semibold flex items-center gap-2"
            >
              <FaCreditCard /> Proceed to Payment
            </button>
          )}
        </div>
      )}

      {request.status === "paid" || request.status === "in_progress" ? (
        <div className="text-sm text-teal-600 dark:text-teal-400 flex flex-col gap-1">
          <p className="flex items-center gap-2">
            <FaHammer /> Payment received — your weaver is on it. Track it in{" "}
            <Link to={`/order/${request.orderId}`} className="underline">your order</Link>.
          </p>
          <p className="flex items-center gap-2 text-xs opacity-80">
            <FaCheckCircle /> Only half was taken now — the balance releases on delivery.
            {request.orderId && (
              <Link to="/certificates" className="underline text-primary">
                View your certificate
              </Link>
            )}
          </p>
        </div>
      ) : null}

      {request.status === "cancelled" && request.customerCancelReason && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Reason: {request.customerCancelReason}</p>
      )}

      {(request.status === "pending" || request.status === "quoted" || request.status === "accepted") && (
        <button onClick={() => setShowCancel(true)} className="mt-2 text-xs text-red-500 hover:underline">
          Cancel this request
        </button>
      )}

      {showCancel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setShowCancel(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900 dark:text-white">Cancel this request?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Your reason helps us understand demand and advise weavers. No charge — this just closes the thread.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Why are you cancelling? (e.g. found another weaver, timeline, price…)"
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary"
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleCancel(request.id as number, cancelReason)}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2"
              >
                Cancel Request
              </button>
              <button onClick={() => setShowCancel(false)} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300">
                Keep
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MyCustomRequestsSection = () => {
  const navigate = useNavigate();
  const { data: requests = [], isLoading, isError } = useGetMyCustomRequestsQuery();
  const [acceptMutation] = useAcceptCustomRequestMutation();
  const [cancelMutation] = useCancelCustomRequestMutation();

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-8 shadow-md text-center">
        <BiLoaderAlt className="animate-spin text-2xl mx-auto text-primary" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">Failed to load requests</h3>
        <p className="text-red-700 dark:text-red-300">Please try again later.</p>
      </div>
    );
  }

  const active = (requests || []).filter((r) => !["cancelled", "declined", "completed"].includes(r.status));
  const archived = (requests || []).filter((r) => ["cancelled", "declined", "completed"].includes(r.status));

  const handleAccept = async (id: number | string) => {
    try {
      await acceptMutation(id).unwrap();
      toast.success("Quote accepted — you can now pay to lock it in.");
    } catch {
      toast.error("Could not accept the quote. Try again.");
    }
  };

  const handleCancel = async (id: number | string, reason: string) => {
    if (!reason.trim()) {
      toast.error("Please tell us why you're cancelling — it helps the weavers.");
      return;
    }
    try {
      await cancelMutation({ id, customerCancelReason: reason.trim() }).unwrap();
      toast.success("Request cancelled.");
    } catch {
      toast.error("Could not cancel the request.");
    }
  };

  if (requests?.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 text-center">
        <FaMagic className="mx-auto text-4xl text-primary mb-3" />
        <p className="text-gray-600 dark:text-gray-300 mb-4">No custom requests yet. Pick any kente marked "Customizable" and describe your vision.</p>
        <button onClick={() => navigate("/products")} className="px-6 py-3 bg-primary text-white rounded-xl font-semibold">Browse Kente</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">My Custom Requests</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Request a one-of-a-kind weave, approve the quote, and pay securely.</p>
        </div>
        <button onClick={() => navigate("/products")} className="px-4 py-2 bg-primary text-white rounded-xl font-semibold flex items-center gap-2">
          <FaReply className="rotate-180" /> Start a new request
        </button>
      </div>

      {active.length > 0 && (
        <section>
          <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">In progress</h3>
          <div className="space-y-4">
            {active.map((request) => (
              <RequestCard
                key={String(request.id)}
                request={request}
                onAccept={handleAccept}
                onCancel={handleCancel}
                navigate={navigate}
              />
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Closed</h3>
          <div className="space-y-4 opacity-75">
            {archived.map((request) => {
              const meta = STATUS_META[request.status] || STATUS_META.pending;
              const Icon = meta.icon;
              const price = Number(request.vendorQuotePrice) || 0;

              return (
                <div key={String(request.id)} className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {request.baseProductTitle || "Custom kente"} · {request.yards} yd
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{request.vendorBusinessName}</p>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${meta.color}`}>
                      <Icon /> {meta.label}
                    </span>
                  </div>

                  {request.vendorMessage && (
                    <div className="rounded-xl bg-gray-100 dark:bg-gray-700/50 p-3 text-sm text-gray-700 dark:text-gray-300 mt-2">
                      <span className="font-semibold text-primary">{request.vendorBusinessName}:</span> {request.vendorMessage}
                    </div>
                  )}

                  {(request.status === "cancelled" || request.status === "declined") && request.customerCancelReason && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Reason: {request.customerCancelReason}</p>
                  )}

                  {price > 0 && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Quote was: <span className="font-semibold">GHS {price.toLocaleString()}</span></p>
                  )}
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
};

const MyDesignsSection = () => {
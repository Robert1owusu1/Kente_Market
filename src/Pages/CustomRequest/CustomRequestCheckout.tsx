import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import axios from "axios";
import { FaArrowLeft, FaCreditCard, FaLock, FaSpinner, FaMapMarkerAlt, FaCheckCircle } from "react-icons/fa";
import { useGetCustomRequestQuery } from "../../slices/customRequestsApiSlice";
import { useAppSelector } from "../../store";
import {
  savePendingPaymentRef,
  readPendingPaymentRef,
  clearPendingPaymentRef,
  PAYMENT_CONFIRMATION_DELAYED_MESSAGE,
} from "../../utils/paymentRef";
import type { CustomRequest } from "../../types/domain";

interface PaystackResponse {
  reference?: string;
  trxref?: string;
  transaction?: string;
  status?: string;
  [key: string]: unknown;
}

interface PaystackPopInstance {
  newTransaction(config: Record<string, unknown>): void;
}

const hasPaystack = (): boolean => Boolean((window as unknown as { PaystackPop?: unknown }).PaystackPop);
const makePaystackPopup = (): PaystackPopInstance => {
  const ctor = (window as unknown as { PaystackPop: new () => PaystackPopInstance }).PaystackPop;
  return new ctor();
};

interface Shipping {
  fullName: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export default function CustomRequestCheckout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userInfo } = useAppSelector((state) => state.auth);

  const { data: request, isLoading, isError } = useGetCustomRequestQuery(id as string);

  const [shipping, setShipping] = useState<Shipping>({
    fullName: "",
    phone: "",
    email: userInfo?.email || "",
    street: "",
    city: "",
    state: "",
    zipCode: "",
    country: "Ghana",
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [paystackKey, setPaystackKey] = useState<string>("");

  // In-memory copy of the reference of a charge that already succeeded, backed
  // up in sessionStorage (keyed by request id) so a failure below can retry
  // with the SAME reference instead of asking for a second payment.
  const pendingPaymentRef = useRef<string | null>(null);

  useEffect(() => {
    setShipping((s) => ({ ...s, email: userInfo?.email || s.email }));
  }, [userInfo]);

  useEffect(() => {
    const key = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
    if (key && !key.includes("xxxx") && key.length >= 20) {
      setPaystackKey(key);
    }
  }, []);

  useEffect(() => {
    const loaded = hasPaystack();
    if (loaded) return;
    const timer = setTimeout(() => {
      if (!hasPaystack()) {
        console.warn("Paystack not loaded yet");
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-3xl">Loading…</div>;
  }
  if (isError || !request) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-2xl font-semibold">Request not found</p>
        <button onClick={() => navigate("/custom-requests")} className="px-6 py-3 bg-primary text-white rounded-xl">
          Back to my requests
        </button>
      </div>
    );
  }

  const req = request as CustomRequest;
  const price = Number(req.vendorQuotePrice) || 0;

  if (req.status !== "accepted") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        {req.status === "paid" || req.status === "in_progress" ? (
          <>
            <FaCheckCircle className="text-4xl text-green-500" />
            <p className="text-xl font-semibold">This request is already paid.</p>
            <button onClick={() => navigate(`/order/${req.orderId}`)} className="px-6 py-3 bg-primary text-white rounded-xl">
              View order
            </button>
          </>
        ) : (
          <>
            <p className="text-xl font-semibold">You must accept the vendor's quote before paying.</p>
            <button onClick={() => navigate("/custom-requests")} className="px-6 py-3 bg-primary text-white rounded-xl">
              Back to my requests
            </button>
          </>
        )}
      </div>
    );
  }

  const setField = (key: keyof Shipping) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setShipping((s) => ({ ...s, [key]: e.target.value }));

  const inputClass =
    "w-full px-4 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-primary transition";

  const validate = (): boolean => {
    const missing = Object.entries(shipping)
      .filter(([k, v]) => k !== "state" && k !== "zipCode" && !String(v).trim())
      .map(([k]) => k);
    if (missing.length > 0) {
      toast.error("Please complete the delivery details.");
      return false;
    }
    if (!/(\+?\d{9,15})/.test(shipping.phone)) {
      toast.error("Enter a valid phone number.");
      return false;
    }
    if (!/.+@.+\..+/.test(shipping.email)) {
      toast.error("Enter a valid email address (for your receipt).");
      return false;
    }
    return true;
  };

  const handlePaystackSuccess = async (response: PaystackResponse) => {
    const reference = response.reference || response.trxref || response.transaction;
    if (!reference) {
      toast.error("Payment reference missing. Please notify support with the payment alert.");
      setIsProcessing(false);
      return;
    }

    // ✅ The charge already SUCCEEDED: persist the reference right away
    // (in-memory ref + sessionStorage keyed by the request id) so a failure in
    // the checkout call below can be retried with the SAME reference instead
    // of discarding it and inviting a second charge.
    pendingPaymentRef.current = reference;
    savePendingPaymentRef(req.id, reference);

    try {
      const { data } = await axios.post(`/api/custom-requests/${req.id}/checkout`, {
        shippingAddress: shipping,
        billingAddress: shipping,
        paymentMethod: "paystack",
        paymentReference: reference,
      });
      // Confirmed — drop the persisted reference.
      pendingPaymentRef.current = null;
      clearPendingPaymentRef(req.id);
      toast.success(data.message || "Payment received — your custom order is with the weaver.");
      const orderId = data.order?.id || data.request?.orderId;
      navigate(orderId ? `/order/${orderId}` : "/custom-requests");
    } catch (err) {
      // The money has left the account already: retry the confirmation with
      // the SAME persisted reference before showing any error.
      const savedReference = pendingPaymentRef.current || readPendingPaymentRef(req.id);
      if (savedReference) {
        try {
          const retry = await axios.post(`/api/custom-requests/${req.id}/checkout`, {
            shippingAddress: shipping,
            billingAddress: shipping,
            paymentMethod: "paystack",
            paymentReference: savedReference,
          });
          pendingPaymentRef.current = null;
          clearPendingPaymentRef(req.id);
          toast.success(retry.data?.message || "Payment received — your custom order is with the weaver.");
          const retryOrderId = retry.data?.order?.id || retry.data?.request?.orderId;
          navigate(retryOrderId ? `/order/${retryOrderId}` : "/custom-requests");
          return;
        } catch (retryError) {
          console.error("Payment re-confirmation failed:", retryError);
        }

        // Re-confirmation failed too: explain the delay and do NOT offer a
        // fresh reference (that would charge the customer twice).
        toast.error(PAYMENT_CONFIRMATION_DELAYED_MESSAGE);
        setIsProcessing(false);
        return;
      }

      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as { message?: string })?.message ||
        "Payment received, but we couldn't finalize the order. Please contact support.";
      toast.error(msg);
      setIsProcessing(false);
    }
  };

  const handlePay = async () => {
    if (!validate()) return;
    if (!paystackKey) {
      toast.error("Payment is not configured yet. Please try again later.");
      return;
    }
    if (!hasPaystack()) {
      toast.error("Payment widget is still loading. Try again in a moment.");
      return;
    }
    setIsProcessing(true);
    try {
      const popup = makePaystackPopup();
      popup.newTransaction({
        key: paystackKey,
        email: shipping.email,
        amount: Math.round(price * 100),
        currency: "GHS",
        ref: `CUSTOM_${req.id}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        channels: ["card", "mobile_money"],
        metadata: {
          customRequestId: req.id,
          custom_fields: [
            { display_name: "Custom Request", variable_name: "custom_request_id", value: String(req.id) },
            { display_name: "Yards", variable_name: "yards", value: String(req.yards) },
            { display_name: "Vendor", variable_name: "vendor", value: String(req.vendorBusinessName) },
          ],
        },
        onSuccess: handlePaystackSuccess,
        onCancel: () => {
          toast.info("Payment cancelled. Your request stays approved — you can pay anytime.");
          setIsProcessing(false);
        },
      });
    } catch (error) {
      console.error("Paystack init error:", error);
      toast.error("Failed to initialize payment. Please try again.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10">
      <div className="max-w-3xl mx-auto px-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-600 dark:text-gray-300 hover:text-primary transition mb-6">
          <FaArrowLeft /> Back
        </button>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6 sm:p-8 space-y-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Pay for your custom kente</h1>

          {/* Order summary */}
          <div className="rounded-xl bg-gray-100 dark:bg-gray-700/50 p-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Piece</span><span className="font-medium">{req.baseProductTitle || "Custom kente"}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Weaver</span><span className="font-medium">{req.vendorBusinessName}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Yards</span><span className="font-medium">{req.yards} yd</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Colours</span><span className="font-medium">{req.colours?.join(", ") || "—"}</span></div>
            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Thread</span><span className="font-medium">{req.dominantThread || "—"}</span></div>
            <div className="flex justify-between pt-2 border-t border-gray-300 dark:border-gray-600 text-base font-bold text-gray-900 dark:text-white">
              <span>Total</span><span>GHS {price.toLocaleString()}</span>
            </div>
            <p className="text-xs text-gray-400 pt-1 flex items-center gap-1">
              <FaLock /> Escrow-secured: funds reach the weaver after you confirm delivery.
            </p>
          </div>

          {/* Delivery address */}
          <div>
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2"><FaMapMarkerAlt /> Delivery address</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input placeholder="Full name" value={shipping.fullName} onChange={setField("fullName")} className={inputClass} />
              <input placeholder="Phone" value={shipping.phone} onChange={setField("phone")} className={inputClass} />
              <input placeholder="Email (for receipt)" type="email" value={shipping.email} onChange={setField("email")} className={`${inputClass} sm:col-span-2`} />
              <input placeholder="Street address" value={shipping.street} onChange={setField("street")} className={`${inputClass} sm:col-span-2`} />
              <input placeholder="City" value={shipping.city} onChange={setField("city")} className={inputClass} />
              <input placeholder="Region / State" value={shipping.state} onChange={setField("state")} className={inputClass} />
              <input placeholder="Postal code" value={shipping.zipCode} onChange={setField("zipCode")} className={inputClass} />
              <input placeholder="Country" value={shipping.country} onChange={setField("country")} className={inputClass} />
            </div>
          </div>

          {/* Payment buttons */}
          <div className="space-y-3">
            <button
              onClick={handlePay}
              disabled={isProcessing}
              className="w-full px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-semibold shadow-md hover:shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isProcessing ? <FaSpinner className="animate-spin" /> : <FaCreditCard />}
              {isProcessing ? "Processing… keep this tab open" : `Pay GHS ${price.toLocaleString()}`}
            </button>
            <p className="text-xs text-gray-400 text-center">Card or Mobile Money via Paystack. You'll approve the weave before it's woven.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
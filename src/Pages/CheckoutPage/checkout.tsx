import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type React from 'react';
import { 
  FaCreditCard, 
  FaMobileAlt, 
  FaShieldAlt, 
  FaArrowLeft, 
  FaCheck, 
  FaClock,
  FaTruck, 
  FaMapMarkerAlt, 
  FaUser,
  FaLock,
  FaExclamationTriangle
} from 'react-icons/fa';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useCart } from '../../Context/CartContext';
import { calcOrderTotals } from '../../utils/pricing';
import { sanitizeInput } from '../../utils/sanitize';
import {
  savePendingPaymentRef,
  readPendingPaymentRef,
  clearPendingPaymentRef,
  PAYMENT_CONFIRMATION_DELAYED_MESSAGE,
} from '../../utils/paymentRef';
import { useGetOrderByIdQuery } from '../../slices/ordersApiSlice';
import axios from 'axios';
import type { FormErrors } from "../../types/domain";

interface AppliedCoupon {
  code: string;
  discountType?: 'percentage' | 'fixed' | string;
  discountValue?: number | string;
  [key: string]: unknown;
}

interface PaystackResponse {
  reference?: string;
  trxref?: string;
  transaction?: string;
  status?: string;
  [key: string]: unknown;
}

interface PaystackConfig {
  key: string;
  email: string;
  amount: number;
  currency: string;
  ref: string;
  channels: string[];
  metadata: Record<string, unknown>;
  onSuccess: (transaction: PaystackResponse) => void;
  onCancel: () => void;
  [key: string]: unknown;
}

const hasPaystack = (): boolean =>
  Boolean((window as unknown as { PaystackPop?: unknown }).PaystackPop);

const makePaystackPopup = (): PaystackPopInstance => {
  const ctor = (window as unknown as { PaystackPop: new () => PaystackPopInstance }).PaystackPop;
  return new ctor();
};

interface PaystackPopInstance {
  newTransaction(config: PaystackConfig): void;
}

// Pickup stations offered when the customer chooses "pickup" instead of
// door-to-door delivery. Drawn from the platform's physical collection points.
const PICKUP_STATIONS = [
  { name: 'Accra Mall', town: 'Accra', region: 'Greater Accra' },
  { name: 'Osu (Oxford Street)', town: 'Accra', region: 'Greater Accra' },
  { name: 'Madina Market', town: 'Madina', region: 'Greater Accra' },
  { name: 'Tema Community 7', town: 'Tema', region: 'Greater Accra' },
  { name: 'Adum (Kumasi Central)', town: 'Kumasi', region: 'Ashanti' },
  { name: 'Kejetia Market', town: 'Kumasi', region: 'Ashanti' },
  { name: 'Takoradi Market Circle', town: 'Takoradi', region: 'Western' },
  { name: 'Cape Coast (Old Market)', town: 'Cape Coast', region: 'Central' },
  { name: 'Koforidua (Jackson Park)', town: 'Koforidua', region: 'Eastern' },
  { name: 'Ho (Municipal Market)', town: 'Ho', region: 'Volta' },
  { name: 'Tamale (Main Market)', town: 'Tamale', region: 'Northern' },
  { name: 'Sunyani (Central Market)', town: 'Sunyani', region: 'Bono' },
];

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { id: orderIdParam } = useParams();
  const { cartItems, getTotalPrice, clearCart } = useCart();

  // Pre-created order (created by CartPage before it routed here). Used to
  // (a) charge the SERVER's total and (b) key the persisted payment reference.
  const preOrderId = orderIdParam && !Number.isNaN(Number(orderIdParam)) ? Number(orderIdParam) : null;

  // In-memory copy of the Paystack reference of the charge that already
  // succeeded; sessionStorage (see utils/paymentRef) backs it up so a
  // refresh/redirect can still recover it.
  const pendingPaymentRef = useRef<string | null>(null);

  const [activeStep, setActiveStep] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [selectedMomoProvider, setSelectedMomoProvider] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [sameAsShipping, setSameAsShipping] = useState(true);
  const [deliveryMethod, setDeliveryMethod] = useState<'home' | 'pickup'>('home');
  const [pickupStation, setPickupStation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [isPaystackLoaded, setIsPaystackLoaded] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  // ✅ Secure environment variable handling
  const paystackPublicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

  // Check if Paystack is loaded
  useEffect(() => {
    const checkPaystack = () => {
      if (hasPaystack()) {
        setIsPaystackLoaded(true);
      } else {
        console.warn('Paystack not loaded yet');
        setTimeout(checkPaystack, 1000);
      }
    };
    checkPaystack();
  }, []);

  // Validate Paystack key
  useEffect(() => {
    if (!paystackPublicKey || paystackPublicKey.includes('xxxx') || paystackPublicKey.length < 20) {
      console.error('❌ Invalid Paystack public key');
      toast.error('Payment system not configured. Please contact support.');
    }
  }, [paystackPublicKey]);

  // Form States
  const [shippingAddress, setShippingAddress] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'Ghana'
  });

  const [billingAddress, setBillingAddress] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'Ghana'
  });

  const [momoNumber, setMomoNumber] = useState('');

  // Redirect if cart is empty
  useEffect(() => {
    if (cartItems.length === 0) {
      toast.info('Your cart is empty');
      navigate('/cartpage');
    }
  }, [cartItems, navigate]);

  // ⚡ Memoized calculations for performance
  const orderTotals = useMemo(() => {
    // Use the shared pricing helper so checkout totals always match what the
    // cart page persisted when it created the order (VAT from shared/pricing.js, GH₵15 ship).
    let appliedDiscountValue = 0;
    if (appliedCoupon) {
      const discountValue = Number(appliedCoupon.discountValue) || 0;
      if (appliedCoupon.discountType === 'percentage') {
        appliedDiscountValue = (calcOrderTotals(cartItems).subtotal * discountValue / 100);
      } else {
        appliedDiscountValue = Math.min(discountValue, calcOrderTotals(cartItems).subtotal);
      }
    }
    const { subtotal, shipping, tax, discount, total } = calcOrderTotals(cartItems, {
      discount: appliedDiscountValue,
    });
    const amountInPesewas = Math.round(total * 100);

    return { subtotal, shipping, tax, discount, total, amountInPesewas };
  }, [cartItems, appliedCoupon]);

  const { subtotal, shipping, tax, discount, total } = orderTotals;

  // ✅ Charge the SERVER's total, not localStorage cart prices. The pre-created
  // order already carries the API's own tax/shipping/discount math, so its
  // totalAmount is what Paystack must be initialized with. The localStorage
  // computation (orderTotals above) is only the fallback while the order has
  // not loaded yet (or if that request fails).
  const { data: serverOrder } = useGetOrderByIdQuery(preOrderId ?? 0, { skip: !preOrderId });
  const serverTotal = serverOrder ? Number(serverOrder.totalAmount) : NaN;
  const payableTotal = Number.isFinite(serverTotal) && serverTotal > 0 ? serverTotal : total;
  const payableAmountInPesewas = Math.round(payableTotal * 100);

  // Validate total amount
  useEffect(() => {
    if (cartItems.length > 0 && total <= 0) {
      toast.error('Invalid order total');
      navigate('/cartpage');
    }
  }, [total, navigate, cartItems.length]);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      toast.error('Please enter a coupon code');
      return;
    }
    setCouponLoading(true);
    try {
      const { data } = await axios.post('/api/coupons/validate', {
        code: couponCode.trim(),
        cartTotal: getTotalPrice()
      });
      if (data.coupon) {
        setAppliedCoupon(data.coupon);
        toast.success(`Coupon applied: ${data.coupon.discountType === 'percentage' ? `${data.coupon.discountValue}% off` : `GH₵${data.coupon.discountValue} off`}`);
      } else {
        toast.error(data.message || 'Invalid coupon');
      }
    } catch (err) {
      const apiErr = err as { response?: { data?: { message?: string } }; message?: string } | undefined;
      toast.error(apiErr?.response?.data?.message || apiErr?.message || 'Failed to validate coupon');
    } finally {
      setCouponLoading(false);
    }
  };

  const momoProviders = useMemo(() => [
    { id: 'mtn', name: 'MTN Mobile Money', logo: 'MTN', color: 'bg-yellow-500', prefix: ['024', '025', '053', '054', '055', '059'] },
    { id: 'vodafone', name: 'Vodafone Cash', logo: '🔴', color: 'bg-red-500', prefix: ['020', '050'] },
    { id: 'airteltigo', name: 'AirtelTigo Money', logo: '🟢', color: 'bg-green-500', prefix: ['027', '026', '056', '057'] },
    { id: 'telecel', name: 'Telecel Cash', logo: '🔵', color: 'bg-blue-500', prefix: ['023', '028'] }
  ], []);

  const ghanaRegions = useMemo(() => [
    'Greater Accra', 'Ashanti', 'Western', 'Central', 'Eastern', 'Volta', 
    'Northern', 'Upper East', 'Upper West', 'Brong Ahafo', 'Western North',
    'Ahafo', 'Bono', 'Bono East', 'Oti', 'Savannah', 'North East'
  ], []);

  const steps = [
    { id: 1, name: 'Shipping', icon: FaTruck },
    { id: 2, name: 'Payment', icon: FaShieldAlt },
    { id: 3, name: 'Review', icon: FaCheck }
  ];

  // 🔒 Validate Ghana phone number
  const validateGhanaPhone = (phone: string) => {
    const cleaned = phone.replace(/\s/g, '');
    if (cleaned.startsWith('+233')) {
      return /^\+233[0-9]{9}$/.test(cleaned);
    } else if (cleaned.startsWith('0')) {
      return /^0[0-9]{9}$/.test(cleaned);
    }
    return false;
  };

  // 🎯 Auto-detect mobile money provider
  const detectMomoProvider = useCallback((phoneNumber: string) => {
    const cleaned = phoneNumber.replace(/\s/g, '');
    const prefix = cleaned.substring(0, 3);
    
    const provider = momoProviders.find(p => p.prefix.includes(prefix));
    return provider?.id || null;
  }, [momoProviders]);

  // 📱 Format phone number for display
  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    
    if (match) {
      return `${match[1]} ${match[2]} ${match[3]}`;
    }
    return value;
  };

  // ✅ Field validation with error tracking
  const validateField = (field: keyof typeof shippingAddress, value: string) => {
    const errors = { ...fieldErrors };
    
    switch (field) {
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.email = 'Invalid email format';
        } else {
          delete errors.email;
        }
        break;
      case 'phone':
        if (!validateGhanaPhone(value)) {
          errors.phone = 'Invalid phone number (use +233 XX XXX XXXX or 0XX XXX XXXX)';
        } else {
          delete errors.phone;
        }
        break;
      case 'firstName':
      case 'lastName':
        if (value.length < 2) {
          errors[field] = 'Must be at least 2 characters';
        } else {
          delete errors[field];
        }
        break;
      case 'address':
        if (value.length < 5) {
          errors.address = 'Please provide a complete address';
        } else {
          delete errors.address;
        }
        break;
      case 'city':
        if (value.length < 2) {
          errors.city = 'Please enter a valid city';
        } else {
          delete errors.city;
        }
        break;
      default:
        break;
    }
    
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const updateShippingAddress = (field: keyof typeof shippingAddress, value: string) => {
    const sanitized = sanitizeInput(value);
    setShippingAddress(prev => ({ ...prev, [field]: sanitized }));
    if (sameAsShipping) {
      setBillingAddress(prev => ({ ...prev, [field]: sanitized }));
    }
  };

  const updateBillingAddress = (field: keyof typeof billingAddress, value: string) => {
    const sanitized = sanitizeInput(value);
    setBillingAddress(prev => ({ ...prev, [field]: sanitized }));
  };

  const validateShippingForm = () => {
    if (deliveryMethod === 'pickup') {
      if (!pickupStation.trim()) {
        toast.error('Please select a pickup station');
        return false;
      }
      const required: (keyof typeof shippingAddress)[] = ['firstName', 'lastName', 'email', 'phone'];
      for (const field of required) {
        if (!shippingAddress[field]) {
          toast.error(`Please fill in ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
          return false;
        }
        if (!validateField(field, shippingAddress[field])) {
          return false;
        }
      }
      if (Object.keys(fieldErrors).length > 0) {
        toast.error('Please fix all form errors before continuing');
        return false;
      }
      return true;
    }

    const required: (keyof typeof shippingAddress)[] = ['firstName', 'lastName', 'email', 'phone', 'address', 'city', 'region'];
    let isValid = true;
    
    for (const field of required) {
      if (!shippingAddress[field]) {
        toast.error(`Please fill in ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
        isValid = false;
        break;
      }
      if (!validateField(field, shippingAddress[field])) {
        isValid = false;
        break;
      }
    }
    
    if (Object.keys(fieldErrors).length > 0) {
      toast.error('Please fix all form errors before continuing');
      return false;
    }
    
    return isValid;
  };

  const validatePaymentForm = () => {
    if (!paymentMethod) {
      toast.error('Please select a payment method');
      return false;
    }

    if (paymentMethod === 'momo') {
      if (!selectedMomoProvider) {
        toast.error('Please select a mobile money provider');
        return false;
      }
      if (!momoNumber) {
        toast.error('Please enter your mobile money number');
        return false;
      }
      if (!validateGhanaPhone(momoNumber)) {
        toast.error('Please enter a valid 10-digit mobile money number');
        return false;
      }
    }

    return true;
  };

  const handleContinue = () => {
    if (activeStep === 1) {
      if (!validateShippingForm()) return;
      setActiveStep(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (activeStep === 2) {
      if (!validatePaymentForm()) return;
      setActiveStep(3);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // 💳 Improved Paystack payment handler
  const payWithPaystack = () => {
    // Validate Paystack is loaded
    if (!hasPaystack()) {
      toast.error('Payment system not loaded. Please refresh the page.');
      return;
    }

    // Validate configuration
    if (!paystackPublicKey || paystackPublicKey.includes('xxxx')) {
      toast.error('Payment system not configured properly. Please contact support.');
      return;
    }

    // Validate amount (server total once the order has loaded, otherwise the
    // local cart fallback)
    if (payableAmountInPesewas <= 0) {
      toast.error('Invalid payment amount');
      return;
    }

    setIsProcessing(true);

    try {
      const paystack = makePaystackPopup();
      
      const config = {
        key: paystackPublicKey,
        email: shippingAddress.email,
        // Charge the order's server-side total, never raw localStorage prices.
        amount: payableAmountInPesewas,
        currency: "GHS",
        ref: `ORDER_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        channels: paymentMethod === 'momo' 
          ? ['mobile_money'] 
          : paymentMethod === 'card' 
            ? ['card'] 
            : ['card', 'mobile_money'],
        metadata: {
          orderId: orderIdParam || null,
          custom_fields: [
            {
              display_name: 'Customer Name',
              variable_name: 'customer_name',
              value: `${shippingAddress.firstName} ${shippingAddress.lastName}`
            },
            {
              display_name: 'Phone Number',
              variable_name: 'phone_number',
              value: shippingAddress.phone
            },
            {
              display_name: 'Mobile Money Number',
              variable_name: 'momo_number',
              value: momoNumber || 'N/A'
            },
            {
              display_name: 'Provider',
              variable_name: 'provider',
              value: selectedMomoProvider || 'card'
            }
          ]
        },
        onSuccess: (transaction: PaystackResponse) => {
          console.log("✅ Payment success:", transaction);
          handlePaystackSuccess(transaction);
        },
        onCancel: () => {
          console.log("❌ Payment cancelled");
          handlePaystackClose();
        },
      };

      paystack.newTransaction(config);
    } catch (error) {
      console.error('Paystack initialization error:', error);
      toast.error('Failed to initialize payment. Please try again.');
      setIsProcessing(false);
    }
  };

  // ✅ Improved success handler with better error handling
  const handlePaystackSuccess = async (response: PaystackResponse) => {
    setIsProcessing(true);

    // Handle different response formats from Paystack
    const reference = response.reference || response.trxref || response.transaction;
    if (!reference) {
      console.error('Payment reference missing from Paystack response:', response);
      toast.error('Payment reference not found');
      setIsProcessing(false);
      return;
    }

    // ✅ The charge SUCCEEDED — persist the reference IMMEDIATELY (in-memory
    // ref + sessionStorage keyed by order id). If the follow-up PUT/verify
    // throws, the catch below retries with this SAME reference instead of
    // discarding it (a discarded reference is what invites a double charge).
    pendingPaymentRef.current = reference;
    savePendingPaymentRef(preOrderId, reference);

    // Hoisted so the catch block can still navigate/verify with it.
    let orderId = preOrderId;

    try {
      const orderData = {
        items: cartItems.map(item => ({
          product: item.id,
          name: sanitizeInput(item.title || item.name),
          qty: parseInt(String(item.quantity)),
          price: parseFloat(String(item.price)),
          image: item.img || (item as unknown as { image?: string }).image,
          selectedColor: item.selectedColor,
          selectedSize: item.selectedSize,
          yards: item.yards ?? item.selectedSize ?? null
        })),
        totalAmount: parseFloat(total.toFixed(2)),
        shippingAddress: {
          ...shippingAddress,
          deliveryMethod,
          pickupStation: deliveryMethod === 'pickup' ? pickupStation : '',
        },
        billingAddress: sameAsShipping ? shippingAddress : billingAddress,
        paymentMethod: paymentMethod === 'momo' 
          ? `Mobile Money (${selectedMomoProvider?.toUpperCase()})` 
          : 'Card Payment',
        paymentReference: reference,
        paymentResult: {
          id: reference,
          status: response.status || 'success',
          update_time: new Date().toISOString(),
          email_address: shippingAddress.email
        },
        shippingCost: parseFloat(shipping.toFixed(2)),
        tax: parseFloat(tax.toFixed(2)),
        discount: parseFloat(discount.toFixed(2)),
        couponCode: appliedCoupon ? appliedCoupon.code : undefined,
        notes: paymentMethod === 'momo' ? `Mobile Number: ${momoNumber}` : null
      };

      // 1) Attach the Paystack payment reference to the order FIRST — before any
      // verification call. This is what lets the Paystack webhook (and the
      // verify-paystack fallback) match the order by its paymentReference and
      // mark it 'paid'. If we verify first and the reference is never attached
      // (e.g. a missing order id), the order stays 'pending' forever even
      // though the customer was charged.
      if (orderId) {
        // Update the pre-created order (created by CartPage) with the payment
        // reference so the Paystack webhook can match and confirm it.
        const { data } = await axios.put(`/api/orders/${orderId}`, orderData);
        orderId = data.order?.id || data.id || orderId;
      } else {
        // Fallback: no pre-created order, create one now.
        // paymentStatus is NOT set by the client - the backend always stores it
        // as "pending" and only the Paystack webhook (or an admin) marks it paid.
        const { data } = await axios.post('/api/orders', orderData);
        orderId = data.order?.id || data.order?._id || data.id || data._id;
      }

      // 2) Verify payment on backend. Now that the order carries the reference,
      // the verify-paystack fallback can find it and confirm it as paid even if
      // the webhook was delayed/missed.
      const verifyResponse = await axios.post('/api/payments/verify-paystack', {
        reference: reference
      });

      if (verifyResponse.data.status === 'success') {
        // Confirmed — drop the persisted reference.
        pendingPaymentRef.current = null;
        clearPendingPaymentRef(preOrderId);

        toast.success('🎉 Payment successful! Order created.');
        clearCart();
        
        // Navigate to order page
        if (orderId) {
          navigate(`/order/${orderId}`);
        } else {
          navigate('/orders');
        }
      } else {
        throw new Error('Payment verification failed');
      }
    } catch (error) {
      console.error('Order creation error:', error);

      // The customer has already been charged. Retry verification with the
      // SAME persisted reference before showing any error; a fresh reference
      // (i.e. a second charge) is never generated from here.
      const savedReference = pendingPaymentRef.current || readPendingPaymentRef(preOrderId);
      if (savedReference) {
        try {
          const retryResponse = await axios.post('/api/payments/verify-paystack', {
            reference: savedReference,
          });
          if (retryResponse.data?.status === 'success') {
            pendingPaymentRef.current = null;
            clearPendingPaymentRef(preOrderId);

            toast.success('🎉 Payment successful! Order confirmed.');
            clearCart();
            navigate(orderId ? `/order/${orderId}` : '/orders');
            return;
          }
        } catch (retryError) {
          console.error('Payment re-verification failed:', retryError);
        }

        // Re-verification did not confirm it either: tell the user the truth
        // and explicitly do NOT invite a re-payment.
        toast.error(PAYMENT_CONFIRMATION_DELAYED_MESSAGE);
        setIsProcessing(false);
        return;
      }

      const apiErr = error as { response?: { data?: { message?: string } }; message?: string } | undefined;
      const errorMessage = apiErr?.response?.data?.message || apiErr?.message || 'Failed to create order after payment';
      toast.error(errorMessage);
      
      // Don't navigate away on error
      setIsProcessing(false);
    }
  };

  const handlePaystackClose = () => {
    toast.info('Payment cancelled. You can try again when ready.');
    setIsProcessing(false);
  };

  // Handle mobile money number input with auto-detection
  const handleMomoNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').substring(0, 10);
    setMomoNumber(value);
    
    if (value.length >= 3) {
      const detected = detectMomoProvider(value);
      if (detected && !selectedMomoProvider) {
        setSelectedMomoProvider(detected);
        const providerName = momoProviders.find(p => p.id === detected)?.name;
        toast.info(`Detected ${providerName}`, { autoClose: 2000 });
      }
    }
  };

  const renderShippingStep = () => (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4 flex items-center">
          <FaTruck className="mr-3 text-blue-600" /> Delivery Method
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setDeliveryMethod('home')}
            className={`flex items-start gap-3 p-4 border-2 rounded-xl text-left transition ${
              deliveryMethod === 'home'
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
            }`}
          >
            <FaTruck className="text-2xl text-blue-600 mt-1" />
            <span>
              <span className="block font-semibold text-gray-900 dark:text-white">Door-to-door delivery</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">We deliver straight to your address</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDeliveryMethod('pickup')}
            className={`flex items-start gap-3 p-4 border-2 rounded-xl text-left transition ${
              deliveryMethod === 'pickup'
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
            }`}
          >
            <FaMapMarkerAlt className="text-2xl text-blue-600 mt-1" />
            <span>
              <span className="block font-semibold text-gray-900 dark:text-white">Pickup at station</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">Collect from a pickup station near you</span>
            </span>
          </button>
        </div>

        {deliveryMethod === 'pickup' && (
          <div className="mt-5">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Pickup Station *</label>
            <select
              value={pickupStation}
              onChange={(e) => setPickupStation(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              required
            >
              <option value="">Choose a station near you</option>
              {PICKUP_STATIONS.map((station) => (
                <option key={station.name} value={`${station.name} — ${station.town}, ${station.region}`}>
                  {station.name} — {station.town}, {station.region}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              You'll be notified when your order is ready for collection at the station.
            </p>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl p-6 shadow-sm border">
        {deliveryMethod === 'pickup' ? (
          <h3 className="text-xl font-semibold mb-6 flex items-center">
            <FaUser className="mr-3 text-blue-600" /> Your Contact Details
          </h3>
        ) : (
          <h3 className="text-xl font-semibold mb-6 flex items-center">
            <FaTruck className="mr-3 text-blue-600" /> Shipping Address
          </h3>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name *</label>
            <input
              type="text"
              value={shippingAddress.firstName}
              onChange={(e) => updateShippingAddress('firstName', e.target.value)}
              onBlur={() => validateField('firstName', shippingAddress.firstName)}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white ${
                fieldErrors.firstName ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
              aria-label="First Name"
              aria-required="true"
              aria-invalid={fieldErrors.firstName ? 'true' : 'false'}
              required
            />
            {fieldErrors.firstName && (
              <p className="text-red-500 text-xs mt-1" role="alert">{fieldErrors.firstName}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name *</label>
            <input
              type="text"
              value={shippingAddress.lastName}
              onChange={(e) => updateShippingAddress('lastName', e.target.value)}
              onBlur={() => validateField('lastName', shippingAddress.lastName)}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white ${
                fieldErrors.lastName ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
              aria-label="Last Name"
              aria-required="true"
              required
            />
            {fieldErrors.lastName && (
              <p className="text-red-500 text-xs mt-1" role="alert">{fieldErrors.lastName}</p>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email Address *</label>
            <input
              type="email"
              value={shippingAddress.email}
              onChange={(e) => updateShippingAddress('email', e.target.value)}
              onBlur={() => validateField('email', shippingAddress.email)}
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white ${
                fieldErrors.email ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
              aria-label="Email Address"
              aria-required="true"
              required
            />
            {fieldErrors.email && (
              <p className="text-red-500 text-xs mt-1" role="alert">{fieldErrors.email}</p>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Phone Number *</label>
            <input
              type="tel"
              value={shippingAddress.phone}
              onChange={(e) => updateShippingAddress('phone', e.target.value)}
              onBlur={() => validateField('phone', shippingAddress.phone)}
              placeholder="+233 XX XXX XXXX or 0XX XXX XXXX"
              className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white ${
                fieldErrors.phone ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
              aria-label="Phone Number"
              aria-required="true"
              required
            />
            {fieldErrors.phone && (
              <p className="text-red-500 text-xs mt-1" role="alert">{fieldErrors.phone}</p>
            )}
          </div>
          {deliveryMethod === 'home' && (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Address *</label>
              <input
                type="text"
                value={shippingAddress.address}
                onChange={(e) => updateShippingAddress('address', e.target.value)}
                onBlur={() => validateField('address', shippingAddress.address)}
                placeholder="Street address, P.O. box, company name"
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white ${
                  fieldErrors.address ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
                required
              />
              {fieldErrors.address && (
                <p className="text-red-500 text-xs mt-1" role="alert">{fieldErrors.address}</p>
              )}
            </div>
          )}
          {deliveryMethod === 'home' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">City *</label>
              <input
                type="text"
                value={shippingAddress.city}
                onChange={(e) => updateShippingAddress('city', e.target.value)}
                onBlur={() => validateField('city', shippingAddress.city)}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white ${
                  fieldErrors.city ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
                required
              />
              {fieldErrors.city && (
                <p className="text-red-500 text-xs mt-1" role="alert">{fieldErrors.city}</p>
              )}
            </div>
          )}
          {deliveryMethod === 'home' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Region *</label>
              <select
                value={shippingAddress.region}
                onChange={(e) => updateShippingAddress('region', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                required
              >
                <option value="">Select Region</option>
                {ghanaRegions.map((region) => (
                  <option key={region} value={region}>{region}</option>
                ))}
              </select>
            </div>
          )}
          {deliveryMethod === 'home' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Postal Code</label>
              <input
                type="text"
                value={shippingAddress.postalCode}
                onChange={(e) => updateShippingAddress('postalCode', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Country</label>
            <input
              type="text"
              value={shippingAddress.country}
              disabled
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4 flex items-center">
          <FaMapMarkerAlt className="mr-3 text-green-600" /> Billing Address
        </h3>
        <div className="mb-4">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={sameAsShipping}
              onChange={(e) => {
                setSameAsShipping(e.target.checked);
                if (e.target.checked) {
                  setBillingAddress({ ...shippingAddress });
                }
              }}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="ml-2 text-sm text-gray-700">Same as shipping address</span>
          </label>
        </div>
        
        {!sameAsShipping && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name *</label>
              <input
                type="text"
                value={billingAddress.firstName}
                onChange={(e) => updateBillingAddress('firstName', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name *</label>
              <input
                type="text"
                value={billingAddress.lastName}
                onChange={(e) => updateBillingAddress('lastName', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Address *</label>
              <input
                type="text"
                value={billingAddress.address}
                onChange={(e) => updateBillingAddress('address', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">City *</label>
              <input
                type="text"
                value={billingAddress.city}
                onChange={(e) => updateBillingAddress('city', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Region *</label>
              <select
                value={billingAddress.region}
                onChange={(e) => updateBillingAddress('region', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                required
              >
                <option value="">Select Region</option>
                {ghanaRegions.map((region) => (
                  <option key={`billing-${region}`} value={region}>{region}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderPaymentStep = () => (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-6 flex items-center">
          <FaShieldAlt className="mr-3 text-purple-600" /> Payment Method
        </h3>
        
        <div className="space-y-4">
          <div
            onClick={() => setPaymentMethod('card')}
            className={`p-4 border-2 rounded-xl cursor-pointer transition-all hover:scale-[1.02] ${
              paymentMethod === 'card' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  type="radio"
                  checked={paymentMethod === 'card'}
                  onChange={() => setPaymentMethod('card')}
                  className="mr-3"
                />
                <FaCreditCard className="text-blue-500 mr-3 text-lg" />
                <span className="font-medium">Card Payment</span>
              </div>
              <span className="text-sm text-gray-500">Visa, Mastercard, Verve</span>
            </div>
          </div>

          <div
            onClick={() => setPaymentMethod('momo')}
            className={`p-4 border-2 rounded-xl cursor-pointer transition-all hover:scale-[1.02] ${
              paymentMethod === 'momo' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  type="radio"
                  checked={paymentMethod === 'momo'}
                  onChange={() => setPaymentMethod('momo')}
                  className="mr-3"
                />
                <FaMobileAlt className="text-green-500 mr-3 text-lg" />
                <span className="font-medium">Mobile Money</span>
              </div>
              <span className="text-sm text-gray-500">MTN, Vodafone, AirtelTigo</span>
            </div>
          </div>

          {paymentMethod === 'momo' && (
            <div className="ml-8 space-y-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div className="grid grid-cols-2 gap-3">
                {momoProviders.map((provider) => (
                  <div
                    key={provider.id}
                    onClick={() => setSelectedMomoProvider(provider.id)}
                    className={`p-3 border-2 rounded-lg cursor-pointer transition-all ${
                      selectedMomoProvider === provider.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full ${provider.color} flex items-center justify-center text-white text-xs font-bold`}>
                        {provider.logo}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{provider.name}</p>
                        <p className="text-xs text-gray-500">{provider.prefix.join(', ')}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {selectedMomoProvider && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Mobile Number *</label>
                  <input
                    type="tel"
                    value={formatPhoneNumber(momoNumber)}
                    onChange={handleMomoNumberChange}
                    placeholder="024 XXX XXXX"
                    maxLength={12}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                  />
                  <p className="text-xs text-gray-500 mt-2">Enter the mobile money number you want to pay with</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
        <div className="flex items-center gap-2">
          <FaLock className="w-5 h-5 text-green-600" />
          <p className="text-sm text-green-800">
            Secured by Paystack. Your payment information is encrypted and secure.
          </p>
        </div>
      </div>
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl p-6 shadow-sm border">
        <h3 className="text-xl font-semibold mb-4">Review Your Order</h3>
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-gray-900 dark:text-white mb-2">Shipping Address</h4>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {deliveryMethod === 'pickup' ? (
                <>
                  {shippingAddress.firstName} {shippingAddress.lastName}<br />
                  {shippingAddress.email}<br />
                  {shippingAddress.phone}<br />
                  <span className="font-medium text-blue-600 dark:text-blue-400">Pickup at: {pickupStation}</span>
                </>
              ) : (
                <>
                  {shippingAddress.firstName} {shippingAddress.lastName}<br />
                  {shippingAddress.email}<br />
                  {shippingAddress.phone}<br />
                  {shippingAddress.address}<br />
                  {shippingAddress.city}, {shippingAddress.region}<br />
                  {shippingAddress.country}
                </>
              )}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 dark:text-white mb-2">Payment Method</h4>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {paymentMethod === 'momo' && `Mobile Money - ${selectedMomoProvider?.toUpperCase()}`}
              {paymentMethod === 'card' && 'Card Payment (Visa, Mastercard, Verve)'}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 dark:text-white mb-2">Order Items</h4>
            <div className="space-y-2">
              {cartItems.map((item, index) => (
                <div key={`review-item-${item.id}-${index}`} className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-300">{item.name} x {item.quantity}</span>
                  <span className="font-medium">GH₵ {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!isPaystackLoaded && (
        <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-200">
          <div className="flex items-center gap-2">
            <FaExclamationTriangle className="w-5 h-5 text-yellow-600" />
            <p className="text-sm text-yellow-800">
              Loading payment system... Please wait.
            </p>
          </div>
        </div>
      )}

      <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
        <div className="flex items-start gap-3 mb-4">
          <FaShieldAlt className="w-6 h-6 text-blue-600 mt-1" />
          <div>
            <h4 className="font-semibold text-blue-900 mb-1">Secure Payment with Paystack</h4>
            <p className="text-sm text-blue-700">
              Click the button below to complete your payment securely through Paystack.
              You'll be redirected to enter your card or mobile money details.
            </p>
          </div>
        </div>
        
        <button
          onClick={payWithPaystack}
          disabled={isProcessing || !isPaystackLoaded}
          className={`w-full py-4 rounded-lg font-semibold text-white transition-all ${
            isProcessing || !isPaystackLoaded
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 transform hover:scale-[1.02]'
          }`}
        >
          {isProcessing ? (
            <span className="flex items-center justify-center gap-2">
              <FaClock className="animate-spin" />
              Processing Payment...
            </span>
          ) : !isPaystackLoaded ? (
            'Loading Payment System...'
          ) : (
            `Pay GH₵ ${payableTotal.toFixed(2)}`
          )}
        </button>

        <p className="text-xs text-center text-gray-500 mt-3">
          By completing this purchase, you agree to our terms and conditions
        </p>
      </div>
    </div>
  );

  // Show loading if processing payment
  if (isProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center dark:from-gray-950 dark:via-gray-900 dark:to-gray-800">
        <div className="text-center bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Processing Your Payment</h3>
          <p className="text-gray-600 dark:text-gray-300">Please do not close this window or press the back button</p>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
            <FaLock className="text-green-500" />
            <span>Secured by Paystack</span>
          </div>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center dark:from-gray-950 dark:via-gray-900 dark:to-gray-800">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-4 dark:from-gray-950 dark:via-gray-900 dark:to-gray-800">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => navigate(-1)}
            className="p-3 rounded-full bg-white dark:bg-gray-800 shadow-lg hover:shadow-xl transition-shadow"
            aria-label="Go back"
          >
            <FaArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Checkout</h1>
            <p className="text-gray-600 dark:text-gray-300">Complete your purchase securely with Paystack</p>
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.id} className="flex items-center">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                    activeStep >= step.id ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-300 dark:text-gray-600'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`ml-2 text-sm font-medium ${
                    activeStep >= step.id ? 'text-blue-600' : 'text-gray-500'
                  }`}>
                    {step.name}
                  </span>
                  {index < steps.length - 1 && (
                    <div className={`w-24 h-0.5 mx-4 transition-all ${
                      activeStep > step.id ? 'bg-blue-600' : 'bg-gray-300'
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            {activeStep === 1 && renderShippingStep()}
            {activeStep === 2 && renderPaymentStep()}
            {activeStep === 3 && renderReviewStep()}

            <div className="flex justify-between mt-8">
              <button
                onClick={() => {
                  setActiveStep(Math.max(1, activeStep - 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                disabled={activeStep === 1 || isProcessing}
                className={`px-6 py-3 rounded-lg font-medium transition-all ${
                  activeStep === 1 || isProcessing
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed' 
                    : 'bg-gray-600 text-white hover:bg-gray-700'
                }`}
              >
                Previous
              </button>
              
              {activeStep < 3 && (
                <button
                  onClick={handleContinue}
                  disabled={isProcessing}
                  className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-2xl shadow-xl p-6 border border-white/20 sticky top-4">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Order Summary</h3>
              
              <div className="space-y-4 mb-6">
                {cartItems.map((item, index) => (
                  <div key={`cart-item-${item.id}-${index}`} className="flex justify-between items-start">
                    <div className="flex-1 mr-4">
                      <p className="font-medium text-gray-900 dark:text-white">{item.name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Qty: {item.quantity}</p>
                    </div>
                    <p className="font-medium text-gray-900 dark:text-white">GH₵ {(item.price * item.quantity).toFixed(2)}</p>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                  <span>Subtotal</span>
                  <span>GH₵ {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                  <span>Shipping</span>
                  <span>GH₵ {shipping.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                  <span>Tax</span>
                  <span>GH₵ {tax.toFixed(2)}</span>
                </div>

                {/* Coupon Code Input */}
                <div className="pt-2">
                  {appliedCoupon ? (
                    <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
                      <span className="text-sm text-green-700 dark:text-green-400 font-medium">
                        {appliedCoupon.code.toUpperCase()}
                      </span>
                      <button
                        onClick={() => { setAppliedCoupon(null); setCouponCode(''); }}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                        placeholder="Coupon code"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={handleApplyCoupon}
                        disabled={couponLoading}
                        className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        {couponLoading ? '...' : 'Apply'}
                      </button>
                    </div>
                  )}
                </div>

                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-GH₵ {discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xl font-bold text-gray-900 dark:text-white pt-3 border-t">
                  <span>Total</span>
                  <span>GH₵ {total.toFixed(2)}</span>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t">
                <div className="flex items-center justify-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center">
                    <FaShieldAlt className="w-4 h-4 mr-1 text-green-500" />
                    Secure
                  </div>
                  <div className="flex items-center">
                    <FaLock className="w-4 h-4 mr-1 text-blue-500" />
                    Encrypted
                  </div>
                  <div className="flex items-center">
                    <FaCheck className="w-4 h-4 mr-1 text-purple-500" />
                    Verified
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t">
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 text-center">Powered by</p>
                <div className="flex items-center justify-center">
                  <div className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-lg">
                    <span className="text-white text-lg font-bold">PAYSTACK</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="flex items-start space-x-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <FaUser className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Need help?</p>
                      <p className="text-xs text-gray-600 dark:text-gray-300">Our customer support team is available 24/7</p>
                    <p className="text-xs text-blue-600 font-medium mt-1">+233 257144697</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
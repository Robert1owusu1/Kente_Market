import { apiSlice } from "./apiSlice";

const WHOLESALE_URL = "/api/wholesale";
const VENDORS_URL = "/api/vendors";

export interface BulkQuote {
  id: number;
  buyerUserId: number;
  vendorId: number | null;
  productId: number;
  quantity: number;
  companyName: string | null;
  contactPhone: string | null;
  message: string | null;
  status: "pending" | "quoted" | "accepted" | "declined" | "closed";
  quotedUnitPrice: number | null;
  quoteNote: string | null;
  validUntil: string | null;
  created_at: string;
  productTitle?: string;
  productImg?: string;
  buyerName?: string;
  buyerEmail?: string;
}

export const wholesaleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Buyer
    createBulkQuote: builder.mutation<{ message: string; quote: BulkQuote }, {
      productId: number; quantity: number; companyName?: string; contactPhone?: string; message?: string;
    }>({
      query: (body) => ({ url: `${WHOLESALE_URL}/quotes`, method: "POST", body }),
      invalidatesTags: ["Wholesale"],
    }),
    getMyBulkQuotes: builder.query<BulkQuote[], void>({
      query: () => `${WHOLESALE_URL}/quotes/mine`,
      providesTags: ["Wholesale"],
    }),
    respondBulkQuote: builder.mutation<{ message: string; quote: BulkQuote }, { id: number; decision: "accept" | "decline" }>({
      query: ({ id, decision }) => ({ url: `${WHOLESALE_URL}/quotes/${id}/${decision}`, method: "POST" }),
      invalidatesTags: ["Wholesale"],
    }),
    getBulkQuoteCheckoutTotal: builder.query<{ subtotal: number; tax: number; shipping: number; total: number; currency: string; quantity: number; unitPrice: number }, number>({
      query: (id) => `${WHOLESALE_URL}/quotes/${id}/checkout-total`,
    }),
    checkoutBulkQuote: builder.mutation<{ message: string; orderId: number; orderNumber: string; total: number }, { id: number; paymentReference: string; shippingAddress?: Record<string, unknown> }>({
      query: ({ id, ...body }) => ({ url: `${WHOLESALE_URL}/quotes/${id}/checkout`, method: "POST", body }),
      invalidatesTags: ["Wholesale", "Order"],
    }),
    // Vendor
    getVendorBulkQuotes: builder.query<BulkQuote[], void>({
      query: () => `${VENDORS_URL}/wholesale/quotes`,
      providesTags: ["Wholesale"],
    }),
    sendVendorQuote: builder.mutation<{ message: string; quote: BulkQuote }, { id: number; unitPrice: number; note?: string; validDays?: number }>({
      query: ({ id, ...body }) => ({ url: `${VENDORS_URL}/wholesale/quotes/${id}/quote`, method: "POST", body }),
      invalidatesTags: ["Wholesale"],
    }),
  }),
});

export const {
  useCreateBulkQuoteMutation,
  useGetMyBulkQuotesQuery,
  useRespondBulkQuoteMutation,
  useLazyGetBulkQuoteCheckoutTotalQuery,
  useCheckoutBulkQuoteMutation,
  useGetVendorBulkQuotesQuery,
  useSendVendorQuoteMutation,
} = wholesaleApiSlice;

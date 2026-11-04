import { apiSlice } from "./apiSlice";

const GIFT_CARDS_URL = "/api/gift-cards";

export interface StoreCreditSummary {
  balance: number;
  purchased: Array<{ id: number; amount: number; status: string; recipientEmail: string | null; createdAt: string }>;
}

export const giftCardsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getStoreCredit: builder.query<StoreCreditSummary, void>({
      query: () => `${GIFT_CARDS_URL}/balance`,
      providesTags: ["StoreCredit"],
    }),
    purchaseGiftCard: builder.mutation<
      { authorizationUrl: string; reference: string; giftCardId: number },
      { amount: number; recipientEmail: string; message?: string }
    >({
      query: (body) => ({ url: `${GIFT_CARDS_URL}/purchase`, method: "POST", body }),
    }),
    redeemGiftCard: builder.mutation<{ message: string; amount: number; balance: number }, { code: string }>({
      query: (body) => ({ url: `${GIFT_CARDS_URL}/redeem`, method: "POST", body }),
      invalidatesTags: ["StoreCredit"],
    }),
    payOrderWithStoreCredit: builder.mutation<
      { message: string; orderId: number; amount: number },
      { orderId: number; acceptFinal: true }
    >({
      query: (body) => ({ url: `${GIFT_CARDS_URL}/pay-order`, method: "POST", body }),
      invalidatesTags: ["StoreCredit", "Order"],
    }),
    applyStoreCreditToOrder: builder.mutation<
      { applied?: number; amountDue?: number; coversFull?: boolean; balance?: number; total?: number },
      { orderId: number }
    >({
      query: (body) => ({ url: `${GIFT_CARDS_URL}/apply-to-order`, method: "POST", body }),
      invalidatesTags: ["StoreCredit"],
    }),
  }),
});

export const {
  useGetStoreCreditQuery,
  usePurchaseGiftCardMutation,
  useRedeemGiftCardMutation,
  usePayOrderWithStoreCreditMutation,
  useApplyStoreCreditToOrderMutation,
} = giftCardsApiSlice;

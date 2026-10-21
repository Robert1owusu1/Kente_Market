import { apiSlice } from "./apiSlice";

// Who delivers a seller's parcels: the seller ('seller', paid the delivery
// fee) or the platform ('platform', the seller drops the parcel at the hub).
// Chosen separately for Ghana and for abroad; applies to new orders only.

export type DeliveredBy = "seller" | "platform";

export interface DeliverySettings {
  domesticDelivery: DeliveredBy | null;
  internationalDelivery: DeliveredBy | null;
  hubAddress: string;
}

export interface HubParcel {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  placedAt: string;
  vendorId: number;
  sellerName: string;
  sellerPhone: string | null;
  shippingFee: number;
  handedOverAt: string | null;
  hubReceivedAt: string | null;
  parcelStatus: string;
  trackingNumber: string | null;
  destination: {
    recipient: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string | null;
    phone: string | null;
    deliveryMethod: string | null;
    pickupStation: string | null;
  };
}

const VENDOR = "/api/vendors";
const ADMIN = "/api/admin/shipping/hub";

export const deliveryApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getDeliverySettings: builder.query<DeliverySettings, void>({
      query: () => `${VENDOR}/shipping/delivery`,
      providesTags: ["DeliverySettings"],
    }),
    updateDeliverySettings: builder.mutation<{ message: string } & Partial<DeliverySettings>, Partial<Pick<DeliverySettings, "domesticDelivery" | "internationalDelivery">>>({
      query: (body) => ({ url: `${VENDOR}/shipping/delivery`, method: "PUT", body }),
      invalidatesTags: ["DeliverySettings", "Vendor"],
    }),
    handOverToHub: builder.mutation<{ message: string; handedOverAt: string | null }, number | string>({
      query: (orderId) => ({ url: `${VENDOR}/orders/${orderId}/handover`, method: "POST" }),
      invalidatesTags: ["VendorOrder"],
    }),

    getHubParcels: builder.query<{ hubAddress: string; parcels: HubParcel[] }, { all?: boolean } | void>({
      query: (args) => (args && args.all ? `${ADMIN}?state=all` : ADMIN),
      providesTags: ["HubParcels"],
    }),
    setHubAddress: builder.mutation<{ hubAddress: string }, string>({
      query: (hubAddress) => ({ url: `${ADMIN}/address`, method: "PUT", body: { hubAddress } }),
      invalidatesTags: ["HubParcels", "DeliverySettings"],
    }),
    receiveHubParcel: builder.mutation<{ message: string }, { orderId: number; vendorId: number }>({
      query: ({ orderId, vendorId }) => ({ url: `${ADMIN}/${orderId}/${vendorId}/received`, method: "POST" }),
      invalidatesTags: ["HubParcels"],
    }),
    // Moves ONE seller's parcel (admin acting for the platform's delivery).
    moveHubParcel: builder.mutation<unknown, { orderId: number; vendorId: number; orderStatus: string; trackingNumber?: string }>({
      query: ({ orderId, vendorId, orderStatus, trackingNumber }) => ({
        url: `${VENDOR}/orders/${orderId}/status`,
        method: "POST",
        body: { orderStatus, vendorId, trackingNumber: trackingNumber || undefined },
      }),
      invalidatesTags: ["HubParcels", "Order"],
    }),
  }),
});

export const {
  useGetDeliverySettingsQuery,
  useUpdateDeliverySettingsMutation,
  useHandOverToHubMutation,
  useGetHubParcelsQuery,
  useSetHubAddressMutation,
  useReceiveHubParcelMutation,
  useMoveHubParcelMutation,
} = deliveryApiSlice;

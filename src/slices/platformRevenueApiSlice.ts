import { ADMIN_PLATFORM_REVENUE_URL } from "../constant";
import { apiSlice } from "./apiSlice";

export interface PlatformRevenueSummary {
  platformProductGross: number;
  platformProductRefunds: number;
  platformProductNet: number;
  featuredNet: number;
  membershipNet: number;
  commissionBooked: number;
  commissionReleased: number;
  commissionHeld: number;
  totalBooked: number;
  totalReleased: number;
}

export interface PlatformRevenuePoint {
  date: string;
  platformProduct: number;
  commission: number;
  total: number;
}

export interface PlatformRevenueReport {
  period: { from: string; to: string };
  currency: string;
  summary: PlatformRevenueSummary;
  series: PlatformRevenuePoint[];
}

export const platformRevenueApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPlatformRevenue: builder.query<PlatformRevenueReport, { from?: string; to?: string } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args && args.from) params.set("from", args.from);
        if (args && args.to) params.set("to", args.to);
        const qs = params.toString();
        return qs ? `${ADMIN_PLATFORM_REVENUE_URL}?${qs}` : ADMIN_PLATFORM_REVENUE_URL;
      },
    }),
  }),
});

export const { useGetPlatformRevenueQuery } = platformRevenueApiSlice;

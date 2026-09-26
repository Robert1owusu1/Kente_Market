import React from "react";
import { Link } from "react-router-dom";
import { FaArrowRight } from "react-icons/fa";
import { useGetCampaignsQuery } from "../../slices/marketplaceApiSlice";
import { resolveImageUrl } from "../../utils/imageUrl";
import formatCurrency from "../../utils/formatCurrency";

interface CampaignCardData {
  id?: number | string;
  title?: string;
  description?: string;
  discountType?: string;
  discountValue?: number | string;
  bannerImage?: string;
  productCount?: number | string;
  vendorCount?: number | string;
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
}

const discountLabel = (c: CampaignCardData): string | null => {
  const value = Number(c.discountValue);
  if (!value) return null;
  if (c.discountType === "fixed") return `${formatCurrency(value)} off`;
  return `-${Math.round(value)}%`;
};

const formatEnd = (d?: string): string | null => {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

// Campaigns scoped to no products AND no vendors are site-wide merchandising
// banners (they apply to every product) — saying "0 products" there was a lie.
const scopeLabel = (c: CampaignCardData): string => {
  const products = Number(c.productCount) || 0;
  const vendors = Number(c.vendorCount) || 0;
  if (products > 0) return `${products} ${products === 1 ? "product" : "products"}`;
  if (vendors > 0) return `${vendors} ${vendors === 1 ? "vendor" : "vendors"}`;
  return "All products";
};

const CampaignSection = () => {
  const { data: campaigns = [], isLoading } = useGetCampaignsQuery(false);

  if (isLoading) return null;
  if (!Array.isArray(campaigns) || campaigns.length === 0) return null;

  const visible = (campaigns as CampaignCardData[]).slice(0, 4);

  return (
    <section className="py-12 sm:py-16 bg-white dark:bg-gray-950">
      <div className="container mx-auto px-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-8">
          <div>
            <h2
              data-aos="fade-up"
              className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white"
            >
              Current Deals &amp; Campaigns
            </h2>
            <p
              data-aos="fade-up"
              data-aos-delay="50"
              className="text-sm text-gray-600 dark:text-gray-300 mt-2"
            >
              Handwoven kente at special prices — limited time only.
            </p>
          </div>
          <Link
            to="/products"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary dark:text-yellow-400 hover:underline underline-offset-4 w-fit"
          >
            View all products <FaArrowRight />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {visible.map((c) => {
            const badge = discountLabel(c);
            const img = resolveImageUrl(c.bannerImage);
            const endsOn = formatEnd(c.endDate);
            return (
              <Link
                key={String(c.id)}
                to="/products"
                data-aos="fade-up"
                className="group bg-white dark:bg-gray-900 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-lg hover:-translate-y-1 duration-300 flex flex-col"
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  {img ? (
                    <img
                      src={img}
                      alt={c.title || "Campaign"}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                      <span className="text-white font-extrabold text-5xl">
                        {badge || "Deal"}
                      </span>
                    </div>
                  )}
                  {badge && (
                    <span className="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold text-white bg-red-500 shadow">
                      {badge}
                    </span>
                  )}
                  {endsOn && (
                    <span className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-semibold text-gray-800 dark:text-gray-100 bg-white/90 dark:bg-gray-800/90 backdrop-blur">
                      Ends {endsOn}
                    </span>
                  )}
                </div>

                <div className="p-4 flex flex-col flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white leading-snug line-clamp-2">
                    {c.title || "Special Deal"}
                  </h3>
                  {c.description && (
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                      {c.description}
                    </p>
                  )}
                  <div className="mt-auto pt-4 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {scopeLabel(c)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary dark:text-yellow-400">
                      Shop Deal <FaArrowRight className="text-xs" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default CampaignSection;
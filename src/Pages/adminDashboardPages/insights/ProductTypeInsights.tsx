import React, { useState } from "react";
import { useGetTopProductTypesQuery } from "../../../slices/ordersApiSlice";
import { useGetReviewAnalyticsQuery } from "../../../slices/miscApiSlice";

type Row = { category?: string; name?: string; productId?: number | string; patternName?: string | null; quantity?: number; revenue?: number; share?: number };

export default function ProductTypeInsights() {
  const { data: types, isLoading, isError } = useGetTopProductTypesQuery();
  const { data: reviews, isLoading: loadingReviews } = useGetReviewAnalyticsQuery();
  const [tab, setTab] = useState<"types" | "products" | "reviews">("types");

  const catRows: Row[] = types?.topTypes ?? [];
  const prodRows: Row[] = types?.topProducts ?? [];
  const maxRevenue = Math.max(1, ...catRows.map((r) => r.revenue ?? 0));

  const fmt = (n?: number) => Number(n ?? 0).toLocaleString();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Product-Type Insights</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Which kente types are selling — the prediction signal for what to stock and weave next.
        </p>
      </div>

      {isLoading && <div className="text-center py-12 text-gray-500">Loading insights…</div>}
      {isError && <div className="text-center py-12 text-red-500">Could not load insights.</div>}

      {!isLoading && !isError && (
        <>
          <div className="flex gap-2">
            {([["types", "By kente type"], ["products", "Top pieces"], ["reviews", "Reviews & vendor rating"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  tab === key ? "bg-primary text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "types" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                Total revenue: <span className="font-bold">GHS {fmt(types.totalRevenue)}</span> · {types.totalQty} items across {catRows.length} type(s)
              </p>
              <div className="space-y-4">
                {catRows.map((r) => (
                  <div key={r.category}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-800 dark:text-white">{r.category}</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {r.quantity} pcs · GHS {fmt(r.revenue)} · {r.share}%
                      </span>
                    </div>
                    <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-secondary rounded-full"
                        style={{ width: `${((r.revenue ?? 0) / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {catRows.length === 0 && <p className="text-gray-400 text-sm">No sales yet to predict from.</p>}
            </div>
          )}

          {tab === "products" && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-2 pr-4">Piece</th>
                    <th className="py-2 pr-4">Category</th>
                    <th className="py-2 pr-4">Quantity</th>
                    <th className="py-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {prodRows.map((p) => (
                    <tr key={String(p.productId ?? p.name)} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-medium text-gray-800 dark:text-white">{p.name}</td>
                      <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">{p.category}{p.patternName ? ` · ${p.patternName}` : ""}</td>
                      <td className="py-2 pr-4 text-gray-600 dark:text-gray-300">{p.quantity}</td>
                      <td className="py-2 text-gray-600 dark:text-gray-300">GHS {fmt(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {prodRows.length === 0 && <p className="text-gray-400 text-sm">No product sales to report yet.</p>}
            </div>
          )}

          {tab === "reviews" && (
            <div className="space-y-4">
              {loadingReviews && <p className="text-gray-500">Loading review analytics…</p>}
              {!loadingReviews && reviews && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Reviews", value: reviews.total },
                      { label: "Avg. product rating", value: reviews.avgRating },
                      { label: "Avg. weaver rating", value: reviews.avgVendorRating },
                      { label: "Verified (purchase)", value: reviews.verifiedCount },
                    ].map((s) => (
                      <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
                        <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{s.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
                      <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Weaver satisfaction</h3>
                      {(reviews.vendorRatings ?? []).length === 0 && <p className="text-gray-400 text-sm">No vendor ratings yet.</p>}
                      {(reviews.vendorRatings ?? []).map((v: { vendorName?: string; avgRating?: string; reviews?: number }) => (
                        <div key={v.vendorName} className="flex justify-between py-1 text-sm">
                          <span className="text-gray-700 dark:text-gray-300">{v.vendorName}</span>
                          <span className="text-gray-500 dark:text-gray-400">{Number(v.avgRating ?? 0).toFixed(1)} ★ · {v.reviews} review(s)</span>
                        </div>
                      ))}
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
                      <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Platform-suggestions ({reviews.suggestionCount})</h3>
                      {(reviews.suggestions ?? []).length === 0 && <p className="text-gray-400 text-sm">No suggestions yet.</p>}
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {(reviews.suggestions ?? []).map((s: { id?: number | string; platformSuggestion?: string; customerName?: string }) => (
                          <p key={String(s.id)} className="text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium text-gray-800 dark:text-white">{s.customerName}:</span> "{s.platformSuggestion}"
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
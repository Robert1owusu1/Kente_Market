import React from "react";

const Skeleton = ({ className }) => {
  return <div className={`skeleton ${className || ""}`} aria-hidden="true" />;
};

export const SkeletonText = ({ className }) => (
  <Skeleton className={`rounded-md ${className || "h-4 w-full"}`} />
);

export const SkeletonCircle = ({ className }) => (
  <Skeleton className={`rounded-full ${className || "h-12 w-12"}`} />
);

export const ProductCardSkeleton = () => (
  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden w-full max-w-[350px]">
    <Skeleton className="h-64 w-full rounded-none" />
    <div className="p-6 space-y-3">
      <SkeletonText className="h-5 w-3/4" />
      <SkeletonText className="h-3 w-1/2" />
      <div className="flex gap-2 pt-2">
        <SkeletonCircle className="h-6 w-6" />
        <SkeletonCircle className="h-6 w-6" />
        <SkeletonCircle className="h-6 w-6" />
      </div>
      <div className="flex justify-between items-center pt-2">
        <SkeletonText className="h-6 w-16" />
        <Skeleton className="h-6 w-6 rounded-md" />
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  </div>
);

export const ProductGridSkeleton = ({ count = 6, className }) => (
  <div className={`grid gap-8 place-items-center ${className || "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
    {Array.from({ length: count }).map((_, i) => (
      <ProductCardSkeleton key={i} />
    ))}
  </div>
);

export default Skeleton;

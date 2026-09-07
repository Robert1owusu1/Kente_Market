// backend/types/mysql2.d.ts
// Loosen the promisified mysql2 `Pool.execute` result for the JS migration.
// The DB rows consumed by the money-critical services are heterogeneous
// (joins across escrow/vendors/orders), so they are treated as opaque `any`
// row arrays here; the actual money-safe checks (explicit `round2` usage and
// number-typed arguments to shared/pricing.js) remain enforced by checkJs.
declare module 'mysql2/promise' {
  interface Pool {
    execute(
      query: string,
      params?: any[] | Record<string | number, any>
    ): Promise<[any, any]>;
  }
}
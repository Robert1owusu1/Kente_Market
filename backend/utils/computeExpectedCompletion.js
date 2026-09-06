// Compute the expected completion DATETIME for a customised (custom-woven)
// order. Uses the longest productionTime (in days) among the customisable
// items, starting from the order's created_at. Returns null for orders with no
// customisable items (i.e. standard woven-off-the-shelf cloths).
export const computeExpectedCompletion = (order) => {
  const rawItems = order.items;
  let items = rawItems;
  if (typeof rawItems === 'string') {
    try {
      items = JSON.parse(rawItems);
    } catch {
      items = [];
    }
  }
  items = Array.isArray(items) ? items : [];

  const customItems = items.filter((it) => it.isCustomizable);
  if (customItems.length === 0) return null;
  const maxDays = Math.max(
    1,
    ...customItems.map((it) => parseInt(it.productionTime) || 1)
  );
  const start = order.created_at ? new Date(order.created_at) : new Date();
  if (isNaN(start.getTime())) return null;
  start.setUTCDate(start.getUTCDate() + maxDays);
  return start;
};

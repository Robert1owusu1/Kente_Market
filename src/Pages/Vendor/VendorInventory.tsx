// Pages/Vendor/VendorInventory.jsx
// Vendor inventory: stock levels, SKUs, low-stock alerts, inline stock editing.
import { useState } from 'react';
import { FaBoxes, FaSpinner, FaExclamationTriangle, FaPlus, FaCheck } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useGetVendorInventoryQuery } from '../../slices/marketplaceApiSlice';
import { useUpdateVendorProductMutation } from '../../slices/vendorsApiSlice';

interface InventoryRow {
  id?: number | string;
  title?: string;
  sku?: string;
  stock?: number;
  stockStatus?: string;
  lowStockThreshold?: number;
  [key: string]: unknown;
}

interface InventoryPayload {
  items?: InventoryRow[];
  summary?: {
    inStock?: number;
    lowStock?: number;
    outOfStock?: number;
    [key: string]: any;
  };
  [key: string]: unknown;
}

const stockBadge = (status: string | undefined) => {
  const map: Record<string, string> = {
    in_stock: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    low_stock: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    out_of_stock: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return map[status || ''] || map.in_stock;
};

const StockRow = ({ item }: { item: InventoryRow }) => {
  const [value, setValue] = useState(String(item.stock ?? 0));
  const [threshold, setThreshold] = useState(String(item.lowStockThreshold ?? 5));
  const [updateProduct, { isLoading }] = useUpdateVendorProductMutation();

  const dirty =
    parseInt(value) !== (item.stock ?? 0) || parseInt(threshold) !== (item.lowStockThreshold ?? 0);

  const handleSave = async () => {
    const stock = parseInt(value);
    const lowStockThreshold = parseInt(threshold);
    if (isNaN(stock) || stock < 0) return toast.error('Stock must be a non-negative number');
    try {
      await updateProduct({ id: item.id as number | string, stock, lowStockThreshold: isNaN(lowStockThreshold) ? 0 : lowStockThreshold }).unwrap();
      toast.success('Inventory updated');
    } catch (error) {
      const err = (error as { data?: { message?: string }; message?: string; error?: string } | undefined);
      toast.error(err?.data?.message || 'Failed to update inventory');
    }
  };

  return (
    <tr className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
      <td className="p-4">
        <p className="font-medium text-gray-800 dark:text-white">{item.title}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{item.sku || 'No SKU'}</p>
      </td>
      <td className="p-4">
        <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${stockBadge(item.stockStatus)}`}>
          {item.stock === 0 ? 'out of stock' : item.stockStatus?.replace('_', ' ')}
        </span>
      </td>
      <td className="p-4">
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-center"
        />
      </td>
      <td className="p-4">
        <input
          type="number"
          min="0"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-center"
        />
      </td>
      <td className="p-4">
        <button
          onClick={handleSave}
          disabled={!dirty || isLoading}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white inline-flex items-center gap-1"
        >
          {isLoading ? <FaSpinner className="animate-spin" /> : dirty ? <FaPlus /> : <FaCheck />}
          {dirty ? 'Save' : 'Saved'}
        </button>
      </td>
    </tr>
  );
};

const VendorInventory = () => {
  const { data, isLoading, isError } = useGetVendorInventoryQuery() as {
    data?: InventoryPayload;
    isLoading: boolean;
    isError: boolean;
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <FaSpinner className="animate-spin h-10 w-10 text-indigo-600 mx-auto" />
        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading inventory...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 text-center bg-red-50 dark:bg-red-900/20 rounded-lg">
        <p className="text-red-600 dark:text-red-400 font-medium">Failed to load inventory.</p>
      </div>
    );
  }

  const { items = [], summary = {} } = data as InventoryPayload;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-md text-center">
          <p className="text-2xl font-bold text-green-600">{summary.inStock || 0}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">In stock</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-md text-center">
          <p className="text-2xl font-bold text-amber-600">{summary.lowStock || 0}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Low stock</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-5 shadow-md text-center">
          <p className="text-2xl font-bold text-red-600">{summary.outOfStock || 0}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Out of stock</p>
        </div>
      </div>

      {((summary.lowStock || 0) > 0 || (summary.outOfStock || 0) > 0) && (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded-lg p-4 text-amber-800 dark:text-amber-300 text-sm">
          <FaExclamationTriangle />
          {(summary.outOfStock || 0) > 0 && <span>{summary.outOfStock} product(s) are out of stock.</span>}
          {(summary.lowStock || 0) > 0 && <span>{summary.lowStock} product(s) are running low on stock.</span>}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        {items.length === 0 ? (
          <div className="p-10 text-center text-gray-600 dark:text-gray-400">
            <FaBoxes className="mx-auto text-4xl mb-4 opacity-50" />
            <p>No products in your inventory yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr className="text-left text-sm text-gray-600 dark:text-gray-400">
                  <th className="p-4">Product</th>
                  <th>Status</th>
                  <th>Stock</th>
                  <th>Alert at</th>
                  <th>Update</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i: InventoryRow) => <StockRow key={i.id} item={i} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default VendorInventory;
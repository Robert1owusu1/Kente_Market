// Pages/Vendor/VendorSettings.jsx
// Business profile + storefront settings (name, contact, location, story,
// socials, images). Storefront data powers the public /store/:slug page.
import { useState } from 'react';
import { FaSave, FaSpinner, FaCheckCircle, FaStore, FaPhone, FaMapMarkerAlt, FaLink } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { useUpdateVendorProfileMutation, useGetMyVendorProfileQuery } from '../../slices/vendorsApiSlice';
import { Link } from 'react-router-dom';

const SOCIAL_FIELDS = ['facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'whatsapp'];

const VendorSettings = ({ vendor }) => {
  const profile = useGetMyVendorProfileQuery().data?.vendor || vendor;
  const socials = profile?.socialMedia && typeof profile.socialMedia === 'object' ? profile.socialMedia : {};

  const [updateProfile, { isLoading: saving }] = useUpdateVendorProfileMutation();
  const [form, setForm] = useState({
    businessName: vendor?.businessName || '',
    contactPhone: vendor?.contactPhone || '',
    logo: vendor?.logo || '',
    coverImage: vendor?.coverImage || '',
    businessDescription: vendor?.businessDescription || '',
    weaverStory: vendor?.weaverStory || '',
    yearsExperience: vendor?.yearsExperience || '',
    location: vendor?.location || '',
    workshop: vendor?.workshop || '',
    socialMedia: SOCIAL_FIELDS.reduce((acc, k) => ({ ...acc, [k]: socials[k] || '' }), {}),
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSocialChange = (key, value) => {
    setForm((prev) => ({ ...prev, socialMedia: { ...prev.socialMedia, [key]: value } }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.businessName.trim()) return toast.error('Business name is required');
    try {
      await updateProfile({
        businessName: form.businessName.trim(),
        contactPhone: form.contactPhone.trim(),
        logo: form.logo.trim(),
        coverImage: form.coverImage.trim(),
        businessDescription: form.businessDescription.trim(),
        weaverStory: form.weaverStory.trim(),
        yearsExperience: parseInt(form.yearsExperience) || 0,
        location: form.location.trim(),
        workshop: form.workshop.trim(),
        socialMedia: form.socialMedia,
      }).unwrap();
      toast.success('Storefront updated');
    } catch (err) {
      toast.error(err?.data?.message || 'Failed to update profile');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Settings</h2>
        {profile?.slug && (
          <Link to={`/store/${profile.slug}`} className="text-sm text-amber-600 dark:text-amber-400 font-medium hover:underline">
            View my storefront →
          </Link>
        )}
      </div>

      {/* Business Profile + Storefront */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md space-y-4">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white">Business Profile</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <FaStore className="text-primary" /> Business Name
            </label>
            <input name="businessName" value={form.businessName} onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <FaPhone className="text-primary" /> Contact Phone
            </label>
            <input name="contactPhone" value={form.contactPhone} onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="+233..." />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <FaMapMarkerAlt className="text-primary" /> Location (town/village)
            </label>
            <input name="location" value={form.location} onChange={handleChange}
              placeholder="e.g. Bonwire, Ashanti Region"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Years of Experience</label>
            <input name="yearsExperience" type="number" min="0" value={form.yearsExperience} onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Workshop</label>
          <input name="workshop" value={form.workshop} onChange={handleChange}
            placeholder="e.g. Heritage Clothing Workshop"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Logo URL</label>
          <input name="logo" value={form.logo} onChange={handleChange}
            placeholder="https://..."
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cover Image URL</label>
          <input name="coverImage" value={form.coverImage} onChange={handleChange}
            placeholder="https://..."
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">About the store</label>
          <textarea name="businessDescription" value={form.businessDescription} onChange={handleChange} rows={3}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="What do you make and sell?" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">The weaver's story</label>
          <textarea name="weaverStory" value={form.weaverStory} onChange={handleChange} rows={4}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="Share your craft, heritage and journey." />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <FaLink className="text-primary" /> Social Media
          </label>
          <div className="grid md:grid-cols-2 gap-3">
            {SOCIAL_FIELDS.map((k) => (
              <input
                key={k}
                value={form.socialMedia[k] || ''}
                onChange={(e) => handleSocialChange(k, e.target.value)}
                placeholder={k}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white capitalize"
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 bg-primary text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? <FaSpinner className="animate-spin" /> : <FaCheckCircle />}
            Save Storefront
          </button>
        </div>
      </form>

      {/* Payout Details */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Payout Details</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Update your bank or mobile money payout details to receive your escrow payouts.
        </p>
        <Link
          to="/vendor/apply"
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
        >
          Edit Payout Details
        </Link>
      </div>

      {/* Account Status */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md">
        <h3 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Account Status</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
            <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
              vendor.status === 'approved'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : vendor.status === 'pending'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              {vendor.status}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
            <span className="text-sm text-gray-600 dark:text-gray-400">Verification Level</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
              {(vendor.verificationLevel || 'pending').replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
            <span className="text-sm text-gray-600 dark:text-gray-400">Payout Type</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">{vendor.payoutType}</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
            <span className="text-sm text-gray-600 dark:text-gray-400">Platform Fee Rate</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{(parseFloat(vendor.platformFeeRate) * 100).toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg">
            <span className="text-sm text-gray-600 dark:text-gray-400">Member Since</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {new Date(vendor.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorSettings;
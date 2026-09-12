import React, { useState } from "react";
import { FaEnvelope, FaPhoneAlt, FaMapMarkerAlt, FaSpinner, FaCheckCircle } from "react-icons/fa";
import { toast } from "react-toastify";
import { useSubmitContactMutation } from "../../slices/miscApiSlice";
import Seo from "../../components/Seo/Seo";
import type { FormErrors } from "../../types/domain";

interface ContactFormData extends Record<string, unknown> {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}


const Contact = () => {
  const [formData, setFormData] = useState<ContactFormData>({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitContact, { isLoading }] = useSubmitContactMutation();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validate = (): FormErrors => {
    const errs: FormErrors = {};
    if (!formData.name.trim()) errs.name = "Please enter your name";
    if (!formData.email.trim()) {
      errs.email = "Please enter your email";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errs.email = "Please enter a valid email";
    }
    if (!formData.message.trim()) errs.message = "Please enter a message";
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    try {
      await submitContact(formData).unwrap();
      toast.success("Message sent successfully! We'll get back to you soon.");
      setFormData({ name: "", email: "", phone: "", subject: "", message: "" });
    } catch (err) {
      const apiErr = err as { data?: { message?: string }; message?: string; error?: string } | undefined;
      toast.error(apiErr?.data?.message || apiErr?.message || "Failed to send message. Please try again.");
    }
  };

  const inputCls =
    "w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400";

  return (
    <>
      <Seo
        title="Contact Us | Bonwire Kente"
        description="Questions about authentic Ghanaian Kente, custom orders, or partnerships? Contact the Bonwire Kente team."
        image="https://kente-market.vercel.app/og-cover.png"
      />
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center px-4 sm:px-6 py-12">
      <div className="max-w-6xl w-full grid md:grid-cols-2 gap-10 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 sm:p-8 md:p-12">

        {/* Left - Contact Info */}
        <div className="text-white space-y-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-yellow-400">Get in Touch</h2>
          <p className="text-gray-300 text-sm sm:text-base">
            Have a question about our authentic Kente cloth, custom orders, or
            partnerships? We'd love to hear from you.
          </p>

          <div className="space-y-4 mt-6">
            <div className="flex items-center gap-3 break-all">
              <FaEnvelope className="text-yellow-400 flex-shrink-0" />
              <span>hello@bonwirekente.com</span>
            </div>
            <div className="flex items-center gap-3">
              <FaPhoneAlt className="text-yellow-400 flex-shrink-0" />
              <span>+233 24 000 0000</span>
            </div>
            <div className="flex items-center gap-3">
              <FaMapMarkerAlt className="text-yellow-400 flex-shrink-0" />
              <span>Bonwire, Ashanti Region, Ghana</span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <FaCheckCircle className="flex-shrink-0" />
            <span>
              We typically respond within 1-2 business days.
            </span>
          </div>
        </div>

        {/* Right - Contact Form */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-lg p-8 space-y-5"
        >
          <h3 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Send Us a Message
          </h3>

          <div>
            <input
              type="text"
              name="name"
              placeholder="Your Name"
              value={formData.name}
              onChange={handleChange}
              className={inputCls}
            />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
          </div>

          <div>
            <input
              type="email"
              name="email"
              placeholder="Your Email"
              value={formData.email}
              onChange={handleChange}
              className={inputCls}
            />
            {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <input
              type="text"
              name="phone"
              placeholder="Phone (optional)"
              value={formData.phone}
              onChange={handleChange}
              className={inputCls}
            />
            <input
              type="text"
              name="subject"
              placeholder="Subject (optional)"
              value={formData.subject}
              onChange={handleChange}
              className={inputCls}
            />
          </div>

          <div>
            <textarea
              name="message"
              placeholder="Your Message"
              rows={5}
              value={formData.message}
              onChange={handleChange}
              className={inputCls}
            />
            {errors.message && <p className="text-red-500 text-sm mt-1">{errors.message}</p>}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-yellow-400 text-black font-semibold p-3 rounded-lg hover:bg-yellow-500 transition-transform transform hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <FaSpinner className="animate-spin" /> Sending...
              </>
            ) : (
              "Send Message"
            )}
          </button>
        </form>
      </div>
    </div>
    </>
  );
};

export default Contact;

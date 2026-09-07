// FILE LOCATION: src/Pages/Help/HelpPage.jsx
// DESCRIPTION: Help Center / FAQ page - common questions, guides, and support options.
import React, { useState } from "react";
import type { IconType } from "react-icons";
import {
  FaChevronDown,
  FaEnvelope,
  FaPhoneAlt,
  FaQuestionCircle,
  FaStore,
  FaTruck,
  FaUndo,
  FaShieldAlt,
  FaCreditCard,
} from "react-icons/fa";
import { Link } from "react-router-dom";

const faqs: FaqCategory[] = [
  {
    category: "Orders & Delivery",
    icon: FaTruck,
    questions: [
      {
        q: "How do I place an order?",
        a: "Browse our Kente collections, select the product, choose your size/color and quantity, then add it to your cart. When ready, go to checkout, enter your details, and pay securely via card or Mobile Money.",
      },
      {
        q: "How long does delivery take?",
        a: "Delivery timelines vary by location. Within Ghana, most orders arrive in 2-5 business days. International shipping may take 7-14 business days depending on destination. You'll receive tracking updates via email.",
      },
      {
        q: "Can I track my order?",
        a: "Yes. Once your order ships, you'll receive an email with tracking information. You can also view the status of all your orders from your account under 'My Orders'.",
      },
      {
        q: "Do you ship internationally?",
        a: "Yes, we ship worldwide. Shipping costs and delivery times are calculated at checkout based on your destination.",
      },
    ],
  },
  {
    category: "Returns & Refunds",
    icon: FaUndo,
    questions: [
      {
        q: "What is your return policy?",
        a: "We accept returns within 14 days of delivery for items in their original condition. Handwoven Kente cloth is inspected individually, so if there's any defect, we'll gladly replace or refund it.",
      },
      {
        q: "How do refunds work?",
        a: "Once your return is received and inspected, we process refunds to your original payment method within 5-10 business days. You'll receive an email confirmation.",
      },
      {
        q: "Can I cancel my order?",
        a: "You can cancel your order before it's shipped. Once shipped, you'll need to go through the return process instead. Contact us as soon as possible to request a cancellation.",
      },
    ],
  },
  {
    category: "Payments",
    icon: FaCreditCard,
    questions: [
      {
        q: "What payment methods do you accept?",
        a: "We accept major credit/debit cards (via Paystack) and Mobile Money (MTN MoMo, Vodafone Cash, AirtelTigo) in Ghana.",
      },
      {
        q: "Is it safe to pay on your site?",
        a: "Absolutely. Payments are processed through secure, PCI-DSS-compliant third-party providers (Paystack). We never store your full card details on our servers.",
      },
    ],
  },
  {
    category: "Vendors & Marketplace",
    icon: FaStore,
    questions: [
      {
        q: "How do I become a vendor?",
        a: "Sign in to your account, go to your profile menu, and select 'Become a Seller'. Fill in your business and bank details, submit your application, and an admin will review and approve it. You can then add products and receive escrow payouts.",
      },
      {
        q: "How does the vendor escrow work?",
        a: "When a customer buys a vendor's product, the payment is held in escrow. It's released to the vendor (minus a platform fee) only after the customer confirms delivery. This protects both buyers and sellers.",
      },
    ],
  },
  {
    category: "Account & Security",
    icon: FaShieldAlt,
    questions: [
      {
        q: "I didn't receive my email verification code",
        a: "Check your spam/junk folder. If you still can't find it, use the 'Resend Code' button on the verification page. Codes expire after 10 minutes, so request a fresh one.",
      },
      {
        q: "How do I reset my password?",
        a: "On the login page, click 'Forgot Password', enter your email, and we'll send you a reset link. Follow the link to create a new password.",
      },
      {
        q: "How do I delete my account?",
        a: "Please contact our support team and we'll assist you with account deletion and any associated data requests.",
      },
    ],
  },
];

interface Faq {
  q: string;
  a: string;
}

interface FaqCategory {
  category: string;
  icon: IconType;
  questions: Faq[];
}

const CategoryCard = ({ category, icon, questions }: FaqCategory) => {
  const Icon = icon;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
      <div className="bg-gradient-to-r from-yellow-400 to-orange-500 px-6 py-4 flex items-center gap-3">
        <Icon className="text-black text-xl" />
        <h2 className="font-bold text-black text-lg">{category}</h2>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {questions.map((item, idx) => (
          <FaqItem key={idx} item={item} />
        ))}
      </div>
    </div>
  );
};

const FaqItem = ({ item }: { item: Faq }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-4 text-left"
        aria-expanded={open}
      >
        <span className="font-medium text-gray-900 dark:text-white pr-2">{item.q}</span>
        <FaChevronDown
          className={`flex-shrink-0 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <p className="pb-4 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{item.a}</p>
      )}
    </div>
  );
};

const HelpPage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 py-12 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-400/20 rounded-full mb-4">
            <FaQuestionCircle className="text-3xl text-yellow-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">How can we help?</h1>
          <p className="text-gray-400 mt-3 max-w-2xl mx-auto">
            Find answers to common questions about orders, payments, returns, vendors, and more.
          </p>
        </div>

        {/* FAQ categories */}
        <div className="space-y-8">
          {faqs.map((cat) => (
            <CategoryCard
              key={cat.category}
              category={cat.category}
              icon={cat.icon}
              questions={cat.questions}
            />
          ))}
        </div>

        {/* Still need help */}
        <div className="mt-12 bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Still need help?</h2>
          <p className="text-gray-400 mb-6">
            Our friendly team is here for you. Reach out and we'll get back to you within 1-2 business days.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/contactus"
              className="inline-flex items-center gap-2 bg-yellow-400 text-black font-semibold px-6 py-3 rounded-xl hover:bg-yellow-500 transition"
            >
              <FaEnvelope />
              Contact Us
            </Link>
            <div className="flex items-center gap-2 text-gray-300">
              <FaPhoneAlt className="text-yellow-400" />
              <span>+233 24 000 0000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpPage;

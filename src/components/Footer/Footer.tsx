import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { useSubscribeNewsletterMutation } from "../../slices/miscApiSlice";
import footerLogo from "../../assets/logo.png";
import Banner from "../../assets/website/footer-pattern.webp";
import {
  FaFacebook,
  FaInstagram,
  FaLinkedin,
  FaWhatsapp,
  FaLocationArrow,
  FaMobileAlt,
  FaEnvelope,
  FaShieldAlt,
  FaTruck,
  FaHandHoldingHeart,
  FaSpinner,
  FaCheckCircle,
} from "react-icons/fa";

// The pattern is a very large dark-to-orange image (6299x3543). We anchor it
// to the bottom so the orange cloth edge stays visible, and layer a scrim
// over the top so link text keeps its contrast ratio.
const BannerImg = {
  backgroundImage: `url(${Banner})`,
  backgroundPosition: "center bottom",
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
};

const ShopLinks = [
  { title: "All Kente Cloth", link: "/products" },
  { title: "Top Products", link: "/topproducts" },
  { title: "Trending Now", link: "/trendingproducts" },
  { title: "AI Virtual Try-On", link: "/ai-tryon" },
  { title: "Custom Requests", link: "/custom-requests" },
  { title: "My Wishlist", link: "/wishlist" },
];

const ExploreLinks = [
  { title: "Our Story", link: "/aboutus" },
  { title: "Vendor Directory", link: "/vendors" },
  { title: "Kente Museum", link: "/museum" },
  { title: "Customer Reviews", link: "/reviews" },
  { title: "Help Center", link: "/help" },
  { title: "Contact Us", link: "/contactus" },
];

const LegalLinks = [
  { title: "Terms of Service", link: "/terms" },
  { title: "Privacy Policy", link: "/privacy" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Social profiles are not part of the source tree, so they come from env
// vars (see .env.example). A network with no URL configured renders as a
// labelled, non-interactive tile instead of a dead link that jumps the page.
const Socials = [
  { label: "Instagram", icon: FaInstagram, url: import.meta.env.VITE_SOCIAL_INSTAGRAM },
  { label: "Facebook", icon: FaFacebook, url: import.meta.env.VITE_SOCIAL_FACEBOOK },
  { label: "LinkedIn", icon: FaLinkedin, url: import.meta.env.VITE_SOCIAL_LINKEDIN },
  { label: "WhatsApp", icon: FaWhatsapp, url: import.meta.env.VITE_SOCIAL_WHATSAPP },
];

const TrustPoints = [
  { icon: FaShieldAlt, text: "Escrow-protected payments" },
  { icon: FaTruck, text: "Delivery across Ghana & worldwide" },
  { icon: FaHandHoldingHeart, text: "Directly supporting weavers" },
];

const FooterLinkList = ({
  heading,
  links,
}: {
  heading: string;
  links: { title: string; link: string }[];
}) => (
  <nav aria-label={heading}>
    <h3 className="text-white text-base font-semibold mb-2">{heading}</h3>
    {/* Full-width rows with 44px touch targets on mobile (WCAG 2.5.8), tightened
        back up on wider screens where the pointer is precise. */}
    <ul className="flex flex-col">
      {links.map((link) => (
        <li key={link.link}>
          <Link
            to={link.link}
            className="block w-full py-3 sm:py-1.5 text-gray-300 text-sm hover:text-primary focus-visible:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary rounded transition-colors duration-200"
          >
            {link.title}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);

const FooterNewsletter = () => {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [subscribe, { isLoading }] = useSubscribeNewsletterMutation();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Please enter your email address");
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      toast.error("Please enter a valid email address");
      return;
    }
    try {
      await subscribe({ email: trimmed }).unwrap();
      setDone(true);
      setEmail("");
      toast.success("You're subscribed. Watch your inbox for new collections.");
    } catch (err) {
      toast.error(
        (err as { data?: { message?: string } })?.data?.message ||
          "Failed to subscribe. Please try again."
      );
    }
  };

  return (
    <div>
      <h3 className="text-white text-base font-semibold mb-2">Newsletter</h3>
      <p className="text-gray-300 text-sm mb-3">
        Be first to know when new Kente collections land.
      </p>

      {done ? (
        <p className="flex items-start gap-2 text-sm text-green-300 bg-green-500/20 border border-green-500/40 rounded-md p-3">
          <FaCheckCircle className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>You're subscribed. We'll be in touch.</span>
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
          <label htmlFor="footer-newsletter-email" className="sr-only">
            Email address
          </label>
          <input
            id="footer-newsletter-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2.5 rounded-md bg-white/10 text-white placeholder-gray-400 border border-white/20 focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2.5 rounded-md bg-primary text-white font-medium shrink-0 transition-colors duration-200 hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <FaSpinner className="animate-spin" aria-hidden="true" />
                <span className="sr-only">Subscribing</span>
              </>
            ) : (
              "Subscribe"
            )}
          </button>
        </form>
      )}
    </div>
  );
};

const SocialTiles = () => (
  <ul className="flex items-center gap-2.5">
    {Socials.map(({ label, icon: Icon, url }) => {
      const tile = (
        <Icon className="text-base" aria-hidden="true" />
      );
      return (
        <li key={label}>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Bonwire Kente on ${label}`}
              className="flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-white/10 text-gray-300 hover:bg-primary hover:text-white transition-colors duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              {tile}
            </a>
          ) : (
            <span
              aria-label={`${label} (not configured)`}
              title={`${label} (not configured)`}
              className="flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-white/5 text-gray-500 cursor-not-allowed"
            >
              {tile}
            </span>
          )}
        </li>
      );
    })}
  </ul>
);

const Footer = ({ className = '' }: { className?: string }) => {
  const year = new Date().getFullYear();

  return (
    <footer
      style={BannerImg}
      className={`relative text-white mt-auto ${className}`}
      aria-labelledby="footer-heading"
    >
      {/* Contrast scrim: the source image is near-black at the top but bright
          orange at the bottom edge, so text needs a consistent backdrop. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-[#1a1611]/95 via-[#1a1611]/90 to-[#1a1611]/75"
      />

      <div className="relative container">
        <h2 id="footer-heading" className="sr-only">
          Site footer
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-10 pt-12 pb-8">
          {/* Brand */}
          <div className="lg:col-span-4 sm:col-span-2">
            <Link
              to="/"
              className="inline-flex items-center gap-3 mb-4 rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <img
                src={footerLogo}
                alt="Bonwire Kente logo"
                width={44}
                height={44}
                loading="lazy"
                decoding="async"
                className="w-11 h-11 object-contain shrink-0"
              />
              <span className="text-xl font-bold">Bonwire Kente</span>
            </Link>
            <p className="text-gray-300 text-sm leading-relaxed max-w-sm">
              Authentic handwoven Kente cloth from the heritage village of
              Bonwire, Ghana. Every purchase preserves a centuries-old weaving
              tradition and pays the makers directly.
            </p>

            <ul className="mt-6 space-y-2.5">
              {TrustPoints.map(({ icon: Icon, text }) => (
                <li
                  key={text}
                  className="flex items-start gap-2.5 text-gray-300 text-sm"
                >
                  <Icon className="text-primary mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Link columns */}
          <div className="lg:col-span-4 sm:col-span-2 grid grid-cols-2 gap-8">
            <FooterLinkList heading="Shop" links={ShopLinks} />
            <FooterLinkList heading="Explore" links={ExploreLinks} />
          </div>

          {/* Newsletter, contact, social */}
          <div className="lg:col-span-4 sm:col-span-2 space-y-8">
            <FooterNewsletter />

            <div>
              <h3 className="text-white text-base font-semibold mb-2">Contact</h3>
              <ul className="text-gray-300 text-sm">
                <li className="flex items-start gap-2.5">
                  <FaLocationArrow
                    className="text-primary mt-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="inline-flex items-center min-h-[44px]">
                    Bonwire, Ashanti Region, Ghana
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <FaMobileAlt
                    className="text-primary mt-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <a
                    href="tel:+233200000000"
                    className="inline-flex items-center min-h-[44px] hover:text-primary transition-colors duration-200"
                  >
                    +233 20 000 0000
                  </a>
                </li>
                <li className="flex items-start gap-2.5">
                  <FaEnvelope
                    className="text-primary mt-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <a
                    href="mailto:hello@bonwirekente.com"
                    className="inline-flex items-center min-h-[44px] hover:text-primary transition-colors duration-200 break-all"
                  >
                    hello@bonwirekente.com
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-white text-base font-semibold mb-3">Follow</h3>
              <SocialTiles />
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/10 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <p className="text-gray-400 text-xs sm:text-sm">
            &copy; {year} Bonwire Kente. Handwoven in Ghana.
          </p>
          <ul className="flex items-center gap-3 text-xs sm:text-sm">
            {LegalLinks.map((link) => (
              <li key={link.link}>
                <Link
                  to={link.link}
                  className="inline-flex items-center min-h-[44px] sm:min-h-[28px] px-1 sm:px-0 text-gray-400 hover:text-primary transition-colors duration-200"
                >
                  {link.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
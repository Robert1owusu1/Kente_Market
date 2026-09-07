import React from "react";
import footerLogo from "../../assets/logo.png";
import Banner from "../../assets/website/footer-pattern.webp";
import {
  FaFacebook,
  FaInstagram,
  FaLinkedin,
  FaLocationArrow,
  FaMobileAlt,
} from "react-icons/fa";

const BannerImg = {
  backgroundImage: `url(${Banner})`,
  backgroundPosition: "bottom",
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  height: "100%",
  width: "100%",
};

const FooterLinks = [
  {
    title: "Home",
    link: "/#",
  },
  {
    title: "Shop Kente",
    link: "/products",
  },
  {
    title: "AI Try-On",
    link: "/ai-tryon",
  },
  {
    title: "Contact",
    link: "/contactus",
  },
];

const SupportLinks = [
  {
    title: "Help Center",
    link: "/help",
  },
  {
    title: "Customer Reviews",
    link: "/reviews",
  },
  {
    title: "Terms of Service",
    link: "/terms",
  },
  {
    title: "Privacy Policy",
    link: "/privacy",
  },
];

const Footer = () => {
  return (
    <div style={BannerImg} className="text-white">
      <div className="container">
        <div data-aos="zoom-in" className="grid md:grid-cols-3 pb-44 pt-5 safe-bottom">
          {/* company details */}
          <div className="py-8 px-4">
            <h1 className="sm:text-3xl text-xl font-bold sm:text-left text-justify mb-3 flex items-center gap-3">
              <img src={footerLogo} alt="" className="max-w-[50px]" />
              Bonwire Kente
            </h1>
            <p className="text-gray-200 text-sm sm:text-base leading-relaxed">
              Authentic handwoven Kente cloth from the heritage village of
              Bonwire, Ghana. Preserving a centuries-old tradition for the
              world.
            </p>
          </div>

          {/* Footer Links */}
          <div className="grid grid-cols-2 sm:grid-cols-3 col-span-2 md:pl-10">
            <div>
              <div className="py-8 px-4">
                <h1 className="sm:text-xl text-lg font-bold sm:text-left text-justify mb-3">
                  Important Links
                </h1>
                <ul className="flex flex-col gap-3">
                  {FooterLinks.map((link) => (
                    <li
                      className="cursor-pointer hover:text-primary hover:translate-x-1 duration-300 text-gray-200 text-sm sm:text-base"
                      key={link.title}
                    >
                      <a href={link.link}>{link.title}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div>
              <div className="py-8 px-4">
                <h1 className="sm:text-xl text-lg font-bold sm:text-left text-justify mb-3">
                  Support & Legal
                </h1>
                <ul className="flex flex-col gap-3">
                  {SupportLinks.map((link) => (
                    <li
                      className="cursor-pointer hover:text-primary hover:translate-x-1 duration-300 text-gray-200 text-sm sm:text-base"
                      key={link.title}
                    >
                      <a href={link.link}>{link.title}</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* social links */}

            <div>
              <div className="flex items-center gap-3 mt-6">
                <a href="#">
                  <FaInstagram className="text-2xl sm:text-3xl" />
                </a>
                <a href="#">
                  <FaFacebook className="text-2xl sm:text-3xl" />
                </a>
                <a href="#">
                  <FaLinkedin className="text-2xl sm:text-3xl" />
                </a>
              </div>
              <div className="mt-6">
                <div className="flex items-center gap-3 text-sm sm:text-base">
                  <FaLocationArrow />
                  <p>Bonwire, Ashanti Region, Ghana</p>
                </div>
                <div className="flex items-center gap-3 mt-3 text-sm sm:text-base">
                  <FaMobileAlt />
                  <p>+233 20 000 0000</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Footer;


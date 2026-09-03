import React from "react";
import Image1 from "../../assets/images/decoration.webp";
import Image2 from "../../assets/images/decoration1.webp";
import Image3 from "../../assets/images/illustrate.webp";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { Link } from "react-router-dom";
import { useGetActiveBannersQuery } from "../../slices/promotionsApiSlice";

const defaultSlides = [
  {
    id: "default-1",
    img: Image1,
    title: "Authentic Handwoven Kente",
    description:
      "Discover the royal cloth of the Asante Kingdom - handwoven in the heritage village of Bonwire, Ghana by master weavers using centuries-old techniques.",
    link: "/products",
    linkText: "Shop Kente",
    bgColor: null,
    textColor: null,
  },
  {
    id: "default-2",
    img: Image2,
    title: "Wear Your Heritage",
    description:
      "Each Kente pattern tells a story. Choose gold for royalty, black for spiritual energy, green for growth. Wear the wisdom of our ancestors.",
    link: "/products",
    linkText: "Explore Patterns",
    bgColor: null,
    textColor: null,
  },
  {
    id: "default-3",
    img: Image3,
    title: "Try It On Before You Buy",
    description:
      "Use our AI Virtual Try-On to see yourself wearing the Kente or preview how it decorates your home - before you order from Bonwire, Ghana.",
    link: "/ai-tryon",
    linkText: "Try It On",
    bgColor: null,
    textColor: null,
  },
];

const Hero = ({ handleOrderPopup }) => {
  const { data: adminBanners = [] } = useGetActiveBannersQuery();

  const dynamicSlides = adminBanners.map((b) => ({
    id: `promo-${b.id}`,
    img: b.image || Image1,
    title: b.title,
    description: b.description || "",
    link: b.link || "/products",
    linkText: b.linkText || "Shop Now",
    bgColor: b.bgColor,
    textColor: b.textColor,
  }));

  const slides = dynamicSlides.length > 0
    ? [...dynamicSlides, ...defaultSlides]
    : defaultSlides;

  var settings = {
    dots: true,
    arrows: false,
    infinite: true,
    speed: 800,
    slidesToScroll: 1,
    autoplay: true,
    autoplaySpeed: 5000,
    cssEase: "ease-in-out",
    pauseOnHover: true,
    pauseOnFocus: true,
    fade: true,
    appendDots: (dots) => (
      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-2 z-20">
        {dots}
      </div>
    ),
    customPaging: () => (
      <div className="w-3 h-3 rounded-full bg-white/40 hover:bg-white/80 transition-all duration-300 cursor-pointer" />
    ),
  };

  return (
    <div className="relative overflow-hidden min-h-[520px] sm:min-h-[560px] bg-gradient-to-br from-gray-50 via-amber-50/30 to-gray-100 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 duration-300">
      {/* Decorative background */}
      <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-gradient-to-br from-amber-400/20 to-orange-500/10 rounded-full blur-3xl -z-10" />
      <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] bg-gradient-to-tr from-primary/10 to-secondary/10 rounded-full blur-3xl -z-10" />

      <div className="container mx-auto px-4 pb-20 sm:pb-0">
        <Slider {...settings}>
          {slides.map((data, index) => {
            const hasCustomBg = data.bgColor && data.bgColor !== '#f59e0b';
            return (
              <div key={data.id}>
                <div className="grid grid-cols-1 sm:grid-cols-2 min-h-[480px] sm:min-h-[520px]">
                  {/* Text content */}
                  <div className="flex flex-col justify-center gap-5 pt-8 sm:pt-0 text-center sm:text-left order-2 sm:order-1 relative z-10 px-2 sm:px-0">
                    {hasCustomBg && (
                      <span
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold tracking-wide uppercase w-fit mx-auto sm:mx-0"
                        style={{ backgroundColor: data.bgColor, color: data.textColor || '#fff' }}
                      >
                        {data.title.includes('%') ? 'Limited Offer' : 'New'}
                      </span>
                    )}
                    <h1
                      data-aos="zoom-out"
                      data-aos-duration="600"
                      data-aos-once="true"
                      className="text-3xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight"
                    >
                      {data.title}
                    </h1>
                    <p
                      data-aos="fade-up"
                      data-aos-duration="600"
                      data-aos-delay="100"
                      className="text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed max-w-md mx-auto sm:mx-0"
                    >
                      {data.description}
                    </p>
                    <div
                      data-aos="fade-up"
                      data-aos-duration="600"
                      data-aos-delay="300"
                      className="flex flex-col xs:flex-row items-center justify-center sm:justify-start gap-3 sm:gap-4"
                    >
                      {data.link === "/ai-tryon" ? (
                        <Link to={data.link} className="w-full xs:w-auto">
                          <button className="w-full xs:w-auto bg-gradient-to-r from-primary to-secondary hover:scale-105 duration-200 text-white py-3 px-7 rounded-full whitespace-nowrap font-semibold shadow-lg shadow-primary/25">
                            {data.linkText || "Try It On"} ✨
                          </button>
                        </Link>
                      ) : (
                        <Link to={data.link || "/products"} className="w-full xs:w-auto">
                          <button
                            onClick={handleOrderPopup}
                            className="w-full xs:w-auto bg-gradient-to-r from-primary to-secondary hover:scale-105 duration-200 text-white py-3 px-7 rounded-full whitespace-nowrap font-semibold shadow-lg shadow-primary/25"
                          >
                            {data.linkText || "Shop Kente"}
                          </button>
                        </Link>
                      )}
                      <Link to="/products" className="w-full xs:w-auto">
                        <button className="w-full xs:w-auto border-2 border-primary/30 bg-primary/5 hover:bg-primary/15 duration-200 text-primary dark:text-white py-3 px-7 rounded-full whitespace-nowrap font-semibold">
                          Browse All
                        </button>
                      </Link>
                    </div>
                  </div>

                  {/* Image section */}
                  <div className="order-1 sm:order-2 flex items-center justify-center">
                    <div
                      data-aos="zoom-in"
                      data-aos-once="true"
                      className="relative z-10"
                    >
                      {hasCustomBg && (
                        <div
                          className="absolute inset-0 rounded-3xl scale-110 blur-xl opacity-30 -z-10"
                          style={{ backgroundColor: data.bgColor }}
                        />
                      )}
                      <img
                        src={data.img}
                        alt={data.title}
                        loading={index === 0 ? "eager" : "lazy"}
                        fetchPriority={index === 0 ? "high" : "auto"}
                        decoding="async"
                        className="w-[260px] h-[260px] sm:h-[420px] sm:w-[420px] lg:h-[480px] lg:w-[480px] object-cover rounded-3xl shadow-2xl shadow-black/10 mx-auto"
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </Slider>
      </div>
    </div>
  );
};

export default Hero;

import React from "react";
import Image1 from "../../assets/images/decoration.webp";
import Image2 from "../../assets/images/decoration1.webp";
import Image3 from "../../assets/images/illustrate.webp";
// react-slick ships without bundled TypeScript declarations.
// @ts-expect-error -- no types available for react-slick
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { Link } from "react-router-dom";
import { useGetActiveBannersQuery } from "../../slices/promotionsApiSlice";

interface HeroSlide {
  id: string;
  img: string;
  title: string;
  description: string;
  link: string;
  linkText: string;
  bgColor: string | null;
  textColor: string | null;
}

const defaultSlides: HeroSlide[] = [
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

const Hero = ({ handleOrderPopup }: { handleOrderPopup?: () => void }) => {
  const { data: adminBanners = [] } = useGetActiveBannersQuery();

  const dynamicSlides: HeroSlide[] = adminBanners.map((b) => ({
    id: `promo-${b.id}`,
    img: b.image || Image1,
    title: b.title!,
    description: b.description || "",
    link: b.link || "/products",
    linkText: (b.linkText as string) || "Shop Now",
    bgColor: (b.bgColor as string) || null,
    textColor: (b.textColor as string) || null,
  }));

  const slides = dynamicSlides.length > 0
    ? [...dynamicSlides, ...defaultSlides]
    : defaultSlides;

  const settings = {
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
    appendDots: (dots: React.ReactNode) => (
      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-2 z-20">
        {dots}
      </div>
    ),
    customPaging: () => (
      <div className="w-3 h-3 rounded-full bg-white/40 hover:bg-white/80 transition-all duration-300 cursor-pointer" />
    ),
  };

  return (
    <div className="relative overflow-hidden min-h-[520px] sm:min-h-[560px] bg-sand-50 dark:bg-gray-950 duration-300">
      {/* Ghanaian Adinkra symbol background — Gye Nyame (flat color, no gradient) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-[0.07] dark:opacity-[0.09]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120' width='120' height='120'%3E%3Cg fill='none' stroke='%23fea928' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='M60 18a14 14 0 1 0 14 14' transform='rotate(0 60 60)'/%3E%3Cpath d='M60 18a14 14 0 1 0 14 14' transform='rotate(90 60 60)'/%3E%3Cpath d='M60 18a14 14 0 1 0 14 14' transform='rotate(180 60 60)'/%3E%3Cpath d='M60 18a14 14 0 1 0 14 14' transform='rotate(270 60 60)'/%3E%3Ccircle cx='60' cy='60' r='30'/%3E%3Ccircle cx='60' cy='60' r='48'/%3E%3Ccircle cx='60' cy='60' r='8'/%3E%3C/g%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "220px 220px",
        }}
      />

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
                        style={{ backgroundColor: data.bgColor ?? undefined, color: data.textColor || '#fff' }}
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
                      data-aos-delay="0"
                      className="text-sm sm:text-base text-gray-600 dark:text-gray-300 leading-relaxed max-w-md mx-auto sm:mx-0"
                    >
                      {data.description}
                    </p>
                    <div
                      data-aos="fade-up"
                      data-aos-delay="0"
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
                          style={{ backgroundColor: data.bgColor ?? undefined }}
                        />
                      )}
                      <img
                        src={data.img}
                        alt={data.title}
                        width={480}
                        height={480}
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

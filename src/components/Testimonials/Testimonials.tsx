import React from "react";
// react-slick ships without bundled TypeScript declarations.
// @ts-expect-error -- no types available for react-slick
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import Imag1 from "../../assets/images/decoration.webp"
import Imag2 from "../../assets/images/decoration1.webp"
import Imag3 from "../../assets/images/image1.webp"
import Imag4 from "../../assets/images/image2.webp"

const TestimonialData = [
  {
    id: 1,
    name: "Ama K.",
    text: "The Adweneasa Royal Wrap is breathtaking! The handwoven quality is exceptional - you can feel the heritage in every thread. Shipping from Bonwire was fast.",
    img: Imag1,
  },
  {
    id: 2,
    name: "Kwabena Mensah",
    text: "I wore the Ceremonial Royal Kente for my traditional wedding and received endless compliments. Knowing it's GI-certified from Bonwire makes it truly special.",
    img: Imag2,
  },
  {
    id: 3,
    name: "Dr. Owusu",
    text: "The Kente Table Runner transformed my living room. The AI try-on feature let me preview exactly how it would look before buying - brilliant!",
    img: Imag3,
  },
  {
    id: 4,
    name: "Prof. Boateng",
    text: "As someone who teaches Ghanaian heritage, I appreciate the authenticity and cultural respect in every piece from Bonwire Kente. UNESCO-grade quality.",
    img: Imag4,
  },
];

const Testimonials = () => {
  const settings = {
    dots: true,
    arrows: false,
    infinite: true,
    speed: 500,
    slidesToScroll: 1,
    autoplay: true,
    autoplaySpeed: 2000,
    cssEase: "linear",
    pauseOnHover: true,
    pauseOnFocus: true,
    responsive: [
      {
        breakpoint: 10000,
        settings: {
          slidesToShow: 3,
          slidesToScroll: 1,
          infinite: true,
        },
      },
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 2,
          slidesToScroll: 1,
          initialSlide: 2,
        },
      },
      {
        breakpoint: 640,
        settings: {
          slidesToShow: 1,
          slidesToScroll: 1,
        },
      },
    ],
  };

  return (
    <div className="py-10 mb-10">
      <div className="container">
        {/* header section */}
        <div className="text-center mb-10 max-w-[600px] mx-auto">
          <p data-aos="fade-up" className="text-sm text-primary">
            What our customers are saying
          </p>
          <h2 data-aos="fade-up" className="text-3xl font-bold dark:text-white">
            Testimonials
          </h2>
          <p data-aos="fade-up" className="text-xs text-gray-500 dark:text-gray-300">
            Trusted by heritage lovers, wedding couples, and cultural
            institutions worldwide
          </p>
        </div>

        {/* Testimonial cards */}
        <div data-aos="zoom-in">
          <Slider {...settings}>
            {TestimonialData.map((data) => (
              <div className="my-6">
                <div
                  key={data.id}
                  className="flex flex-col gap-4 shadow-lg py-8 px-6 mx-4 rounded-xl dark:bg-gray-800 bg-primary/10 relative"
                >
                  <div className="mb-4">
                    <img
                      src={data.img}
                      alt={`${data.name} photo`}
                      width={80}
                      height={80}
                      className="rounded-full w-20 h-20"
                    />
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    <div className="space-y-3">
                      <p className="text-xs text-gray-500 dark:text-primary/80">{data.text}</p>
                      <h3 className="text-xl font-bold text-black/80 dark:text-primary/80">
                        {data.name}
                      </h3>
                    </div>
                  </div>
                  <p className="text-black/20 text-9xl dark:text-primary/80 font-serif absolute top-0 right-0">
                    ,,
                  </p>
                </div>
              </div>
            ))}
          </Slider>
        </div>
      </div>
    </div>
  );
};

export default Testimonials;

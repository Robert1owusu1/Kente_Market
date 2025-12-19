import React from "react";

// Example brand logos (replace with your own in /assets/brands)
import Nike from "../../assets/brands/nike.jpg";
import Adidas from "../../assets/brands/adidas.png";
import Puma from "../../assets/brands/puma.jpg";
import Gucci from "../../assets/brands/gucci.jpg";
import Zara from "../../assets/brands/zara.jpg";
import HnM from "../../assets/brands/hm.png";
import Uniqlo from "../../assets/brands/uniqlo.png";
import Levi from "../../assets/brands/levis.png";
import Lacoste from "../../assets/brands/lacoste.png";
import Supreme from "../../assets/brands/supreme.png";

const brands = [
  { id: 1, name: "Nike", logo: Nike },
  { id: 2, name: "Adidas", logo: Adidas },
  { id: 3, name: "Puma", logo: Puma },
  { id: 4, name: "Gucci", logo: Gucci },
  { id: 5, name: "Zara", logo: Zara },
  { id: 6, name: "H&M", logo: HnM },
  { id: 7, name: "Uniqlo", logo: Uniqlo },
  { id: 8, name: "Levi's", logo: Levi },
  { id: 9, name: "Lacoste", logo: Lacoste },
  { id: 10, name: "Supreme", logo: Supreme },
];

const Brands = () => {
  return (
    <div className="bg-gradient-to-b from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-16">
      <div className="container mx-auto px-6">
        {/* Section Title */}
        <h2
          data-aos="fade-up"
          className="text-3xl sm:text-5xl font-bold text-center mb-14 text-gray-800 dark:text-white"
        >
          Our Trusted <span className="text-orange-500">Brands</span>
        </h2>

        {/* Brand Logos */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8 items-center justify-center">
          {brands.map((brand) => (
            <div
              key={brand.id}
              data-aos="zoom-in"
              className="flex justify-center items-center rounded-2xl bg-white/40 dark:bg-gray-700/50 backdrop-blur-md shadow-lg hover:shadow-orange-400/40 p-6 transition-transform duration-500 hover:scale-110 group"
            >
              <img
                src={brand.logo}
                alt={brand.name}
                className="h-16 sm:h-20 object-contain grayscale group-hover:grayscale-0 transition duration-500"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Brands;

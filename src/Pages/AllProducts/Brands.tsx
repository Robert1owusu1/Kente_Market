import React from "react";

const Brands = () => {
  return (
    <div className="bg-gradient-to-b from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-16">
      <div className="container mx-auto px-6">
        {/* Section Title */}
        <h2
          data-aos="fade-up"
          className="text-3xl sm:text-5xl font-bold text-center mb-6 text-gray-800 dark:text-white"
        >
          Authentic Kente From <span className="text-orange-500">Ghana</span>
        </h2>
        <p
          data-aos="fade-up"
          className="text-center text-gray-600 dark:text-gray-300 max-w-2xl mx-auto"
        >
          Every piece is handwoven in a Geographical Indication (GI) approved
          Ghanaian community - protecting Kente as Ghana's intellectual
          property.
        </p>
      </div>
    </div>
  );
};

export default Brands;

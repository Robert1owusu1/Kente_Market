import React from "react";

// Authentic Kente weaving communities of Ghana
const communities = [
  { id: 1, name: "Bonwire", detail: "The Birthplace of Kente" },
  { id: 2, name: "Sakora Wonoo", detail: "Traditional Weaving" },
  { id: 3, name: "Agotime Kpetoe", detail: "Ewe Kente Heritage" },
  { id: 4, name: "Ntonso", detail: "Adinkra Symbolism" },
  { id: 5, name: "Adawomase", detail: "Master Weavers" },
  { id: 6, name: "Kumasi", detail: "Royal Ashanti Capital" },
];

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
          className="text-center text-gray-600 dark:text-gray-300 max-w-2xl mx-auto mb-14"
        >
          Every piece is handwoven in a Geographical Indication (GI) approved
          Ghanaian community - protecting Kente as Ghana's intellectual
          property.
        </p>

        {/* Community Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 items-center justify-center">
          {communities.map((c) => (
            <div
              key={c.id}
              data-aos="zoom-in"
              className="flex flex-col justify-center items-center rounded-2xl bg-white/40 dark:bg-gray-700/50 backdrop-blur-md shadow-lg hover:shadow-orange-400/40 p-6 transition-transform duration-500 hover:scale-110 group"
            >
              <div className="w-14 h-14 rounded-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center text-white font-bold text-2xl mb-3 group-hover:rotate-12 transition-transform duration-500">
                {c.name.charAt(0)}
              </div>
              <h3 className="font-bold text-gray-800 dark:text-white text-sm text-center">
                {c.name}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-1">
                {c.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Brands;

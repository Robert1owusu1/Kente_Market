import React from "react";
import Team1 from "../../assets/images/decoration.webp";
import Team2 from "../../assets/images/decoration1.webp";
import Team3 from "../../assets/images/image1.webp";

const AboutUs = () => {
  return (
    <div className="bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-r from-gray-900 via-gray-800 to-black text-white py-20">
        <div className="container mx-auto px-6 text-center">
          <h1
            data-aos="fade-down"
            className="text-4xl sm:text-5xl font-bold mb-4"
          >
            About <span className="text-yellow-400">Bonwire Kente</span>
          </h1>
          <p
            data-aos="fade-up"
            className="max-w-2xl mx-auto text-lg text-gray-300"
          >
            Preserving the centuries-old craft of Kente weaving, straight from
            the birthplace of this royal cloth in Bonwire, Ghana.
          </p>
        </div>
      </section>

      {/* Story Section */}
      <section className="container mx-auto px-6 py-16 grid md:grid-cols-2 gap-10 items-center">
        <div data-aos="fade-right">
          <img
            src={Team1}
            alt="Bonwire Kente weaving heritage"
            className="rounded-2xl shadow-lg hover:scale-105 transition-transform duration-500"
          />
        </div>
        <div data-aos="fade-left" className="space-y-4">
          <h2 className="text-3xl font-semibold">Our Story</h2>
          <p>
            <span className="font-semibold">Bonwire Kente</span> was founded by
            weavers from the heritage village of Bonwire in the Ashanti Region
            of Ghana — where, according to Asante oral tradition, Kente cloth
            was first created in the 17th century during the reign of Nana Oti
            Akenten.
          </p>
          <p>
            Inspired by the web designs of Anansi the spider, our master
            weavers hand-craft each strip of cloth on traditional wooden looms.
            In September 2025, Kente received Geographical Indication (GI)
            status, protecting it as Ghana's intellectual property. We are proud
            to work with the approved weaving communities of Bonwire, Sakora
            Wonoo, and Agotime Kpetoe.
          </p>
          <p>
            In December 2024, Kente cloth was recognized by UNESCO as an
            Intangible Cultural Heritage. Our mission is to connect the world to
            this living art form — authentically, respectfully, and beautifully.
          </p>
        </div>
      </section>

      {/* Symbolism Section */}
      <section className="bg-white dark:bg-gray-800 py-16">
        <div className="container mx-auto px-6 text-center">
          <h2
            data-aos="fade-up"
            className="text-3xl font-semibold mb-6 text-gray-800 dark:text-white"
          >
            The Language of Kente Colors
          </h2>
          <p
            data-aos="zoom-in"
            className="max-w-2xl mx-auto text-lg text-gray-600 dark:text-gray-300 mb-10"
          >
            Every color in Kente carries a meaning. When you choose a Bonwire
            Kente cloth, you choose a message.
          </p>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { color: "#FFD700", name: "Gold", meaning: "Royalty, wealth, glory, and spiritual purity" },
              { color: "#1a1a1a", name: "Black", meaning: "Maturation, intensified spiritual energy, and ancestral memory" },
              { color: "#228B22", name: "Green", meaning: "Growth, renewal, vegetation, and spiritual renewal" },
              { color: "#1E90FF", name: "Blue", meaning: "Peacefulness, harmony, and love" },
              { color: "#DC143C", name: "Red", meaning: "Political and spiritual moods; sacrifice and rites" },
              { color: "#FFFFFF", name: "White", meaning: "Purification, sanctification, and festive occasions" },
              { color: "#808080", name: "Grey", meaning: "Healing and cleansing rituals" },
              { color: "#800020", name: "Maroon", meaning: "The color of mother earth; associated with healing" },
            ].map((item, i) => (
              <div
                key={i}
                data-aos="fade-up"
                data-aos-delay={i * 50}
                className="p-6 bg-gray-100 dark:bg-gray-800 rounded-2xl shadow-md text-center hover:shadow-lg hover:scale-105 transition"
              >
                <div
                  className="w-16 h-16 mx-auto rounded-full border-4 border-gray-300 dark:border-gray-600 mb-4 shadow-inner"
                  style={{ backgroundColor: item.color }}
                ></div>
                <h3 className="text-xl font-semibold mb-2 text-yellow-500">
                  {item.name}
                </h3>
                <p className="text-sm">{item.meaning}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-16">
        <div className="container mx-auto px-6 text-center">
          <h2
            data-aos="fade-up"
            className="text-3xl font-semibold mb-6 text-gray-800 dark:text-white"
          >
            Our Mission
          </h2>
          <p
            data-aos="zoom-in"
            className="max-w-2xl mx-auto text-lg text-gray-600 dark:text-gray-300"
          >
            To empower Ghanaian master weavers by bringing their authentic,
            handwoven Kente to the world. We honor the heritage of this sacred
            cloth — from ceremonial Royal Kente to everyday fashion and home
            decor — while providing fair, dignified livelihoods to the weaving
            communities of the Ashanti Region.
          </p>
        </div>
      </section>

      {/* Values Section */}
      <section className="container mx-auto px-6 py-16 grid sm:grid-cols-2 md:grid-cols-3 gap-8">
        {[
          {
            title: "Authenticity",
            desc: "Every piece is handwoven by certified weavers from the GI-approved communities of Bonwire, Sakora Wonoo, and Agotime Kpetoe.",
          },
          {
            title: "Heritage",
            desc: "We preserve the traditional weaving techniques and symbolic meanings passed down through generations of Asante and Ewe weavers.",
          },
          {
            title: "Sustainability",
            desc: "Slow fashion, made on order. No mass production - each cloth is crafted by hand, supporting artisans and reducing waste.",
          },
        ].map((value, i) => (
          <div
            key={i}
            data-aos="fade-up"
            data-aos-delay={i * 100}
            className="p-6 bg-gray-100 dark:bg-gray-800 rounded-2xl shadow-md text-center hover:shadow-lg hover:scale-105 transition"
          >
            <h3 className="text-xl font-semibold mb-3 text-yellow-500">
              {value.title}
            </h3>
            <p>{value.desc}</p>
          </div>
        ))}
      </section>

      {/* Team Section */}
      <section className="bg-gray-50 dark:bg-gray-900 py-16">
        <div className="container mx-auto px-6 text-center">
          <h2
            data-aos="fade-up"
            className="text-3xl font-semibold mb-10 text-gray-800 dark:text-white"
          >
            Meet Our Master Weavers
          </h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-10">
            {[
              { img: Team1, name: "Kwame Mensah", role: "Master Weaver, Bonwire" },
              { img: Team2, name: "Ama Serwaa", role: "Design & Pattern Curator" },
              { img: Team3, name: "Kofi Owusu", role: "Heritage & Community Liaison" },
            ].map((member, i) => (
              <div
                key={i}
                data-aos="zoom-in"
                data-aos-delay={i * 150}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6 hover:shadow-xl hover:-translate-y-2 transition"
              >
                <img
                  src={member.img}
                  alt={member.name}
                  className="w-28 h-28 mx-auto rounded-full object-cover mb-4 border-4 border-yellow-400 shadow-md"
                />
                <h3 className="text-xl font-semibold">{member.name}</h3>
                <p className="text-gray-500 dark:text-gray-400">
                  {member.role}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutUs;

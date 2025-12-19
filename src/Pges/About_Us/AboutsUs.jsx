import React from "react";
import Team1 from "../../assets/women/women3.jpg";
import Team2 from "../../assets/women/women2.jpg";
import Team3 from "../../assets/women/women.png";

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
            About <span className="text-yellow-400">Us</span>
          </h1>
          <p
            data-aos="fade-up"
            className="max-w-2xl mx-auto text-lg text-gray-300"
          >
            We’re more than just a shirt store. We create fashion that speaks
            to your personality, built with quality and passion.
          </p>
        </div>
      </section>

      {/* Story Section */}
      <section className="container mx-auto px-6 py-16 grid md:grid-cols-2 gap-10 items-center">
        <div data-aos="fade-right">
          <img
            src={Team1}
            alt="Our Story"
            className="rounded-2xl shadow-lg hover:scale-105 transition-transform duration-500"
          />
        </div>
        <div data-aos="fade-left" className="space-y-4">
          <h2 className="text-3xl font-semibold">Our Story</h2>
          <p>
            Founded in 2022, <span className="font-semibold">Shirtify</span> was
            born out of a love for comfortable, stylish, and affordable fashion.
            We noticed a gap in the market for premium-quality shirts that
            balance both elegance and casual wear — so we decided to fill it.
          </p>
          <p>
            Today, we deliver shirts loved by thousands of customers worldwide.
            Every piece is crafted with attention to detail, quality materials,
            and a deep understanding of what makes you feel confident.
          </p>
        </div>
      </section>

      {/* Mission Section */}
      <section className="bg-white dark:bg-gray-800 py-16">
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
            To empower individuals through fashion that blends comfort,
            durability, and timeless style. We strive to be a brand that not
            only sells shirts but builds confidence and identity.
          </p>
        </div>
      </section>

      {/* Values Section */}
      <section className="container mx-auto px-6 py-16 grid sm:grid-cols-2 md:grid-cols-3 gap-8">
        {[
          {
            title: "Quality",
            desc: "Each shirt is made with premium fabrics, ensuring longevity and comfort in every stitch.",
          },
          {
            title: "Innovation",
            desc: "We blend timeless styles with modern design trends to keep your wardrobe fresh and unique.",
          },
          {
            title: "Sustainability",
            desc: "From sourcing to packaging, we commit to eco-friendly practices that care for our planet.",
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
            Meet Our Team
          </h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-10">
            {[
              { img: Team1, name: "Emily Carter", role: "Founder & CEO" },
              { img: Team2, name: "David Lee", role: "Head of Design" },
              { img: Team3, name: "Sophia Johnson", role: "Marketing Lead" },
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

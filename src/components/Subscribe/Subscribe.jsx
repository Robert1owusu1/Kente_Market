import React from 'react'
import Banner from '../../assets/website/orange-pattern.jpg'

const BannerImg = {
  backgroundImage: `url(${Banner})`,
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  height: "100%",
  width: "100%",
};

const Subscribe = () => {
  return (
    <div
      data-aos="zoom-in"
      className="mb-20 bg-gray-100 dark:bg-gray-800 text-white"
      style={BannerImg}
    >
      <div className="container backdrop-blur-sm py-10">
        <div className="space-y-6 max-w-xl mx-auto text-center">
          <h1 className="text-2xl sm:text-4xl font-semibold">
            Get Notified About New Products
          </h1>

          {/* Input + Button */}
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <input
              data-aos="fade-up"
              type="email"
              placeholder="Enter your email"
              className="w-full p-3 rounded-md text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <button
              data-aos="fade-up"
              className="px-6 py-3 bg-orange-500 hover:bg-orange-600 transition text-white rounded-md shadow-md"
            >
              Subscribe
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Subscribe

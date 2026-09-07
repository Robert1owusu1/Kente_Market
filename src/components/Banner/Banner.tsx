import React from 'react'
import BannerImg from '../../assets/images/decoration1.webp'
import { GrSecure } from 'react-icons/gr'
import { IoCardSharp, IoGift } from 'react-icons/io5'
import { GiFoodTruck } from 'react-icons/gi'
import { FaHandSpock, FaHistory } from 'react-icons/fa'

const Banner = () => {
  return (
    <div className="min-h-[550px] flex justify-center items-center py-12 sm:py-0">
      <div className="container">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
          {/* Image Section */}
          <div data-aos="zoom-in">
            <img
              src={BannerImg}
              alt="Bonwire Kente heritage cloth"
              className="max-w-[400px] h-[350px] w-full mx-auto drop-shadow-[-10px_10px_12px_rgba(0,0,0,1)] object-cover rounded-xl"
            />
          </div>

          {/* Text Section */}
          <div className="flex flex-col justify-center gap-6 sm:pt-0">
            <h1
              data-aos="fade-up"
              className="font-bold text-3xl sm:text-4xl dark:text-white"
            >
              Woven in Bonwire Since the 17th Century
            </h1>
            <p
              data-aos="fade-up"
              className="text-sm text-gray-500 dark:text-gray-400 tracking-wide leading-5"
            >
              Kente cloth originated in the Ashanti village of Bonwire, Ghana,
              where weavers were inspired by the patterns of Anansi the spider.
              Every strip is handwoven on a wooden loom and carries deep
              cultural meaning and heritage.
            </p>

            {/* Features List */}
            <div className="flex flex-col gap-4">
              <div data-aos="fade-up" className="flex items-center gap-4">
                <FaHistory className="text-4xl h-12 w-12 shadow-sm p-4 rounded-full bg-violet-100 dark:bg-violet-900/30 dark:text-violet-300" />
                <p>Authentic Handwoven Kente</p>
              </div>
              <div data-aos="fade-up" className="flex items-center gap-4">
                <GrSecure className="text-4xl h-12 w-12 shadow-sm p-4 rounded-full bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300" />
                <p>Certified from Approved Kente Weaving Communities</p>
              </div>
              <div data-aos="fade-up" className="flex items-center gap-4">
                <IoCardSharp className="text-4xl h-12 w-12 shadow-sm p-4 rounded-full bg-green-100 dark:bg-green-900/30 dark:text-green-300" />
                <p>Secure Mobile Money & Card Payments</p>
              </div>
              <div data-aos="fade-up" className="flex items-center gap-4">
                <IoGift className="text-4xl h-12 w-12 shadow-sm p-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-300" />
                <p>Slow Fashion - Each Piece Made on Order</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Banner

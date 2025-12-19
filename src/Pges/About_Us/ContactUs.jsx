import React, { useState } from "react";
import { FaEnvelope, FaPhoneAlt, FaMapMarkerAlt } from "react-icons/fa";
 // icons

const Contact = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Form submitted:", formData);
    alert("Message sent successfully!");
    setFormData({ name: "", email: "", message: "" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center px-6 py-12">
      <div className="max-w-6xl w-full grid md:grid-cols-2 gap-10 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 md:p-12">
        
        {/* Left - Contact Info */}
        <div className="text-white space-y-6">
          <h2 className="text-4xl font-bold text-yellow-400">Get in Touch</h2>
          <p className="text-gray-300">
            Have a question, feedback, or just want to say hello? Fill out the form
            and we’ll get back to you as soon as possible.
          </p>

          <div className="space-y-4 mt-6">
            <div className="flex items-center gap-3">
              <FaEnvelope className="text-yellow-400" />
              <span>support@example.com</span>
            </div>
            <div className="flex items-center gap-3">
              <FaPhoneAlt className="text-yellow-400" />
              <span>+233 54 123 4567</span>
            </div>
            <div className="flex items-center gap-3">
              <FaMapMarkerAlt className="text-yellow-400" />
              <span>Accra, Ghana</span>
            </div>
          </div>
        </div>

        {/* Right - Contact Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl shadow-lg p-8 space-y-6"
        >
          <h3 className="text-2xl font-semibold text-gray-900">
            Send Us a Message
          </h3>

          <input
            type="text"
            name="name"
            placeholder="Your Name"
            value={formData.name}
            onChange={handleChange}
            required
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />

          <input
            type="email"
            name="email"
            placeholder="Your Email"
            value={formData.email}
            onChange={handleChange}
            required
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />

          <textarea
            name="message"
            placeholder="Your Message"
            rows="5"
            value={formData.message}
            onChange={handleChange}
            required
            className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
          ></textarea>

          <button
            type="submit"
            className="w-full bg-yellow-400 text-black font-semibold p-3 rounded-lg hover:bg-yellow-500 transition-transform transform hover:scale-105"
          >
            Send Message
          </button>
        </form>
      </div>
    </div>
  );
};

export default Contact;

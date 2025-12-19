// ✅ At the end of Navbar.jsx (after your nav return statement)
import { FaHome, FaSearch, FaBox, FaUser, FaInfoCircle } from "react-icons/fa";
import { Link } from "react-router-dom";

const BottomNav = () => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 shadow-t sm:hidden z-50">
      <div className="flex justify-around items-center py-2 text-gray-600 dark:text-white">
        
        <Link to="/#" className="flex flex-col items-center text-xs hover:text-primary">
          <FaHome className="text-xl" />
          Home
        </Link>

        <Link to="/search" className="flex flex-col items-center text-xs hover:text-primary">
          <FaSearch className="text-xl" />
          Search
        </Link>

        <Link to="/allproducts" className="flex flex-col items-center text-xs hover:text-primary">
          <FaBox className="text-xl" />
          Products
        </Link>

        <Link to="/aboutus" className="flex flex-col items-center text-xs hover:text-primary">
          <FaInfoCircle className="text-xl" />
          About Us
        </Link>

        <Link to="/profile" className="flex flex-col items-center text-xs hover:text-primary">
          <FaUser className="text-xl" />
          Profile
        </Link>
      </div>
    </div>
  );
};

export default BottomNav;

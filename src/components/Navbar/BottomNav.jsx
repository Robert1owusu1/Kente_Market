import { FaHome, FaBox, FaUser, FaInfoCircle } from "react-icons/fa";
import { FaCartShopping } from "react-icons/fa6";
import { IoShirtOutline } from "react-icons/io5";
import { Link, useLocation } from "react-router-dom";
import { useCart } from "../../Context/CartContext";

const BottomNav = () => {
  const { pathname } = useLocation();
  const { cartItems } = useCart();
  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  const isActive = (path) =>
    pathname === path || (path !== "/" && pathname.startsWith(path));

  const links = [
    { to: "/", icon: FaHome, label: "Home" },
    { to: "/ai-tryon", icon: IoShirtOutline, label: "Try-On" },
    { to: "/products", icon: FaBox, label: "Products" },
    { to: "/cartpage", icon: FaCartShopping, label: "Cart", badge: cartCount },
    { to: "/profile", icon: FaUser, label: "Profile" },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 shadow-t sm:hidden z-50 border-t border-gray-200 dark:border-gray-800 safe-bottom">
      <div className="flex justify-around items-center pt-1 pb-1 text-gray-600 dark:text-white">
        {links.map(({ to, icon: Icon, label, badge }) => (
          <Link
            key={to}
            to={to}
            className={`flex flex-col items-center py-1 px-2 text-[10px] transition-colors relative ${
              isActive(to) ? "text-primary font-semibold" : "hover:text-primary"
            }`}
          >
            <span
              className={`relative rounded-lg px-3 py-0.5 transition-colors ${
                isActive(to) ? "bg-primary/15" : ""
              }`}
            >
              <Icon className="text-xl" />
              {badge > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-bold">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </span>
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default BottomNav;

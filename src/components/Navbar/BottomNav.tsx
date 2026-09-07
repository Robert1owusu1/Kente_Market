import { FaHome, FaBox, FaUser, FaInfoCircle } from "react-icons/fa";
import { FaCartShopping } from "react-icons/fa6";
import { IoShirtOutline } from "react-icons/io5";
import type { IconType } from "react-icons";
import { Link, useLocation } from "react-router-dom";
import { useCart } from "../../Context/CartContext";

const BottomNav = () => {
  const { pathname } = useLocation();
  const { cartItems } = useCart();
  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);

  const isActive = (path: string) =>
    pathname === path || (path !== "/" && pathname.startsWith(path));

  const links: { to: string; icon: IconType; label: string; badge?: number }[] = [
    { to: "/", icon: FaHome, label: "Home" },
    { to: "/ai-tryon", icon: IoShirtOutline, label: "Try-On" },
    { to: "/products", icon: FaBox, label: "Products" },
    { to: "/cartpage", icon: FaCartShopping, label: "Cart", badge: cartCount },
    { to: "/profile", icon: FaUser, label: "Profile" },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 shadow-t sm:hidden z-50 border-t border-gray-200 dark:border-gray-800 safe-bottom">
      <div className="flex justify-around items-center pt-1 pb-1 text-gray-600 dark:text-white">
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={`flex flex-col items-center py-1 px-2 text-[10px] transition-colors relative ${
              isActive(link.to) ? "text-primary font-semibold" : "hover:text-primary"
            }`}
          >
            <span
              className={`relative rounded-lg px-3 py-0.5 transition-colors ${
                isActive(link.to) ? "bg-primary/15" : ""
              }`}
            >
              <link.icon className="text-xl" />
              {link.badge! > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-bold">
                  {link.badge! > 99 ? "99+" : link.badge!}
                </span>
              )}
            </span>
            <span>{link.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default BottomNav;

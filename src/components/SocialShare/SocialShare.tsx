import React from 'react';
import { FaFacebookF, FaTwitter, FaWhatsapp, FaPinterestP, FaLink } from 'react-icons/fa';
import { toast } from 'react-toastify';

const SocialShare = ({ url, title }: { url?: string; title?: string }) => {
  const encodedUrl = encodeURIComponent(url || window.location.href);
  const encodedTitle = encodeURIComponent(title || document.title);

  const shareLinks = [
    {
      name: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      icon: FaFacebookF,
      color: 'bg-blue-600 hover:bg-blue-700',
    },
    {
      name: 'Twitter',
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
      icon: FaTwitter,
      color: 'bg-black hover:bg-gray-800',
    },
    {
      name: 'WhatsApp',
      href: `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`,
      icon: FaWhatsapp,
      color: 'bg-green-500 hover:bg-green-600',
    },
    {
      name: 'Pinterest',
      href: `https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${encodedTitle}`,
      icon: FaPinterestP,
      color: 'bg-red-600 hover:bg-red-700',
    },
  ];

  const handleShare = (e: React.MouseEvent<HTMLButtonElement>, link: (typeof shareLinks)[number]) => {
    e.preventDefault();
    const popupWidth = 600;
    const popupHeight = 500;
    const left = (window.innerWidth - popupWidth) / 2;
    const top = (window.innerHeight - popupHeight) / 2;
    window.open(
      link.href,
      link.name,
      `width=${popupWidth},height=${popupHeight},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url || window.location.href);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  return (
    <div className="flex items-center gap-2">
      {shareLinks.map((link) => {
        const Icon = link.icon;
        return (
          <button
            key={link.name}
            onClick={(e) => handleShare(e, link)}
            aria-label={`Share on ${link.name}`}
            title={`Share on ${link.name}`}
            className={`w-9 h-9 rounded-full ${link.color} text-white flex items-center justify-center transition-all duration-300 hover:scale-110`}
          >
            <Icon className="text-sm" />
          </button>
        );
      })}
      <button
        onClick={handleCopy}
        aria-label="Copy link"
        title="Copy link"
        className="w-9 h-9 rounded-full bg-gray-500 hover:bg-gray-600 text-white flex items-center justify-center transition-all duration-300 hover:scale-110"
      >
        <FaLink className="text-sm" />
      </button>
    </div>
  );
};

export default SocialShare;

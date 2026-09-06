# Bonwire Kente E-Commerce Platform

A full-stack, multi-vendor e-commerce platform for selling authentic Ghanaian Kente cloth and custom-printed products.

## Tech Stack

### Frontend
- **React 19** with Vite 7
- **Redux Toolkit** + RTK Query for state management and API caching
- **React Router DOM 7** for client-side routing
- **Tailwind CSS 3** for styling
- **Paystack** for payment checkout
- **Recharts** for admin dashboard analytics
- **AOS** for scroll animations
- **React Slick** for carousels
- **Service Worker** for offline-first caching

### Backend
- **Express 5** (Node.js, ES modules)
- **MySQL** (via `mysql2` with connection pool)
- **Passport.js** for OAuth (Google, Facebook)
- **JWT** for cookie-based authentication
- **bcryptjs** for password hashing
- **Nodemailer** for transactional emails (OTP verification, password reset)
- **Paystack API** for payments + webhooks
- **Replicate API** (IDM-VTON) for AI virtual try-on

## Features

- Multi-vendor marketplace with escrow system
- Platform commission (10% configurable)
- 7-day escrow auto-release after delivery
- Paystack payments with webhook verification
- Vendor payouts via Paystack Transfers
- AI virtual try-on
- Reviews, coupons, wishlist, returns
- Support tickets, notifications, saved designs
- Address book, saved payment methods

## Getting Started

### Prerequisites
- Node.js 18+
- MySQL 8+
- Paystack test account
- Google OAuth credentials (for social login)

### Installation

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
npm install --prefix backend

# Setup database (creates branding_house DB from schema)
npm run db:setup --prefix backend

# Additive migrations (new tables + marketplace/feature columns). Both are
# idempotent, so re-running them is safe.
npm run db:migrate --prefix backend

# Create the first admin account
npm run setup-admin --prefix backend
```

### Environment Configuration

Copy the template files and fill in your values:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

**Never commit your `.env` files with real credentials.** The files are gitignored.

### Development

```bash
# Run both frontend and backend (Vite on :5173, backend on :5000)
npm run dev:all

# Or run separately
npm run dev        # frontend only
npm run dev:backend # backend only
```

### Seed Data

```bash
npm run data:import   # Seed products and users
npm run data:destroy  # Destroy seeded data
```

### Production Build

```bash
npm run build
npm run preview        # preview server (default :4173)
npm start              # or serve the built app on :3000 (vite preview)
```

### Email (optional smoke tests)

```bash
npm run email:test --prefix backend           # verify SMTP credentials + send a test mail
npm run password:reset:test --prefix backend  # exercise the full reset flow
```

### Tests

```bash
# Backend tests (uses Node's built-in test runner)
npm test --prefix backend
```

## API Structure

The backend exposes RESTful endpoints under `/api/*`:
- `/api/products` - Product CRUD
- `/api/orders` - Order management
- `/api/payments` - Paystack integration + webhooks
- `/api/vendors` - Vendor application, products, analytics
- `/api/auth` - OAuth (Google, Facebook)
- `/api/users` - User management
- `/api/reviews` - Product reviews
- `/api/coupons` - Discounts
- `/api/wishlist` - Favorites
- `/api/returns` - Return/refund requests
- `/api/support` - Support tickets
- And more...

## Security

This project is built with security in mind:
- Parameterized SQL queries (SQL injection protection)
- Helmet for security headers + CSP
- CSRF protection via Origin/Referer validation
- HTTP parameter pollution prevention
- Rate limiting
- Input validation at model/controller layer
- Never leaks internal error messages to clients
- Secrets stored in environment variables (not committed)

## License

For code: ISC
Note: The AI try-on feature uses the IDM-VTON model which is licensed under CC BY-NC-SA (non-commercial only).

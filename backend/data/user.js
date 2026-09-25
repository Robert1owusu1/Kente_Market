// data/userData.js
// Seed data - main admin account only (no demo/sample customers)
//
// SECURITY: no password may live in this file. The seeding script requires
// SEED_ADMIN_PASSWORD in the environment (see seeder.js); the account is
// created with whatever you supply there. For a real deployment prefer
// `npm run setup-admin` (interactive, enforces strength) over the seeder.

export const users = [
  {
    id: 1,
    firstName: "Kente",
    lastName: "Robert",
    email: process.env.SEED_ADMIN_EMAIL || "admin@example.com",
    password: process.env.SEED_ADMIN_PASSWORD || null, // required at seed time, never committed
    phone: "+1555000123",
    address: "Bonwire, Ashanti Region",
    city: "Kumasi",
    state: "Ashanti",
    zipCode: "00233",
    country: "Ghana",
    role: "admin",
    isActive: true
  }
];

// Default export for backward compatibility
export default users;
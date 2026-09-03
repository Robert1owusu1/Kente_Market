// data/userData.js
// Seed data - main admin account only (no demo/sample customers)

export const users = [
  {
    id: 1,
    firstName: "Kente",
    lastName: "Robert",
    email: "kenterobert@gmail.com",
    password: "adminpass789", // Will be hashed when inserted
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
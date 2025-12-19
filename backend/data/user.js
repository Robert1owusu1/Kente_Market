// data/userData.js
// Sample user data for testing and seeding database

export const users = [
  {
    id: 1,
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    password: "password123", // Will be hashed when inserted
    phone: "+1234567890",
    address: "123 Main Street",
    city: "New York",
    state: "NY",
    zipCode: "10001",
    country: "USA",
    role: "customer",
    isActive: true
  },
  {
    id: 2,
    firstName: "Jane",
    lastName: "Smith",
    email: "jane.smith@example.com",
    password: "securepass456",
    phone: "+1987654321",
    address: "456 Oak Avenue",
    city: "Los Angeles",
    state: "CA",
    zipCode: "90210",
    country: "USA",
    role: "customer",
    isActive: true
  },
  {
    id: 3,
    firstName: "Admin",
    lastName: "User",
    email: "admin@example.com",
    password: "adminpass789",
    phone: "+1555000123",
    address: "789 Admin Boulevard",
    city: "Chicago",
    state: "IL",
    zipCode: "60601",
    country: "USA",
    role: "admin",
    isActive: true
  },
  {
    id: 4,
    firstName: "Emily",
    lastName: "Johnson",
    email: "emily.johnson@example.com",
    password: "emily2024",
    phone: "+1456789123",
    address: "321 Pine Street",
    city: "Seattle",
    state: "WA",
    zipCode: "98101",
    country: "USA",
    role: "customer",
    isActive: true
  },
  {
    id: 5,
    firstName: "Michael",
    lastName: "Brown",
    email: "michael.brown@example.com",
    password: "mike123secure",
    phone: "+1789123456",
    address: "654 Elm Drive",
    city: "Miami",
    state: "FL",
    zipCode: "33101",
    country: "USA",
    role: "customer",
    isActive: true
  },
  {
    id: 6,
    firstName: "Sarah",
    lastName: "Davis",
    email: "sarah.davis@example.com",
    password: "sarah456pass",
    phone: "+1321654987",
    address: "987 Maple Lane",
    city: "Denver",
    state: "CO",
    zipCode: "80201",
    country: "USA",
    role: "customer",
    isActive: false
  },
  {
    id: 7,
    firstName: "David",
    lastName: "Wilson",
    email: "david.wilson@example.com",
    password: "david789",
    phone: "+1654987321",
    address: "147 Cedar Avenue",
    city: "Austin",
    state: "TX",
    zipCode: "73301",
    country: "USA",
    role: "customer",
    isActive: true
  },
  {
    id: 8,
    firstName: "Lisa",
    lastName: "Garcia",
    email: "lisa.garcia@example.com",
    password: "lisa2024secure",
    phone: "+1852963741",
    address: "258 Birch Street",
    city: "Phoenix",
    state: "AZ",
    zipCode: "85001",
    country: "USA",
    role: "customer",
    isActive: true
  },
  {
    id: 9,
    firstName: "Robert",
    lastName: "Martinez",
    email: "robert.martinez@example.com",
    password: "robert123",
    phone: "+1741852963",
    address: "369 Willow Road",
    city: "Portland",
    state: "OR",
    zipCode: "97201",
    country: "USA",
    role: "customer",
    isActive: true
  },
  {
    id: 10,
    firstName: "Amanda",
    lastName: "Taylor",
    email: "amanda.taylor@example.com",
    password: "amanda456",
    phone: "+1963741852",
    address: "741 Spruce Circle",
    city: "Nashville",
    state: "TN",
    zipCode: "37201",
    country: "USA",
    role: "customer",
    isActive: true
  }
];

// Helper functions for different use cases
export const getActiveUsers = () => {
  return users.filter(user => user.isActive === true);
};

export const getAdminUsers = () => {
  return users.filter(user => user.role === 'admin');
};

export const getCustomerUsers = () => {
  return users.filter(user => user.role === 'customer');
};

export const getUserById = (id) => {
  return users.find(user => user.id === id);
};

export const getUserByEmail = (email) => {
  return users.find(user => user.email === email);
};

// Sample registration data for testing forms
export const sampleRegistrationData = [
  {
    firstName: "Test",
    lastName: "User",
    email: "test.user@example.com",
    password: "testpass123",
    phone: "+1555123456",
    address: "123 Test Street",
    city: "Test City",
    state: "TC",
    zipCode: "12345",
    country: "USA"
  },
  {
    firstName: "Demo",
    lastName: "Customer",
    email: "demo.customer@example.com",
    password: "democust456",
    phone: "+1555987654",
    address: "456 Demo Avenue",
    city: "Demo Town",
    state: "DT",
    zipCode: "67890",
    country: "USA"
  }
];

// Sample login credentials for testing
export const testCredentials = [
  {
    email: "john.doe@example.com",
    password: "password123",
    role: "customer"
  },
  {
    email: "admin@example.com",
    password: "adminpass789",
    role: "admin"
  },
  {
    email: "jane.smith@example.com",
    password: "securepass456",
    role: "customer"
  }
];

// User profile update samples
export const profileUpdateSamples = [
  {
    phone: "+1555999888",
    address: "Updated Address 123",
    city: "Updated City"
  },
  {
    firstName: "UpdatedFirst",
    lastName: "UpdatedLast",
    zipCode: "99999"
  }
];

// Default export for backward compatibility
export default users;
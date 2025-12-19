import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { Base_URL } from '../constant';

const baseQuery = fetchBaseQuery({ 
    baseUrl: Base_URL,
    credentials: 'include', // Send cookies with requests for authentication
    // prepareHeaders removed - let browser handle content-type automatically
});

export const apiSlice = createApi({
    baseQuery,
    tagTypes: ['Products', 'Orders', 'Users'],
    endpoints: () => ({}),
});

// How it works now:
// - JSON requests: Browser sets "application/json" automatically
// - File uploads: Browser sets "multipart/form-data; boundary=..." automatically
// - Form data: Browser sets "application/x-www-form-urlencoded" automatically
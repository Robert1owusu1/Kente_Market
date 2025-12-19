import { createSlice } from "@reduxjs/toolkit";

const initialState = {
    userInfo: localStorage.getItem('userInfo') 
        ? JSON.parse(localStorage.getItem('userInfo')) 
        : null,
}

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setCredentials: (state, action) => {
            // Handle different backend response structures
            let userInfo;
            
            // If backend returns { token, id, firstName, email, role, isAdmin }
            if (action.payload.id || action.payload._id) {
                const { token, ...userData } = action.payload;
                userInfo = userData;
                
                // ✅ Convert role to isAdmin for consistency (fallback if backend doesn't send it)
                if (userData.role && !userData.isAdmin) {
                    userInfo.isAdmin = userData.role === 'admin';
                }
            } 
            // If backend returns { token, user: { id, firstName, email, role, isAdmin } }
            else if (action.payload.user) {
                userInfo = action.payload.user;
                
                // ✅ Convert role to isAdmin for consistency (fallback if backend doesn't send it)
                if (userInfo.role && !userInfo.isAdmin) {
                    userInfo.isAdmin = userInfo.role === 'admin';
                }
            }
            // Fallback - remove only token
            else {
                const { token, ...userData } = action.payload;
                userInfo = userData;
                
                // ✅ Convert role to isAdmin for consistency (fallback if backend doesn't send it)
                if (userData.role && !userData.isAdmin) {
                    userInfo.isAdmin = userData.role === 'admin';
                }
            }
            
            state.userInfo = userInfo;
            localStorage.setItem('userInfo', JSON.stringify(userInfo));
            
            // Debug log - remove after testing
            console.log('✅ Stored userInfo:', userInfo);
            console.log('✅ isAdmin:', userInfo.isAdmin);
            console.log('✅ role:', userInfo.role);
        },

        logout: (state) => {
            state.userInfo = null;
            localStorage.removeItem('userInfo');
        }
    }
});

export const { setCredentials, logout } = authSlice.actions;

export default authSlice.reducer;
// middleware/authMiddleware.js - COMPLETE VERSION
import jwt from 'jsonwebtoken';
import asyncHandler from './asyncHandller.js';
import User from '../models/usersModel.js';

/**
 * Protect routes - Verify JWT token
 * Middleware to authenticate users via JWT token in cookies
 */
const protect = asyncHandler(async(req, res, next) => {
    let token;

    // Read the JWT from the cookie
    token = req.cookies.jwt;

    if (token) {
        try {
            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Get user from database (without password)
            const user = await User.findById(decoded.id);
            
            if (!user) {
                res.status(401);
                throw new Error('User not found');
            }

            // Check if user is active
            if (!user.isActive) {
                res.status(403);
                throw new Error('Account is deactivated');
            }
            
            // Attach user to request object (without password)
            req.user = user.getProfile();
            
            next();
        } catch (error) {
            console.error('Token verification error:', error);
            res.status(401);
            throw new Error('Not authorized, token failed');
        }
    } else {
        res.status(401);
        throw new Error('Not authorized, no token');
    }
});

/**
 * Admin middleware - Check if user is admin
 * Must be used after protect middleware
 */
const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403);
        throw new Error('Not authorized as an admin');
    }
};

export { protect, admin };
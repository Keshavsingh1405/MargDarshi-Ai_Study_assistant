import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
    let token;

    if (req.cookies && req.cookies.jwt) {
        token = req.cookies.jwt;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        res.status(401);
        return next(new Error('Not authorized, no token'));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id || decoded.userId;
        req.user = await User.findById(userId).select('-password');
        if (!req.user) {
            res.status(401);
            return next(new Error('Not authorized, user not found'));
        }
        next();
    } catch (error) {
        res.status(401);
        return next(new Error('Not authorized, token failed'));
    }
};

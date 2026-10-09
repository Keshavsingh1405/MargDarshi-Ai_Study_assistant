import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const generateToken = (res, userId) => {
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: '30d'
    });

    if (res && res.cookie) {
        res.cookie('jwt', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // Only secure in production
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
            path: '/', // Ensure cookie is sent for all routes
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });
    }

    return token;
};

export const generateRandomToken = () => {
    return crypto.randomBytes(20).toString('hex');
};

import User from '../models/User.js';
import { generateToken, generateRandomToken } from '../utils/tokenUtils.js';
import { resend, fromEmail } from '../config/resend.js';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

export const registerUser = async (req, res, next) => {
    try {
        const { name, email, password } = req.body;
        
        const userExists = await User.findOne({ email });
        if (userExists) {
            res.status(400);
            throw new Error('User already exists');
        }

        const verificationToken = generateRandomToken();
        
        const user = await User.create({
            name,
            email,
            password,
            verificationToken,
            verificationTokenExpires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
        });

        if (user) {
            const token = generateToken(res, user._id);

            // Send welcome email (optional, using Resend)
            if (process.env.RESEND_API_KEY) {
                const verifyUrl = `${process.env.FRONTEND_URL}/verify-email.html?token=${verificationToken}`;
                try {
                    await resend.emails.send({
                        from: fromEmail,
                        to: user.email,
                        subject: 'Welcome to Margdarshi - Verify your email',
                        html: `<p>Welcome, ${user.name}!</p><p>Please verify your email by clicking <a href="${verifyUrl}">here</a>.</p>`
                    });
                } catch (e) {
                    console.error('Email send failed', e);
                }
            }

            res.status(201).json({
                success: true,
                token,
                data: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    isVerified: user.isVerified
                }
            });
        } else {
            res.status(400);
            throw new Error('Invalid user data');
        }
    } catch (error) {
        next(error);
    }
};

export const loginUser = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });

        if (user && (await user.matchPassword(password))) {
            const token = generateToken(res, user._id);
            res.json({
                success: true,
                token,
                data: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    isVerified: user.isVerified
                }
            });
        } else {
            res.status(401);
            throw new Error('Invalid email or password');
        }
    } catch (error) {
        next(error);
    }
};

export const logoutUser = (req, res) => {
    res.cookie('jwt', '', {
        httpOnly: true,
        expires: new Date(0)
    });
    res.status(200).json({ success: true, message: 'Logged out successfully' });
};

export const getUserProfile = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id);
        if (user) {
            res.json({
                success: true,
                data: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    isVerified: user.isVerified
                }
            });
        } else {
            res.status(404);
            throw new Error('User not found');
        }
    } catch (error) {
        next(error);
    }
};

export const verifyEmail = async (req, res, next) => {
    try {
        const { token } = req.params;
        const user = await User.findOne({
            verificationToken: token,
            verificationTokenExpires: { $gt: Date.now() }
        });

        if (!user) {
            res.status(400);
            throw new Error('Invalid or expired token');
        }

        user.isVerified = true;
        user.verificationToken = undefined;
        user.verificationTokenExpires = undefined;
        await user.save();

        res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        next(error);
    }
};

export const forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            res.status(404);
            throw new Error('User not found');
        }

        const resetToken = generateRandomToken();
        user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
        await user.save();

        if (process.env.RESEND_API_KEY) {
            const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;
            try {
                await resend.emails.send({
                    from: fromEmail,
                    to: user.email,
                    subject: 'Margdarshi - Password Reset',
                    html: `<p>You requested a password reset.</p><p>Click <a href="${resetUrl}">here</a> to reset your password.</p>`
                });
            } catch (e) {
                console.error('Email send failed', e);
            }
        }

        res.json({ success: true, message: 'Password reset email sent' });
    } catch (error) {
        next(error);
    }
};

export const resetPassword = async (req, res, next) => {
    try {
        const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            res.status(400);
            throw new Error('Invalid or expired reset token');
        }

        user.password = req.body.password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        next(error);
    }
};

export const googleAuth = (req, res) => {
    const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`
    );

    const authorizeUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'],
        prompt: 'consent'
    });

    res.redirect(authorizeUrl);
};

export const googleAuthCallback = async (req, res, next) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login.html?error=NoAuthCode`);
        }
        
        const client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/google/callback`
        );

        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        
        const email = payload.email;
        const name = payload.name;

        let user = await User.findOne({ email });
        
        if (!user) {
            user = await User.create({
                name,
                email,
                password: generateRandomToken(), // random secure password
                isVerified: payload.email_verified || true
            });
        } else if (!user.isVerified && payload.email_verified) {
             user.isVerified = true;
             await user.save();
        }

        const token = generateToken(res, user._id);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard.html?token=${token}`);
    } catch (error) {
        console.error('Google Auth Error:', error);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login.html?error=GoogleAuthFailed`);
    }
};

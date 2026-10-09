import { Resend } from 'resend';

export const resend = new Resend(process.env.RESEND_API_KEY || 'dummy_key');
export const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

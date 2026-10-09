import { apiFetch } from './api.js';

// Check for token in URL (from Google OAuth callback) immediately
try {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
        localStorage.setItem('token', urlToken);
        // Clean URL to remove token parameter for clean browser history
        urlParams.delete('token');
        const remainingQuery = urlParams.toString();
        const cleanUrl = window.location.pathname + (remainingQuery ? `?${remainingQuery}` : '') + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
    }
} catch (e) {
    console.error('Error parsing token parameter:', e);
}

export const checkAuth = async () => {
    try {
        const data = await apiFetch('/auth/me');
        if (data && data.success) {
            if (data.data) {
                localStorage.setItem('user', JSON.stringify(data.data));
            }
            return data.data;
        }
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        return null;
    } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        return null;
    }
};

export const logout = async () => {
    try {
        await apiFetch('/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout failed:', error);
    } finally {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
    }
};

// Protect routes
document.addEventListener('DOMContentLoaded', async () => {
    const isAuthPage = window.location.pathname.includes('login') || window.location.pathname.includes('register') || window.location.pathname === '/' || window.location.pathname === '/index.html';
    
    const user = await checkAuth();

    if (user && isAuthPage && window.location.pathname !== '/') {
        window.location.href = '/dashboard.html';
    } else if (!user && !isAuthPage) {
        window.location.href = '/login.html';
    }
});

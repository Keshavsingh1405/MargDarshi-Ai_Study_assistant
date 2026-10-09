const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const apiFetch = async (endpoint, options = {}) => {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    // Merge options
    const finalOptions = { 
        ...defaultOptions, 
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {})
        }
    };

    // Attach Bearer token from localStorage if available
    const token = localStorage.getItem('token');
    if (token) {
        finalOptions.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // If body is FormData, remove Content-Type to let browser set boundary
    if (finalOptions.body instanceof FormData) {
        delete finalOptions.headers['Content-Type'];
    }

    // Ensure credentials are sent (cookies)
    finalOptions.credentials = 'include';

    try {
        const response = await fetch(`${API_URL}${endpoint}`, finalOptions);
        
        let data;
        // Attempt to parse JSON
        try {
            data = await response.json();
        } catch (e) {
            data = null;
        }

        // If server returns a token, persist it
        if (data && data.token) {
            localStorage.setItem('token', data.token);
        }

        if (!response.ok) {
            if (response.status === 401 && endpoint !== '/auth/me') {
                // Unauthorized, clear credentials and redirect to login
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = '/login.html';
            }
            throw new Error((data && data.message) ? data.message : `Error: ${response.status}`);
        }

        return data;
    } catch (error) {
        if (endpoint !== '/auth/me') {
            console.error('API Error:', error);
        }
        throw error;
    }
};

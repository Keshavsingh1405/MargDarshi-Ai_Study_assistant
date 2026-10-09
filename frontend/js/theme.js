// Margdarshi Global Theme Manager (Light / Dark Mode)

export function getSavedTheme() {
    return localStorage.getItem('theme') || 'light';
}

export function applyTheme(theme) {
    const currentTheme = theme || getSavedTheme();
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);

    // Update Lucide icon across all toggle buttons
    const toggleBtns = document.querySelectorAll('.dark-mode-toggle, #theme-toggle-btn');
    toggleBtns.forEach(btn => {
        const targetIconName = currentTheme === 'dark' ? 'sun' : 'moon';
        btn.setAttribute('title', currentTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
        
        const existingIcon = btn.querySelector('i[data-lucide], svg');
        if (existingIcon) {
            const newIcon = document.createElement('i');
            newIcon.setAttribute('data-lucide', targetIconName);
            newIcon.setAttribute('id', 'theme-toggle-icon');
            newIcon.style.width = '18px';
            newIcon.style.height = '18px';
            existingIcon.replaceWith(newIcon);
        } else {
            btn.innerHTML = `<i data-lucide="${targetIconName}" id="theme-toggle-icon" style="width: 18px; height: 18px;"></i>`;
        }
    });

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

export function toggleTheme() {
    const currentTheme = getSavedTheme();
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
}

// Global Event Delegation for reliable click handling across all pages
document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.dark-mode-toggle, #theme-toggle-btn');
    if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
        return;
    }

    const avatarBtn = e.target.closest('#header-user-avatar, .header-avatar');
    if (avatarBtn) {
        window.location.href = 'profile.html';
        return;
    }
});

// Ensure theme is applied immediately and on DOM ready
const initialTheme = getSavedTheme();
document.documentElement.setAttribute('data-theme', initialTheme);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyTheme(initialTheme));
} else {
    applyTheme(initialTheme);
}

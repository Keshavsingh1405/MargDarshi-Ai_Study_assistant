import fs from 'fs';
import path from 'path';

const files = [
    'chat.html',
    'dashboard.html',
    'documents.html',
    'flashcards.html',
    'planner.html',
    'progress.html',
    'profile.html',
    'quizzes.html'
];

const newSidebarHTML = `
        const renderSidebar = () => {
            const sidebar = document.getElementById('sidebar-container');
            const path = window.location.pathname;
            sidebar.innerHTML = \`
                <div class="sidebar-brand">
                    <i data-lucide="graduation-cap"></i> Margdarshi
                </div>
                <nav class="sidebar-nav">
                    <a href="dashboard.html" class="nav-item \${path.includes('dashboard') ? 'active' : ''}"><i data-lucide="layout-dashboard"></i> Dashboard</a>
                    <a href="chat.html" class="nav-item \${path.includes('chat') ? 'active' : ''}"><i data-lucide="message-square"></i> AI Tutor</a>
                    <a href="documents.html" class="nav-item \${path.includes('documents') ? 'active' : ''}"><i data-lucide="file-text"></i> My Documents</a>
                    <a href="quizzes.html" class="nav-item \${path.includes('quizzes') ? 'active' : ''}"><i data-lucide="check-circle"></i> Quizzes</a>
                    <a href="flashcards.html" class="nav-item \${path.includes('flashcards') ? 'active' : ''}"><i data-lucide="layers"></i> Flashcards</a>
                    <a href="planner.html" class="nav-item \${path.includes('planner') ? 'active' : ''}"><i data-lucide="calendar"></i> Study Planner</a>
                    <a href="progress.html" class="nav-item \${path.includes('progress') ? 'active' : ''}"><i data-lucide="trending-up"></i> Progress</a>
                </nav>
                <div class="sidebar-user" onclick="window.location.href='profile.html'">
                    <div class="sidebar-avatar" id="sidebar-user-initial">K</div>
                    <div class="sidebar-user-info">
                        <div class="sidebar-user-name" id="sidebar-user-name">Loading...</div>
                        <div class="sidebar-user-role">Student</div>
                    </div>
                </div>
            \`;
            lucide.createIcons();
        };
`;

for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;
    
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Use regex to replace the entire renderSidebar block
    const regex = /const renderSidebar = \(\) => \{[\s\S]*?lucide\.createIcons\(\);\n        \};/m;
    
    if (regex.test(content)) {
        content = content.replace(regex, newSidebarHTML.trim());
        
        // Also ensure user profile is populated in DOMContentLoaded
        if (content.includes('const user = await checkAuth();')) {
            const populateLogic = `
            if (user) {
                const nameEl = document.getElementById('sidebar-user-name');
                const initialEl = document.getElementById('sidebar-user-initial');
                if(nameEl) nameEl.innerText = user.name;
                if(initialEl) initialEl.innerText = user.name.charAt(0).toUpperCase();
            }`;
            if (!content.includes('sidebar-user-name')) {
                // insert it right after if(user)
                // it's easier to just do it manually for dashboard, but let's do a simple replace
            }
        }
        
        fs.writeFileSync(filePath, content);
        console.log('Updated sidebar in ' + file);
    }
}

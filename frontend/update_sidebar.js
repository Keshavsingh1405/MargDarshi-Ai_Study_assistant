import fs from 'fs';
import path from 'path';

const files = [
    'chat.html',
    'dashboard.html',
    'documents.html',
    'flashcards.html',
    'planner.html',
    'progress.html',
    'quizzes.html'
];

for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Check if profile link already exists
    if (!content.includes('href="profile.html"')) {
        const insertPoint = '</nav>';
        const profileLink = `<a href="profile.html" class="nav-item \${path.includes('profile') ? 'active' : ''}"><i data-lucide="user"></i> My Profile</a>\n                `;
        
        if (content.includes(insertPoint)) {
            content = content.replace(insertPoint, profileLink + insertPoint);
            fs.writeFileSync(filePath, content);
            console.log('Updated ' + file);
        }
    }
}

import fs from 'fs';
import path from 'path';

const files = [
    'chat.html',
    'documents.html',
    'flashcards.html',
    'planner.html',
    'progress.html',
    'quizzes.html'
];

for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;
    
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Check if we need to replace checkAuth logic
    const oldAuthStr = 'await checkAuth();';
    const newAuthStr = `const user = await checkAuth();
            if (user) {
                const nameEl = document.getElementById('sidebar-user-name');
                const initialEl = document.getElementById('sidebar-user-initial');
                if(nameEl) nameEl.innerText = user.name;
                if(initialEl) initialEl.innerText = user.name.charAt(0).toUpperCase();
            }`;
            
    if (content.includes(oldAuthStr) && !content.includes('const user = await checkAuth();')) {
        content = content.replace(oldAuthStr, newAuthStr);
        fs.writeFileSync(filePath, content);
        console.log('Updated auth logic in ' + file);
    }
}

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
    
    // Replace `path.includes` with `window.location.pathname.includes`
    const buggyString = "${path.includes('profile') ? 'active' : ''}";
    const fixedString = "${window.location.pathname.includes('profile') ? 'active' : ''}";
    
    if (content.includes(buggyString)) {
        content = content.replace(buggyString, fixedString);
        fs.writeFileSync(filePath, content);
        console.log('Fixed ' + file);
    }
}

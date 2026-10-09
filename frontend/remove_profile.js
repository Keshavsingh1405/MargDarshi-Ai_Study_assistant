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
    
    // Split into lines, filter out the profile link, and join back
    const lines = content.split('\n');
    const newLines = lines.filter(line => !line.includes('href="profile.html"'));
    
    if (lines.length !== newLines.length) {
        fs.writeFileSync(filePath, newLines.join('\n'));
        console.log('Removed profile link from ' + file);
    }
}

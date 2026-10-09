import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import mongoose from 'mongoose';
import QuizAttempt from './src/models/QuizAttempt.js';
import Quiz from './src/models/Quiz.js';
import Progress from './src/models/Progress.js';

mongoose.connect(process.env.MONGODB_URI);

async function repair() {
    const progress = await Progress.findOne();
    if (!progress) return process.exit(0);
    
    const attempts = await QuizAttempt.find({ userId: progress.userId });
    
    let totalQuestions = 0;
    let totalCorrect = 0;
    const subStats = {};
    
    for (const att of attempts) {
        const qz = await Quiz.findById(att.quizId);
        totalQuestions += att.totalQuestions;
        totalCorrect += att.score;
        
        if (!subStats[qz.subject]) subStats[qz.subject] = { q: 0, c: 0 };
        subStats[qz.subject].q += att.totalQuestions;
        subStats[qz.subject].c += att.score;
    }
    
    progress.questionsAttempted = totalQuestions;
    progress.averageAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;
    
    progress.subjectPerformance = [];
    for (const [sub, stats] of Object.entries(subStats)) {
        progress.subjectPerformance.push({
            subject: sub,
            questionsAttempted: stats.q,
            accuracy: stats.q > 0 ? (stats.c / stats.q) * 100 : 0
        });
    }
    
    await progress.save();
    console.log("Repaired Progress:", progress.subjectPerformance);
    process.exit(0);
}
repair();

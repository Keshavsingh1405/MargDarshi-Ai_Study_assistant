import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

import User from './models/User.js';
import Document from './models/Document.js';
import Quiz from './models/Quiz.js';
import QuizAttempt from './models/QuizAttempt.js';
import Flashcard from './models/Flashcard.js';
import StudyPlan from './models/StudyPlan.js';
import Progress from './models/Progress.js';

async function checkDb() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/margdarshi');
    console.log('Connected to MongoDB');
    
    const users = await User.find({});
    console.log(`Users (${users.length}):`, users.map(u => ({ id: u._id, email: u.email, name: u.name })));
    
    for (const u of users) {
        console.log(`\n--- User: ${u.email} (${u._id}) ---`);
        const docs = await Document.find({ userId: u._id });
        console.log(`Documents (${docs.length}):`, docs.map(d => ({ id: d._id, name: d.originalName, subject: d.subject })));
        
        const quizzes = await Quiz.find({ userId: u._id });
        console.log(`Quizzes (${quizzes.length}):`, quizzes.map(q => ({ id: q._id, title: q.title, subject: q.subject, questions: q.questions.length })));
        
        const attempts = await QuizAttempt.find({ userId: u._id });
        console.log(`Quiz Attempts (${attempts.length}):`, attempts.map(a => ({ id: a._id, quizId: a.quizId, score: a.score, total: a.totalQuestions, accuracy: a.accuracy, createdAt: a.createdAt })));
        
        const flashcards = await Flashcard.find({ userId: u._id });
        console.log(`Flashcards (${flashcards.length}):`, flashcards.map(f => ({ id: f._id, subject: f.subject, status: f.status, reviewCount: f.reviewCount })));
        
        const plans = await StudyPlan.find({ userId: u._id });
        console.log(`Study Plans (${plans.length}):`, plans.map(p => ({ id: p._id, examName: p.examName, days: p.plan.length })));
        
        const prog = await Progress.findOne({ userId: u._id });
        console.log(`Progress record:`, prog ? {
            totalDocuments: prog.totalDocuments,
            questionsAttempted: prog.questionsAttempted,
            averageAccuracy: prog.averageAccuracy,
            studyStreak: prog.studyStreak,
            subjectPerformance: prog.subjectPerformance,
            weakTopics: prog.weakTopics
        } : null);
    }
    
    await mongoose.disconnect();
}

checkDb().catch(console.error);

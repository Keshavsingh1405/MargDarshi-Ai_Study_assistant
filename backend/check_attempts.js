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

async function check() {
    const attempts = await QuizAttempt.find().sort({ createdAt: -1 }).limit(1);
    if (attempts.length > 0) {
        console.log("LAST ATTEMPT SCORE:", attempts[0].score, "/", attempts[0].totalQuestions);
        console.log("ANSWERS SUBMITTED:", JSON.stringify(attempts[0].answers, null, 2));
        
        const quiz = await Quiz.findById(attempts[0].quizId);
        console.log("\nQUIZ CORRECT ANSWERS:");
        quiz.questions.forEach(q => {
            console.log("Q:", q.questionText);
            console.log("Options:", q.options);
            console.log("Correct:", q.correctAnswer);
        });
        
        const prog = await Progress.findOne({ userId: attempts[0].userId });
        console.log("\nPROGRESS:", JSON.stringify(prog.subjectPerformance, null, 2));
    }
    process.exit(0);
}
check();

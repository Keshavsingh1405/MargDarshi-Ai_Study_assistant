import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Quiz from '../src/models/Quiz.js';
import QuizAttempt from '../src/models/QuizAttempt.js';
import StudySession from '../src/models/StudySession.js';
import Progress from '../src/models/Progress.js';
import Flashcard from '../src/models/Flashcard.js';
import StudyPlan from '../src/models/StudyPlan.js';
import Document from '../src/models/Document.js';
import { getProgress } from '../src/controllers/progressController.js';

describe('Progress & Dashboard Real Data Verification Tests', () => {
    let user1Id;
    let user2Id;

    before(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGODB_URI);
        }
        user1Id = new mongoose.Types.ObjectId();
        user2Id = new mongoose.Types.ObjectId();
    });

    after(async () => {
        await Quiz.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await QuizAttempt.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await StudySession.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await Progress.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await Flashcard.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await StudyPlan.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await Document.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await mongoose.disconnect();
    });

    test('1. Empty user history returns clean zeroed metrics without fabricated AI statistics', async () => {
        const req = { user: { _id: user1Id } };
        let responseJson = null;
        const res = { json: (data) => { responseJson = data; } };

        await getProgress(req, res, () => {});
        assert.equal(responseJson.success, true);
        const data = responseJson.data;

        assert.equal(data.overview.overallAccuracy, 0, 'Accuracy should be 0 when no attempts exist');
        assert.equal(data.overview.totalStudyTime, 0, 'Study time hours should be 0');
        assert.equal(data.overview.questionsCompleted, 0, 'Questions completed should be 0');
        assert.equal(data.overview.studySessions, 0, 'Session count should be 0');
        assert.equal(data.overview.flashcardsMastered, 0, 'Flashcards mastered should be 0');
        assert.deepEqual(data.subjectMastery, [], 'Subject mastery must be empty array with no fabricated data');
        assert.deepEqual(data.weakTopics, [], 'Weak topics must be empty');
    });

    test('2. Real QuizAttempt and StudySession reflect accurately in calculated progress', async () => {
        const quiz = await Quiz.create({
            userId: user1Id,
            title: 'Database Normalization',
            subject: 'Database Systems',
            questions: [
                { questionText: 'Q1', type: 'MCQ', correctAnswer: 'A' },
                { questionText: 'Q2', type: 'MCQ', correctAnswer: 'B' },
                { questionText: 'Q3', type: 'MCQ', correctAnswer: 'C' },
                { questionText: 'Q4', type: 'MCQ', correctAnswer: 'D' }
            ]
        });

        // Create attempt with 3/4 correct (75% accuracy)
        await QuizAttempt.create({
            userId: user1Id,
            quizId: quiz._id,
            score: 3,
            totalQuestions: 4,
            accuracy: 75,
            answers: []
        });

        // Create real StudySession of 90 minutes
        await StudySession.create({
            userId: user1Id,
            subject: 'Database Systems',
            duration: 90,
            activityType: 'General',
            notes: 'Reviewed 1NF, 2NF, 3NF'
        });

        const req = { user: { _id: user1Id } };
        let responseJson = null;
        const res = { json: (data) => { responseJson = data; } };

        await getProgress(req, res, () => {});
        assert.equal(responseJson.success, true);
        const data = responseJson.data;

        assert.equal(data.overview.overallAccuracy, 75, 'Accuracy should be exactly 75%');
        assert.equal(data.overview.totalStudyTime, 1.5, '90 minutes should equal 1.5 hours');
        assert.equal(data.overview.studySessions, 1, 'Should count 1 real session');
        assert.equal(data.overview.questionsCompleted, 4, 'Should count 4 questions attempted');
    });

    test('3. User isolation: User 2 records never contaminate User 1 progress metrics', async () => {
        // Create 200 minutes and 100% accuracy for User 2
        const quizUser2 = await Quiz.create({
            userId: user2Id,
            title: 'User 2 Chemistry',
            subject: 'Chemistry',
            questions: [{ questionText: 'Q1', type: 'MCQ', correctAnswer: 'A' }]
        });
        await QuizAttempt.create({
            userId: user2Id,
            quizId: quizUser2._id,
            score: 1,
            totalQuestions: 1,
            accuracy: 100,
            answers: []
        });
        await StudySession.create({
            userId: user2Id,
            subject: 'Chemistry',
            duration: 200,
            activityType: 'General'
        });

        // Fetch User 1 progress
        const req1 = { user: { _id: user1Id } };
        let res1Data = null;
        const res1 = { json: (data) => { res1Data = data; } };

        await getProgress(req1, res1, () => {});
        assert.equal(res1Data.data.overview.overallAccuracy, 75, 'User 1 accuracy must remain 75%');
        assert.equal(res1Data.data.overview.totalStudyTime, 1.5, 'User 1 hours must remain 1.5');
    });
});

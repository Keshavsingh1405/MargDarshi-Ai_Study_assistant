import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Quiz from '../src/models/Quiz.js';
import QuizAttempt from '../src/models/QuizAttempt.js';
import StudySession from '../src/models/StudySession.js';
import Progress from '../src/models/Progress.js';
import { submitQuiz, deleteQuiz } from '../src/controllers/quizController.js';

describe('Quiz Submission, Deduplication, and Scoring Tests', () => {
    let user1Id;
    let user2Id;
    let testQuiz;

    before(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGODB_URI);
        }
        user1Id = new mongoose.Types.ObjectId();
        user2Id = new mongoose.Types.ObjectId();

        testQuiz = await Quiz.create({
            userId: user1Id,
            title: 'Computer Networks Quiz',
            subject: 'Computer Networks',
            topic: 'TCP/IP Model',
            difficulty: 'Medium',
            questions: [
                {
                    questionText: 'Which layer of OSI corresponds to TCP?',
                    type: 'MCQ',
                    options: ['Network', 'Transport', 'Data Link', 'Application'],
                    correctAnswer: 'Transport',
                    explanation: 'TCP operates at Layer 4: Transport.'
                },
                {
                    questionText: 'What is the standard port for HTTP?',
                    type: 'MCQ',
                    options: ['21', '22', '80', '443'],
                    correctAnswer: '80',
                    explanation: 'Port 80 is used for unencrypted HTTP traffic.'
                }
            ]
        });
    });

    after(async () => {
        await Quiz.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await QuizAttempt.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await StudySession.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await Progress.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await mongoose.disconnect();
    });

    test('1. Missing answers array returns 400', async () => {
        const req = {
            user: { _id: user1Id },
            params: { id: testQuiz._id },
            body: {}
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await submitQuiz(req, res, () => {});
        assert.equal(statusCode, 400);
        assert.equal(responseJson.success, false);
        assert.match(responseJson.message, /array of answers is required/);
    });

    test('2. User isolation: User 2 cannot submit answers for User 1 quiz', async () => {
        const req = {
            user: { _id: user2Id }, // Different user
            params: { id: testQuiz._id },
            body: { answers: [] }
        };
        let errorThrown = null;
        const res = {
            status: () => res,
            json: () => {}
        };
        const next = (err) => { errorThrown = err; };

        await submitQuiz(req, res, next);
        assert(errorThrown, 'Should fail when attempting to submit another user quiz');
        assert.match(errorThrown.message, /Quiz not found/);
    });

    test('3. Correct answers are scored properly and accuracy calculated accurately', async () => {
        const q0 = testQuiz.questions[0];
        const q1 = testQuiz.questions[1];

        const req = {
            user: { _id: user1Id },
            params: { id: testQuiz._id },
            body: {
                answers: [
                    { questionId: q0._id.toString(), userAnswer: 'Transport' }, // Correct
                    { questionId: q1._id.toString(), userAnswer: '443' }        // Incorrect (correct is 80)
                ]
            }
        };
        let responseJson = null;
        const res = {
            json: (data) => { responseJson = data; }
        };

        await submitQuiz(req, res, () => {});
        assert.equal(responseJson.success, true);
        const attempt = responseJson.data;
        assert.equal(attempt.score, 1);
        assert.equal(attempt.totalQuestions, 2);
        assert.equal(attempt.accuracy, 50);
        assert.equal(attempt.answers[0].isCorrect, true);
        assert.equal(attempt.answers[1].isCorrect, false);

        // Verify StudySession created for completed quiz
        await new Promise(r => setTimeout(r, 100));
        const session = await StudySession.findOne({ userId: user1Id, activityType: 'Quiz' });
        assert(session, 'StudySession must be logged on quiz submission');
    });

    test('4. Rapid repeated submissions return existing attempt without creating duplicates', async () => {
        await QuizAttempt.deleteMany({ quizId: testQuiz._id });

        const q0 = testQuiz.questions[0];
        const q1 = testQuiz.questions[1];

        const req = {
            user: { _id: user1Id },
            params: { id: testQuiz._id },
            body: {
                answers: [
                    { questionId: q0._id.toString(), userAnswer: 'Transport' },
                    { questionId: q1._id.toString(), userAnswer: '80' }
                ]
            }
        };

        let res1Data = null;
        const res1 = { json: (data) => { res1Data = data; } };

        let res2Data = null;
        const res2 = { json: (data) => { res2Data = data; } };

        // Submit once
        await submitQuiz(req, res1, () => {});
        const firstAttemptId = res1Data.data._id.toString();

        // Submit immediately again (within 4s)
        await submitQuiz(req, res2, () => {});
        const secondAttemptId = res2Data.data._id.toString();

        assert.equal(firstAttemptId, secondAttemptId, 'Duplicate submission should return existing attempt ID');

        // Confirm in database: only 1 attempt created despite 2 submissions
        const totalAttempts = await QuizAttempt.countDocuments({ userId: user1Id, quizId: testQuiz._id });
        assert.equal(totalAttempts, 1, 'Should have exactly 1 attempt, avoiding duplicate record');
    });

    test('5. Deleting a quiz removes the quiz and preserves other user quizzes', async () => {
        const otherQuiz = await Quiz.create({
            userId: user2Id,
            title: 'User 2 Quiz',
            subject: 'Math',
            questions: []
        });

        const req = {
            user: { _id: user1Id },
            params: { id: testQuiz._id }
        };
        let responseJson = null;
        const res = { json: (data) => { responseJson = data; } };

        await deleteQuiz(req, res, () => {});
        assert.equal(responseJson.success, true);

        // Verify testQuiz deleted
        const found1 = await Quiz.findById(testQuiz._id);
        assert.equal(found1, null);

        // Verify otherQuiz intact
        const found2 = await Quiz.findById(otherQuiz._id);
        assert(found2, 'User 2 quiz must not be affected');
    });
});

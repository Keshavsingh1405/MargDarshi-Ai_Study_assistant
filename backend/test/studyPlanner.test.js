import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import StudyPlan from '../src/models/StudyPlan.js';
import StudySession from '../src/models/StudySession.js';
import { generateStudyPlan, getStudyPlans, updateStudyPlan, deleteStudyPlan } from '../src/controllers/plannerController.js';

describe('Study Planner AI Generation, Normalization & Scoping Tests', () => {
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
        await StudyPlan.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await StudySession.deleteMany({ userId: { $in: [user1Id, user2Id] } });
        await mongoose.disconnect();
    });

    test('1. Missing required fields returns 400', async () => {
        const req = {
            user: { _id: user1Id },
            body: { examName: '', examDate: '', subjects: [] }
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(req, res, () => {});
        assert.equal(statusCode, 400);
        assert.equal(responseJson.success, false);
        assert.match(responseJson.message, /Exam name is required/);
    });

    test('2. Invalid exam date returns 400', async () => {
        const req = {
            user: { _id: user1Id },
            body: {
                examName: 'Final Exam',
                examDate: 'not-a-valid-date',
                subjects: ['Operating Systems'],
                dailyStudyTime: 120
            }
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(req, res, () => {});
        assert.equal(statusCode, 400);
        assert.equal(responseJson.success, false);
        assert.match(responseJson.message, /valid exam date/);
    });

    test('3. Non-standard AI taskType values are normalized to valid enum strings', async () => {
        const req = {
            user: { _id: user1Id },
            body: {
                examName: 'Midterm Exam',
                examDate: new Date(Date.now() + 1 * 86400000).toISOString(),
                subjects: ['Data Structures'],
                dailyStudyTime: 90
            }
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        // Mock AI returning non-standard task types
        const mockAI = async () => ({
            text: JSON.stringify({
                plan: [
                    {
                        day: new Date().toISOString(),
                        tasks: [
                            { subject: 'Data Structures', topic: 'Binary Search', duration: 45, taskType: 'solving problems' }, // Should normalize to Practice questions
                            { subject: 'Data Structures', topic: 'Graph Theory', duration: 45, taskType: 'reading chapter' } // Should normalize to Revision
                        ]
                    }
                ]
            })
        });

        await generateStudyPlan(req, res, () => {}, {
            generateAIContent: mockAI
        });

        assert.equal(statusCode, 201);
        assert.equal(responseJson.success, true);
        const plan = responseJson.data;
        assert.equal(plan.plan.length, 1);
        assert.equal(plan.plan[0].tasks[0].taskType, 'Practice questions');
        assert.equal(plan.plan[0].tasks[1].taskType, 'Revision');

        // Verify it persisted in MongoDB without enum validation errors
        const saved = await StudyPlan.findById(plan._id);
        assert(saved, 'Plan must be persisted in database');
    });

    test('4. AI service failure returns 503 with clear diagnostic message', async () => {
        const req = {
            user: { _id: user1Id },
            body: {
                examName: 'GATE 2027',
                examDate: new Date(Date.now() + 30 * 86400000).toISOString(),
                subjects: ['Algorithms'],
                dailyStudyTime: 120
            }
        };
        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        const mockFailingAI = async () => {
            const err = new Error('AI service is temporarily unavailable. Both primary and backup models failed to respond.');
            err.status = 503;
            throw err;
        };

        await generateStudyPlan(req, res, () => {}, {
            generateAIContent: mockFailingAI
        });

        assert.equal(statusCode, 503);
        assert.equal(responseJson.success, false);
        assert.match(responseJson.message, /AI service is temporarily unavailable/);
    });

    test('5. User isolation: User 2 cannot access or delete User 1 study plan', async () => {
        const plan = await StudyPlan.create({
            userId: user1Id,
            examName: 'Private Exam',
            examDate: new Date(),
            subjects: ['Calculus'],
            dailyStudyTime: 60,
            plan: []
        });

        const req = {
            user: { _id: user2Id }, // Different user
            params: { id: plan._id }
        };
        let errorThrown = null;
        const res = {
            status: () => res,
            json: () => {}
        };
        const next = (err) => { errorThrown = err; };

        await deleteStudyPlan(req, res, next);
        assert(errorThrown, 'Should throw error when attempting to delete another user plan');
        assert.match(errorThrown.message, /Study plan not found/);

        // Verify the plan still exists
        const exists = await StudyPlan.findById(plan._id);
        assert(exists, 'Plan must remain intact');
    });

    test('6. Completing a plan task creates a real StudySession record', async () => {
        const plan = await StudyPlan.create({
            userId: user1Id,
            examName: 'Physics Midterm',
            examDate: new Date(),
            subjects: ['Physics'],
            dailyStudyTime: 60,
            plan: [
                {
                    day: new Date(),
                    tasks: [
                        { subject: 'Physics', topic: 'Thermodynamics', duration: 45, taskType: 'Revision', isCompleted: false }
                    ]
                }
            ]
        });

        const req = {
            user: { _id: user1Id },
            params: { id: plan._id },
            body: { dayIndex: 0, taskIndex: 0, isCompleted: true }
        };
        let responseJson = null;
        const res = {
            json: (data) => { responseJson = data; }
        };

        await updateStudyPlan(req, res, () => {});
        assert.equal(responseJson.success, true);
        assert.equal(responseJson.data.plan[0].tasks[0].isCompleted, true);

        // Verify StudySession was created
        await new Promise(r => setTimeout(r, 100));
        const session = await StudySession.findOne({ userId: user1Id, topic: 'Thermodynamics' });
        assert(session, 'StudySession record must be created on task completion');
        assert.equal(session.duration, 45);
        assert.equal(session.activityType, 'Study Plan');
    });
});

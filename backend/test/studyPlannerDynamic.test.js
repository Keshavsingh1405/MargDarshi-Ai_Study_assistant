import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import StudyPlan from '../src/models/StudyPlan.js';
import StudySession from '../src/models/StudySession.js';
import Document from '../src/models/Document.js';
import { generateStudyPlan, getStudyPlans, getStudyPlanById, updateStudyPlan, deleteStudyPlan, regenerateStudyPlan } from '../src/controllers/plannerController.js';
import { calculatePreparationWindow, formatDateOnly, parseDateOnly } from '../src/utils/dateUtils.js';

describe('Study Planner Dynamic Preparation Period & Enhancement Tests', () => {
    let testUserId;

    before(async () => {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGODB_URI);
        }
        testUserId = new mongoose.Types.ObjectId();
    });

    after(async () => {
        await StudyPlan.deleteMany({ userId: testUserId });
        await StudySession.deleteMany({ userId: testUserId });
        await Document.deleteMany({ userId: testUserId });
        await mongoose.disconnect();
    });

    test('1. Exam 2 days away: generates exactly 2 preparation days (day before exam)', async () => {
        const currentDate = '2026-10-09';
        const examDate = '2026-10-11';
        
        const req = {
            user: { _id: testUserId },
            body: {
                examName: 'Operating Systems Pop Quiz',
                examDate,
                currentDate,
                subjects: ['Operating Systems'],
                dailyStudyTime: 120
            }
        };

        const mockAI = async () => ({
            text: JSON.stringify({
                plan: [
                    {
                        dayNumber: 1,
                        date: '2026-10-09',
                        tasks: [
                            { title: 'OS Process Management', subject: 'Operating Systems', topic: 'Processes & Threads', duration: 60, taskType: 'Revision', priority: 'High' },
                            { title: 'OS Practice Problems', subject: 'Operating Systems', topic: 'CPU Scheduling Drills', duration: 60, taskType: 'Practice questions', priority: 'Medium' }
                        ]
                    },
                    {
                        dayNumber: 2,
                        date: '2026-10-10',
                        tasks: [
                            { title: 'Memory Management Revision', subject: 'Operating Systems', topic: 'Paging & Segmentation', duration: 60, taskType: 'Revision', priority: 'High' },
                            { title: 'OS Flashcard Drills', subject: 'Operating Systems', topic: 'Virtual Memory Recall', duration: 60, taskType: 'Flashcards', priority: 'Medium' }
                        ]
                    }
                ]
            })
        });

        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(req, res, () => {}, { generateAIContent: mockAI });

        assert.equal(statusCode, 201);
        assert.equal(responseJson.success, true);
        const plan = responseJson.data;

        assert.equal(plan.totalPreparationDays, 2);
        assert.equal(plan.startDateString, '2026-10-09');
        assert.equal(plan.endDateString, '2026-10-10');
        assert.equal(plan.examDateString, '2026-10-11');
        assert.equal(plan.plan.length, 2);
        assert.equal(plan.plan[0].dateString, '2026-10-09');
        assert.equal(plan.plan[1].dateString, '2026-10-10');
    });

    test('2. Exam 6 days away (Bug Fix Verification): Day 1 is 9 Oct, not 14 Oct, with exactly 6 days', async () => {
        const currentDate = '2026-10-09';
        const examDate = '2026-10-15'; // 6 days away

        const req = {
            user: { _id: testUserId },
            body: {
                examName: 'Midterm 2026',
                examDate,
                currentDate,
                subjects: ['Computer Networks', 'Operating Systems'],
                dailyStudyTime: 90
            }
        };

        const mockAI = async () => ({
            text: JSON.stringify({
                plan: [
                    {
                        dayNumber: 1,
                        date: '2026-10-09',
                        tasks: [{ title: 'OS Basics', subject: 'Operating Systems', topic: 'Kernel', duration: 45, taskType: 'Revision', priority: 'High' }]
                    }
                ]
            })
        });

        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(req, res, () => {}, { generateAIContent: mockAI });

        assert.equal(statusCode, 201);
        const plan = responseJson.data;

        // Root cause validation: total prep days MUST be 6, NOT hardcoded 14!
        assert.equal(plan.totalPreparationDays, 6, 'Available preparation period must be 6 days');
        assert.equal(plan.startDateString, '2026-10-09', 'Start date must be current local date (9 Oct 2026)');
        assert.equal(plan.endDateString, '2026-10-14', 'End date must be day before exam (14 Oct 2026)');
        assert.equal(plan.examDateString, '2026-10-15', 'Exam date must be 15 Oct 2026');
        assert.equal(plan.plan.length, 6, 'Must generate exactly 6 preparation days without truncation');
        assert.equal(plan.plan[0].dateString, '2026-10-09', 'Day 1 must be 2026-10-09, NOT 2026-10-14!');
        assert.equal(plan.plan[5].dateString, '2026-10-14', 'Day 6 must be 2026-10-14');
    });

    test('3. Exam 14 days away: generates exactly 14 preparation days', async () => {
        const currentDate = '2026-10-09';
        const examDate = '2026-10-23'; // 14 days away

        const req = {
            user: { _id: testUserId },
            body: {
                examName: 'Two-Week Sprint',
                examDate,
                currentDate,
                subjects: ['Database Management'],
                dailyStudyTime: 120
            }
        };

        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        const mockAI = async () => ({
            text: JSON.stringify({ plan: [] })
        });

        await generateStudyPlan(req, res, () => {}, { generateAIContent: mockAI });

        assert.equal(statusCode, 201);
        const plan = responseJson.data;
        assert.equal(plan.totalPreparationDays, 14);
        assert.equal(plan.startDateString, '2026-10-09');
        assert.equal(plan.endDateString, '2026-10-22');
        assert.equal(plan.plan.length, 14);
    });

    test('4. Exam 30 days away: generates exactly 30 preparation days', async () => {
        const currentDate = '2026-10-09';
        const examDate = '2026-11-08'; // 30 days away

        const req = {
            user: { _id: testUserId },
            body: {
                examName: 'Monthly Comprehensive Exam',
                examDate,
                currentDate,
                subjects: ['Algorithms'],
                dailyStudyTime: 60
            }
        };

        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        const mockAI = async () => ({ text: JSON.stringify({ plan: [] }) });

        await generateStudyPlan(req, res, () => {}, { generateAIContent: mockAI });

        assert.equal(statusCode, 201);
        const plan = responseJson.data;
        assert.equal(plan.totalPreparationDays, 30);
        assert.equal(plan.plan.length, 30);
        assert.equal(plan.plan[0].dateString, '2026-10-09');
        assert.equal(plan.plan[29].dateString, '2026-11-07');
    });

    test('5. Month boundary calculation: correctly spans from October into November', () => {
        const prep = calculatePreparationWindow('2026-11-03', '2026-10-30', false);
        assert.equal(prep.totalPrepDays, 4);
        assert.equal(prep.startDateString, '2026-10-30');
        assert.equal(prep.endDateString, '2026-11-02');
        assert.equal(prep.prepDates[0].dateString, '2026-10-30');
        assert.equal(prep.prepDates[1].dateString, '2026-10-31');
        assert.equal(prep.prepDates[2].dateString, '2026-11-01');
        assert.equal(prep.prepDates[3].dateString, '2026-11-02');
    });

    test('6. Exam date today or in the past returns 400 validation error', async () => {
        const reqToday = {
            user: { _id: testUserId },
            body: {
                examName: 'Today Exam',
                examDate: '2026-10-09',
                currentDate: '2026-10-09',
                subjects: ['Physics']
            }
        };

        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(reqToday, res, () => {});
        assert.equal(statusCode, 400);
        assert.equal(responseJson.success, false);
        assert.match(responseJson.message, /in the future/);

        // Past date test
        const reqPast = {
            user: { _id: testUserId },
            body: {
                examName: 'Past Exam',
                examDate: '2026-10-05',
                currentDate: '2026-10-09',
                subjects: ['Physics']
            }
        };
        await generateStudyPlan(reqPast, res, () => {});
        assert.equal(statusCode, 400);
        assert.match(responseJson.message, /in the future/);
    });

    test('7. Document-grounded study plan: attaches syllabus context and sets isDocumentGrounded', async () => {
        const testDoc = await Document.create({
            userId: testUserId,
            filename: 'syllabus_os.pdf',
            originalName: 'Operating_Systems_Syllabus.pdf',
            fileType: 'pdf',
            fileSize: 1024,
            subject: 'Operating Systems',
            chapter: 'Unit 1: Process Synchronization',
            status: 'INDEXED',
            pineconeNamespace: `user_${testUserId}`,
            chunkCount: 5
        });

        const mockRetriever = async () => [
            {
                id: 'chunk_1',
                score: 0.82,
                documentId: testDoc._id.toString(),
                filename: 'Operating_Systems_Syllabus.pdf',
                text: 'Unit 1 covers Process Synchronization, Critical Section Problem, and Peterson Solution.'
            }
        ];

        let capturedPrompt = '';
        const mockAI = async ({ contents }) => {
            capturedPrompt = contents;
            return {
                text: JSON.stringify({
                    plan: [
                        {
                            dayNumber: 1,
                            date: '2026-10-09',
                            tasks: [
                                { title: 'Deep Dive: Critical Section Problem', subject: 'Operating Systems', topic: 'Peterson Solution', duration: 45, taskType: 'Revision', priority: 'High' }
                            ]
                        }
                    ]
                })
            };
        };

        const req = {
            user: { _id: testUserId },
            body: {
                examName: 'Document Grounded Final',
                examDate: '2026-10-12',
                currentDate: '2026-10-09',
                subjects: ['Operating Systems'],
                dailyStudyTime: 90,
                documentIds: [testDoc._id]
            }
        };

        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(req, res, () => {}, {
            generateAIContent: mockAI,
            retrieveRelevantChunks: mockRetriever
        });

        assert.equal(statusCode, 201);
        const plan = responseJson.data;
        assert.equal(plan.isDocumentGrounded, true);
        assert.match(plan.groundingNotes, /Operating_Systems_Syllabus\.pdf/);
        assert.match(capturedPrompt, /Peterson Solution/);
    });

    test('8. Plan generated without uploaded documents clearly identified as general recommendation', async () => {
        const req = {
            user: { _id: testUserId },
            body: {
                examName: 'No Docs Exam',
                examDate: '2026-10-12',
                currentDate: '2026-10-09',
                subjects: ['World History'],
                dailyStudyTime: 60
            }
        };

        let capturedPrompt = '';
        const mockAI = async ({ contents }) => {
            capturedPrompt = contents;
            return {
                text: JSON.stringify({
                    plan: [
                        {
                            dayNumber: 1,
                            date: '2026-10-09',
                            tasks: [
                                { title: 'Industrial Revolution', subject: 'World History', topic: 'Technological Shift', duration: 60, taskType: 'Revision', priority: 'High' }
                            ]
                        }
                    ]
                })
            };
        };

        let statusCode = 200;
        let responseJson = null;
        const res = {
            status: (code) => { statusCode = code; return res; },
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(req, res, () => {}, { generateAIContent: mockAI });

        assert.equal(statusCode, 201);
        const plan = responseJson.data;
        assert.equal(plan.isDocumentGrounded, false);
        assert.match(plan.groundingNotes, /General curriculum recommendation/);
        assert.match(capturedPrompt, /No course documents attached/);
    });

    test('9. Daily study-hour limit enforcement: scales down excessive AI durations to fit daily limit', async () => {
        const dailyLimitMinutes = 60; // 1 hour max

        const mockAI = async () => ({
            text: JSON.stringify({
                plan: [
                    {
                        dayNumber: 1,
                        date: '2026-10-09',
                        tasks: [
                            { title: 'Excessive Task 1', subject: 'Math', topic: 'Calculus', duration: 120, taskType: 'Revision', priority: 'High' },
                            { title: 'Excessive Task 2', subject: 'Math', topic: 'Algebra', duration: 120, taskType: 'Practice questions', priority: 'High' }
                        ] // Total 240 minutes > 60 minutes limit
                    }
                ]
            })
        });

        const req = {
            user: { _id: testUserId },
            body: {
                examName: 'Strict Time Exam',
                examDate: '2026-10-11',
                currentDate: '2026-10-09',
                subjects: ['Math'],
                dailyStudyTime: dailyLimitMinutes
            }
        };

        let responseJson = null;
        const res = {
            status: () => res,
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(req, res, () => {}, { generateAIContent: mockAI });

        const plan = responseJson.data;
        const day1Tasks = plan.plan[0].tasks;
        const day1TotalDuration = day1Tasks.reduce((acc, t) => acc + t.duration, 0);

        assert(day1TotalDuration <= dailyLimitMinutes, `Day 1 duration (${day1TotalDuration}) must not exceed daily limit (${dailyLimitMinutes})`);
    });

    test('10. Task completion, page refresh, and MongoDB persistence', async () => {
        const plan = await StudyPlan.create({
            userId: testUserId,
            examName: 'Persistence Check',
            examDate: new Date('2026-10-15'),
            examDateString: '2026-10-15',
            startDate: new Date('2026-10-09'),
            startDateString: '2026-10-09',
            endDate: new Date('2026-10-14'),
            endDateString: '2026-10-14',
            totalPreparationDays: 6,
            subjects: ['Physics'],
            dailyStudyTime: 90,
            plan: [
                {
                    day: new Date('2026-10-09'),
                    dayNumber: 1,
                    dateString: '2026-10-09',
                    tasks: [
                        { title: 'Thermodynamics Laws', subject: 'Physics', topic: 'Heat Transfer', duration: 45, taskType: 'Revision', isCompleted: false, priority: 'High' }
                    ]
                }
            ]
        });

        // Toggle task to completed
        const req = {
            user: { _id: testUserId },
            params: { id: plan._id },
            body: { dayIndex: 0, taskIndex: 0, isCompleted: true }
        };

        let responseJson = null;
        const res = { json: (data) => { responseJson = data; } };
        await updateStudyPlan(req, res, () => {});

        assert.equal(responseJson.success, true);

        // Verify persisted state in MongoDB (simulating page reload)
        const refreshedPlan = await StudyPlan.findById(plan._id);
        assert.equal(refreshedPlan.plan[0].tasks[0].isCompleted, true);

        // Verify StudySession was logged
        await new Promise(r => setTimeout(r, 100));
        const session = await StudySession.findOne({ userId: testUserId, topic: 'Heat Transfer' });
        assert(session, 'StudySession must be created for real progress tracking');
    });

    test('11. Creating multiple independent plans preserves each plan separately', async () => {
        const planA = await StudyPlan.create({
            userId: testUserId,
            examName: 'Plan A Chemistry',
            examDate: new Date('2026-10-20'),
            examDateString: '2026-10-20',
            startDate: new Date('2026-10-09'),
            startDateString: '2026-10-09',
            endDate: new Date('2026-10-19'),
            endDateString: '2026-10-19',
            totalPreparationDays: 11,
            subjects: ['Chemistry'],
            dailyStudyTime: 60,
            plan: []
        });

        const planB = await StudyPlan.create({
            userId: testUserId,
            examName: 'Plan B Biology',
            examDate: new Date('2026-10-25'),
            examDateString: '2026-10-25',
            startDate: new Date('2026-10-09'),
            startDateString: '2026-10-09',
            endDate: new Date('2026-10-24'),
            endDateString: '2026-10-24',
            totalPreparationDays: 16,
            subjects: ['Biology'],
            dailyStudyTime: 90,
            plan: []
        });

        const req = { user: { _id: testUserId } };
        let responseJson = null;
        const res = { json: (data) => { responseJson = data; } };

        await getStudyPlans(req, res, () => {});

        assert.equal(responseJson.success, true);
        const plans = responseJson.data;
        const foundA = plans.find(p => p._id.toString() === planA._id.toString());
        const foundB = plans.find(p => p._id.toString() === planB._id.toString());

        assert(foundA, 'Plan A must be retrieved');
        assert(foundB, 'Plan B must be retrieved');
        assert.equal(foundA.examName, 'Plan A Chemistry');
        assert.equal(foundB.examName, 'Plan B Biology');
    });

    test('12. Reopening an existing plan preserves original dates without shifting', async () => {
        const originalPlan = await StudyPlan.create({
            userId: testUserId,
            examName: 'Date Preservation Exam',
            examDate: new Date('2026-10-15'),
            examDateString: '2026-10-15',
            startDate: new Date('2026-10-09'),
            startDateString: '2026-10-09',
            endDate: new Date('2026-10-14'),
            endDateString: '2026-10-14',
            totalPreparationDays: 6,
            subjects: ['Computer Architecture'],
            dailyStudyTime: 120,
            plan: [
                {
                    day: new Date('2026-10-09'),
                    dayNumber: 1,
                    dateString: '2026-10-09',
                    tasks: [
                        { title: 'Pipeline Hazards', subject: 'Computer Architecture', topic: 'Branch Prediction', duration: 60, taskType: 'Revision', isCompleted: true, priority: 'High' }
                    ]
                },
                {
                    day: new Date('2026-10-14'),
                    dayNumber: 6,
                    dateString: '2026-10-14',
                    tasks: [
                        { title: 'Final Architecture Review', subject: 'Computer Architecture', topic: 'Cache Coherence', duration: 60, taskType: 'Revision', isCompleted: false, priority: 'High' }
                    ]
                }
            ]
        });

        const req = {
            user: { _id: testUserId },
            params: { id: originalPlan._id }
        };
        let responseJson = null;
        const res = { json: (data) => { responseJson = data; } };

        await getStudyPlanById(req, res, () => {});

        assert.equal(responseJson.success, true);
        const retrieved = responseJson.data;

        // Ensure dates have NOT shifted by 1 second or 1 day
        assert.equal(retrieved.examDateString, '2026-10-15');
        assert.equal(retrieved.startDateString, '2026-10-09');
        assert.equal(retrieved.endDateString, '2026-10-14');
        assert.equal(retrieved.plan[0].dateString, '2026-10-09');
        assert.equal(retrieved.plan[1].dateString, '2026-10-14');
        assert.equal(retrieved.plan[0].tasks[0].isCompleted, true);
    });

    test('13. Bug Case Verification: 9 Oct to 15 Oct exam with 3 hours/day yields exactly 6 preparation days, Day 1 = 9 Oct to Day 6 = 14 Oct, ~180 mins per day, and no tasks on/after 15 Oct', async () => {
        const currentDate = '2026-10-09';
        const examDate = '2026-10-15';
        
        const req = {
            user: { _id: testUserId },
            body: {
                examName: 'Midterm Oct 15 Verification Exam',
                examDate,
                currentDate,
                subjects: ['Data Structures', 'Algorithms'],
                dailyStudyTime: 180 // 3 hours per day
            }
        };

        // Mock AI generator responding with balanced tasks for 6 days
        const mockAI = async () => ({
            text: JSON.stringify({
                plan: [
                    {
                        dayNumber: 1,
                        date: '2026-10-09',
                        tasks: [
                            { title: 'Data Structures - Binary Trees & Heaps', subject: 'Data Structures', topic: 'Binary Trees', duration: 90, taskType: 'Revision', priority: 'High' },
                            { title: 'Algorithms - Tree Traversal Drills', subject: 'Algorithms', topic: 'DFS & BFS', duration: 90, taskType: 'Practice questions', priority: 'High' }
                        ]
                    },
                    {
                        dayNumber: 2,
                        date: '2026-10-10',
                        tasks: [
                            { title: 'Data Structures - Graphs Representation', subject: 'Data Structures', topic: 'Adjacency Lists', duration: 90, taskType: 'Revision', priority: 'High' },
                            { title: 'Algorithms - Dijkstra Algorithm Practice', subject: 'Algorithms', topic: 'Shortest Path', duration: 90, taskType: 'Practice questions', priority: 'High' }
                        ]
                    },
                    {
                        dayNumber: 3,
                        date: '2026-10-11',
                        tasks: [
                            { title: 'Algorithms - Dynamic Programming Fundamentals', subject: 'Algorithms', topic: 'Memoization', duration: 90, taskType: 'Revision', priority: 'High' },
                            { title: 'Algorithms - DP Problem Solving', subject: 'Algorithms', topic: '0/1 Knapsack', duration: 90, taskType: 'Practice questions', priority: 'High' }
                        ]
                    },
                    {
                        dayNumber: 4,
                        date: '2026-10-12',
                        tasks: [
                            { title: 'Data Structures - Hash Tables & Collisions', subject: 'Data Structures', topic: 'Hashing', duration: 90, taskType: 'Revision', priority: 'High' },
                            { title: 'Algorithms - Greedy Algorithms Drills', subject: 'Algorithms', topic: 'Activity Selection', duration: 90, taskType: 'Practice questions', priority: 'High' }
                        ]
                    },
                    {
                        dayNumber: 5,
                        date: '2026-10-13',
                        tasks: [
                            { title: 'Data Structures & Algorithms - Spaced Retrieval', subject: 'Data Structures', topic: 'Complexities', duration: 90, taskType: 'Revision', priority: 'High' },
                            { title: 'Algorithms - Timed Practice Exam', subject: 'Algorithms', topic: 'Mock Test', duration: 90, taskType: 'Practice questions', priority: 'High' }
                        ]
                    },
                    {
                        dayNumber: 6,
                        date: '2026-10-14',
                        tasks: [
                            { title: 'Final High-Yield Review & Formula Sheet', subject: 'Data Structures', topic: 'Summary', duration: 90, taskType: 'Revision', priority: 'High' },
                            { title: 'Mock Exam Review & Error Correction', subject: 'Algorithms', topic: 'Final Exam Readiness', duration: 90, taskType: 'Revision', priority: 'High' }
                        ]
                    }
                ]
            })
        });

        let responseJson = null;
        let responseStatus = 200;
        const res = {
            status: (s) => { responseStatus = s; return res; },
            json: (data) => { responseJson = data; }
        };

        await generateStudyPlan(req, res, () => {}, { generateAIContent: mockAI });

        assert.equal(responseStatus, 201);
        assert.equal(responseJson.success, true);
        const plan = responseJson.data;

        // 1. Exactly 6 preparation days
        assert.equal(plan.totalPreparationDays, 6, 'Must have exactly 6 preparation days');
        assert.equal(plan.startDateString, '2026-10-09', 'Start date must be 2026-10-09');
        assert.equal(plan.endDateString, '2026-10-14', 'End date must be 2026-10-14');
        assert.equal(plan.examDateString, '2026-10-15', 'Exam date must be 2026-10-15');
        assert.equal(plan.plan.length, 6, 'Schedule must contain exactly 6 days');

        // 2. Correct day numbering and date assignment
        const expectedDates = [
            '2026-10-09',
            '2026-10-10',
            '2026-10-11',
            '2026-10-12',
            '2026-10-13',
            '2026-10-14'
        ];

        expectedDates.forEach((expectedDate, idx) => {
            const dayEntry = plan.plan[idx];
            assert.equal(dayEntry.dayNumber, idx + 1, `Day number must be ${idx + 1}`);
            assert.equal(dayEntry.dateString, expectedDate, `Day ${idx + 1} date must be ${expectedDate}`);
            assert(Array.isArray(dayEntry.tasks) && dayEntry.tasks.length > 0, `Day ${idx + 1} must have tasks`);

            // 3. Workload per day: ~180 mins and does not exceed 180
            const dayMinutes = dayEntry.tasks.reduce((sum, t) => sum + t.duration, 0);
            assert(dayMinutes <= 180, `Day ${idx + 1} total minutes (${dayMinutes}) must not exceed 180 mins`);
            assert(dayMinutes >= 150, `Day ${idx + 1} total minutes (${dayMinutes}) must be realistically close to 180 mins`);

            // 4. Verify no tasks are on or after the exam date
            assert(dayEntry.dateString < '2026-10-15', `Day ${idx + 1} date must be strictly before exam date`);
            dayEntry.tasks.forEach(t => {
                const taskDateStr = formatDateOnly(parseDateOnly(t.scheduledDate));
                assert(taskDateStr < '2026-10-15', 'Task scheduled date must be strictly before exam date');
            });
        });
    });

    test('14. Safe regeneration expands single-day legacy plan across all 6 days without deleting data', async () => {
        // Create an incomplete legacy plan (e.g. only 1 day generated due to prior bug)
        const legacyPlan = await StudyPlan.create({
            userId: testUserId,
            examName: 'Legacy Single-Day Incomplete Plan',
            examDate: new Date('2026-10-15'),
            examDateString: '2026-10-15',
            startDate: new Date('2026-10-09'),
            startDateString: '2026-10-09',
            endDate: new Date('2026-10-14'),
            endDateString: '2026-10-14',
            totalPreparationDays: 6,
            subjects: ['Physics'],
            dailyStudyTime: 180,
            plan: [
                {
                    day: new Date('2026-10-14'),
                    dayNumber: 1,
                    dateString: '2026-10-14',
                    tasks: [
                        { title: 'Physics Rush Task 1', subject: 'Physics', topic: 'Thermodynamics', duration: 90, taskType: 'Revision', isCompleted: false },
                        { title: 'Physics Rush Task 2', subject: 'Physics', topic: 'Optics', duration: 90, taskType: 'Practice questions', isCompleted: false }
                    ]
                }
            ]
        });

        // Also create a separate user plan to ensure it is NOT affected
        const otherPlan = await StudyPlan.create({
            userId: testUserId,
            examName: 'Unrelated Plan',
            examDate: new Date('2026-10-20'),
            examDateString: '2026-10-20',
            dailyStudyTime: 120,
            plan: []
        });

        const req = {
            user: { _id: testUserId },
            params: { id: legacyPlan._id.toString() },
            body: {}
        };
        let responseJson = null;
        const res = { json: (data) => { responseJson = data; } };

        await regenerateStudyPlan(req, res, () => {});

        assert.equal(responseJson.success, true);
        const regenerated = responseJson.data;

        // Verify expansion across all 6 days
        assert.equal(regenerated.totalPreparationDays, 6);
        assert.equal(regenerated.plan.length, 6, 'Regenerated plan must span all 6 days');
        assert.equal(regenerated.plan[0].dateString, '2026-10-09');
        assert.equal(regenerated.plan[5].dateString, '2026-10-14');

        // Verify daily workload ~180 mins
        regenerated.plan.forEach((day, idx) => {
            const minutes = day.tasks.reduce((sum, t) => sum + t.duration, 0);
            assert(minutes <= 180, `Day ${idx + 1} must not exceed 180 mins`);
            assert(minutes >= 120, `Day ${idx + 1} must have balanced study workload`);
        });

        // Verify unrelated plan is intact
        const fetchedOther = await StudyPlan.findById(otherPlan._id);
        assert.equal(fetchedOther.examName, 'Unrelated Plan');
    });

    test('15. Dynamic preparation window calculations for 2-day, 14-day, 30-day, and month boundary windows', () => {
        const currentDate = '2026-10-09';

        // 2-day window: exam on 11 Oct -> prep days 9 Oct, 10 Oct
        const win2 = calculatePreparationWindow('2026-10-11', currentDate, false);
        assert.equal(win2.totalPrepDays, 2);
        assert.equal(win2.startDateString, '2026-10-09');
        assert.equal(win2.endDateString, '2026-10-10');
        assert.equal(win2.prepDates.length, 2);
        assert.equal(win2.prepDates[0].dateString, '2026-10-09');
        assert.equal(win2.prepDates[1].dateString, '2026-10-10');

        // 6-day window: exam on 15 Oct -> prep days 9 Oct to 14 Oct
        const win6 = calculatePreparationWindow('2026-10-15', currentDate, false);
        assert.equal(win6.totalPrepDays, 6);
        assert.equal(win6.startDateString, '2026-10-09');
        assert.equal(win6.endDateString, '2026-10-14');
        assert.equal(win6.prepDates.length, 6);
        assert.equal(win6.prepDates[0].dateString, '2026-10-09');
        assert.equal(win6.prepDates[5].dateString, '2026-10-14');

        // 14-day window: exam on 23 Oct -> prep days 9 Oct to 22 Oct
        const win14 = calculatePreparationWindow('2026-10-23', currentDate, false);
        assert.equal(win14.totalPrepDays, 14);
        assert.equal(win14.startDateString, '2026-10-09');
        assert.equal(win14.endDateString, '2026-10-22');
        assert.equal(win14.prepDates.length, 14);
        assert.equal(win14.prepDates[13].dateString, '2026-10-22');

        // 30-day window: exam on 8 Nov -> prep days 9 Oct to 7 Nov (October has 31 days)
        // 9 to 31 Oct = 23 days; 1 to 7 Nov = 7 days => 23 + 7 = 30 days
        const win30 = calculatePreparationWindow('2026-11-08', currentDate, false);
        assert.equal(win30.totalPrepDays, 30);
        assert.equal(win30.startDateString, '2026-10-09');
        assert.equal(win30.endDateString, '2026-11-07');
        assert.equal(win30.prepDates.length, 30);
        assert.equal(win30.prepDates[29].dateString, '2026-11-07');

        // Month boundary window: 28 Oct to 5 Nov (exam on 5 Nov -> prep days 28 Oct to 4 Nov = 8 days)
        const winBoundary = calculatePreparationWindow('2026-11-05', '2026-10-28', false);
        assert.equal(winBoundary.totalPrepDays, 8);
        assert.equal(winBoundary.startDateString, '2026-10-28');
        assert.equal(winBoundary.endDateString, '2026-11-04');
        assert.equal(winBoundary.prepDates.length, 8);
        assert.equal(winBoundary.prepDates[0].dateString, '2026-10-28');
        assert.equal(winBoundary.prepDates[7].dateString, '2026-11-04');
    });
});

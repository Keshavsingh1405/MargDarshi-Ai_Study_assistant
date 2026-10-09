import StudyPlan from '../models/StudyPlan.js';
import Progress from '../models/Progress.js';
import StudySession from '../models/StudySession.js';
import Document from '../models/Document.js';
import { generateAIContent } from '../services/ai/aiService.js';
import { retrieveRelevantChunks } from '../services/rag/retrievalService.js';
import { PLANNER_PROMPT } from '../prompts/plannerPrompt.js';
import { calculatePreparationWindow, formatDateOnly, parseDateOnly } from '../utils/dateUtils.js';

const VALID_TASK_TYPES = ['Revision', 'Practice questions', 'Flashcards', 'Quizzes', 'Mock tests'];
const VALID_PRIORITIES = ['High', 'Medium', 'Low'];

const normalizeTaskType = (rawType) => {
    if (!rawType || typeof rawType !== 'string') return 'Revision';
    const t = rawType.trim().toLowerCase();
    if (t.includes('quiz')) return 'Quizzes';
    if (t.includes('flash')) return 'Flashcards';
    if (t.includes('mock') || t.includes('test') || t.includes('exam')) return 'Mock tests';
    if (t.includes('pract') || t.includes('question') || t.includes('problem') || t.includes('solv')) return 'Practice questions';
    if (t.includes('revis') || t.includes('read') || t.includes('study') || t.includes('review') || t.includes('concept')) return 'Revision';
    return 'Revision';
};

const normalizePriority = (rawPriority) => {
    if (!rawPriority || typeof rawPriority !== 'string') return 'Medium';
    const p = rawPriority.trim().toLowerCase();
    if (p.includes('high') || p.includes('urgent') || p.includes('crit')) return 'High';
    if (p.includes('low')) return 'Low';
    return 'Medium';
};

/**
 * Generate balanced fallback tasks for a single day up to the target study minutes.
 */
function generateBalancedDayTasks(subject, studyMinutes, curDate, dayNumber, totalDays) {
    if (studyMinutes >= 180) {
        // 3 hours: 3 tasks of 60 mins each
        const isFinalDay = dayNumber === totalDays;
        const isPenultimate = dayNumber === totalDays - 1 && totalDays > 2;

        return [
            {
                title: `${subject} - Deep Dive: Core Concepts & Principles`,
                subject,
                topic: 'Foundations & Architectural Principles',
                duration: 60,
                taskType: 'Revision',
                priority: 'High',
                isCompleted: false,
                scheduledDate: curDate
            },
            {
                title: `${subject} - Intensive Problem Solving & Exercises`,
                subject,
                topic: 'Practical Application & Problem Solving',
                duration: 60,
                taskType: 'Practice questions',
                priority: 'High',
                isCompleted: false,
                scheduledDate: curDate
            },
            {
                title: isFinalDay 
                    ? `${subject} - Final High-Yield Formula & Concept Review`
                    : (isPenultimate 
                        ? `${subject} - Timed Drill & Mock Assessment`
                        : `${subject} - Spaced Retrieval & Flashcard Recall`),
                subject,
                topic: isFinalDay ? 'Exam Readiness & Rapid Review' : (isPenultimate ? 'Simulation & Mock Exam' : 'Key Definitions & Formulas'),
                duration: 60,
                taskType: isFinalDay ? 'Revision' : (isPenultimate ? 'Mock tests' : 'Flashcards'),
                priority: isFinalDay ? 'High' : 'Medium',
                isCompleted: false,
                scheduledDate: curDate
            }
        ];
    } else if (studyMinutes >= 120) {
        // 2 hours: 2 tasks of 60 mins each
        const isFinalDay = dayNumber === totalDays;
        return [
            {
                title: `${subject} - Core Theory & Deep Understanding`,
                subject,
                topic: 'Key Concepts & Frameworks',
                duration: 60,
                taskType: 'Revision',
                priority: 'High',
                isCompleted: false,
                scheduledDate: curDate
            },
            {
                title: isFinalDay 
                    ? `${subject} - Final Review & High-Yield Practice`
                    : `${subject} - Targeted Practice & Problem Drills`,
                subject,
                topic: isFinalDay ? 'Final Exam Readiness' : 'Problem Solving',
                duration: 60,
                taskType: isFinalDay ? 'Revision' : 'Practice questions',
                priority: 'High',
                isCompleted: false,
                scheduledDate: curDate
            }
        ];
    } else {
        // Shorter durations (e.g. 60 or 90 mins)
        const half = Math.round(studyMinutes / 2);
        return [
            {
                title: `${subject} - Key Concepts & Fundamentals`,
                subject,
                topic: 'Core Theory & Concepts',
                taskType: 'Revision',
                duration: half,
                priority: 'High',
                isCompleted: false,
                scheduledDate: curDate
            },
            {
                title: `${subject} - Practice Problems & Drills`,
                subject,
                topic: 'Problem Solving & Application',
                taskType: 'Practice questions',
                duration: studyMinutes - half,
                priority: 'Medium',
                isCompleted: false,
                scheduledDate: curDate
            }
        ];
    }
}

/**
 * Normalizes legacy or inconsistent saved plans so their dates and task schedules are always valid.
 */
export async function normalizeAndRepairPlan(plan) {
    if (!plan) return plan;
    let needsSave = false;

    // 1. Ensure examDateString is set
    if (!plan.examDateString && plan.examDate) {
        plan.examDateString = formatDateOnly(parseDateOnly(plan.examDate));
        needsSave = true;
    }

    // 2. Ensure startDate and endDate are set
    if (!plan.startDateString || !plan.endDateString || !plan.totalPreparationDays) {
        try {
            const windowStart = plan.createdAt ? parseDateOnly(plan.createdAt) : parseDateOnly(new Date());
            const prepWindow = calculatePreparationWindow(plan.examDate, windowStart, Boolean(plan.includeExamDay));
            plan.startDate = prepWindow.startDate;
            plan.startDateString = prepWindow.startDateString;
            plan.endDate = prepWindow.endDate;
            plan.endDateString = prepWindow.endDateString;
            plan.totalPreparationDays = prepWindow.totalPrepDays;
            needsSave = true;
        } catch (e) {
            console.warn('[Planner] Could not recalculate legacy prep window:', e.message);
        }
    }

    // 3. Ensure each existing day has dayNumber, dateString, and task.scheduledDate aligned with its saved day
    if (Array.isArray(plan.plan)) {
        plan.plan.forEach((d, i) => {
            if (!d.dayNumber) {
                d.dayNumber = i + 1;
                needsSave = true;
            }
            if (!d.dateString && d.day) {
                d.dateString = formatDateOnly(parseDateOnly(d.day));
                needsSave = true;
            }
            if (Array.isArray(d.tasks)) {
                d.tasks.forEach(t => {
                    if (!t.priority) {
                        t.priority = 'Medium';
                        needsSave = true;
                    }
                    if (!t.scheduledDate && d.day) {
                        t.scheduledDate = d.day;
                        needsSave = true;
                    }
                });
            }
        });
    }

    if (needsSave && typeof plan.save === 'function') {
        try {
            await plan.save();
        } catch (saveErr) {
            console.warn('[Planner] Auto-repair save warning:', saveErr.message);
        }
    }
    return plan;
}

export const generateStudyPlan = async (req, res, next, services = {}) => {
    try {
        const { examName, examDate, currentDate, includeExamDay, subjects, dailyStudyTime, documentIds } = req.body;
        const aiGenerator = services.generateAIContent || generateAIContent;
        const retriever = services.retrieveRelevantChunks || retrieveRelevantChunks;

        const cleanExamName = (examName || '').trim();
        if (!cleanExamName) {
            return res.status(400).json({
                success: false,
                message: 'Exam name is required.'
            });
        }

        if (!examDate) {
            return res.status(400).json({
                success: false,
                message: 'Exam date is required.'
            });
        }

        // Validate preparation window and calculate exact calendar dates
        let prepWindow;
        try {
            prepWindow = calculatePreparationWindow(examDate, currentDate, Boolean(includeExamDay));
        } catch (dateErr) {
            return res.status(400).json({
                success: false,
                message: dateErr.message || 'Please provide a valid exam date.'
            });
        }

        const subjectsArray = Array.isArray(subjects) 
            ? subjects.map(s => String(s).trim()).filter(Boolean)
            : (typeof subjects === 'string' ? subjects.split(',').map(s => s.trim()).filter(Boolean) : []);

        if (subjectsArray.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one subject is required.'
            });
        }

        let studyMinutes = Number(dailyStudyTime) > 0 ? Number(dailyStudyTime) : 120;
        // If passed as hours (e.g. 1.5, 2, 3, 4), convert to minutes
        if (studyMinutes <= 12) {
            studyMinutes = Math.round(studyMinutes * 60);
        }

        // Prevent duplicate creation within a short retry window (15s)
        const recentDuplicate = await StudyPlan.findOne({
            userId: req.user._id,
            examName: cleanExamName,
            examDateString: prepWindow.examDateString,
            createdAt: { $gte: new Date(Date.now() - 15000) }
        });
        if (recentDuplicate) {
            return res.status(200).json({
                success: true,
                message: 'Existing study plan retrieved.',
                data: recentDuplicate
            });
        }

        // Fetch weak topics from user's progress history
        let weakTopics = 'None';
        try {
            const progress = await Progress.findOne({ userId: req.user._id });
            if (progress && Array.isArray(progress.weakTopics) && progress.weakTopics.length > 0) {
                weakTopics = progress.weakTopics.join(', ');
            }
        } catch (e) {
            console.warn('[Planner] Could not retrieve user progress weak topics:', e.message);
        }

        // Check for course documents grounding
        let groundedDocIds = [];
        let isDocumentGrounded = false;
        let groundingNotes = 'General curriculum recommendation. No course documents were attached.';
        let documentContext = 'No course documents attached. Generate a standard curriculum-based study schedule for the subjects.';

        try {
            let candidateDocs = [];
            if (Array.isArray(documentIds) && documentIds.length > 0) {
                candidateDocs = await Document.find({
                    _id: { $in: documentIds },
                    userId: req.user._id,
                    status: 'INDEXED'
                }).lean();
            } else {
                candidateDocs = await Document.find({
                    userId: req.user._id,
                    status: 'INDEXED',
                    subject: { $in: subjectsArray }
                }).lean();
            }

            if (candidateDocs.length > 0) {
                groundedDocIds = candidateDocs.map(d => d._id);
                const namespace = candidateDocs[0].pineconeNamespace || `user_${req.user._id}`;
                const query = `${subjectsArray.join(' ')} syllabus chapters headings key concepts exam preparation`;
                
                const targetDocIdStrings = candidateDocs.map(d => d._id.toString());
                const chunks = await retriever(query, namespace, 8, null, targetDocIdStrings);

                if (chunks && chunks.length > 0) {
                    isDocumentGrounded = true;
                    const docNames = [...new Set(candidateDocs.map(d => d.originalName || d.filename))];
                    groundingNotes = `Grounded in ${candidateDocs.length} course material(s): ${docNames.join(', ')}`;
                    
                    const extractedSummaries = chunks
                        .filter(c => c && c.text)
                        .slice(0, 6)
                        .map((c, idx) => `[Source Chunk ${idx + 1} - ${c.filename || 'Material'}]: ${c.text.slice(0, 300).trim()}...`)
                        .join('\n\n');

                    documentContext = `STUDENT'S UPLOADED COURSE MATERIALS:\nDocuments: ${docNames.join(', ')}\n\nExtracted Syllabus and Topic Highlights:\n${extractedSummaries}\n\nStrict Rule: You must extract and assign chapters, definitions, and topics directly from the above content.`;
                } else {
                    groundingNotes = `Attached documents (${candidateDocs.length}) have no indexable text yet. Schedule is based on standard recommendations.`;
                }
            }
        } catch (docErr) {
            console.warn('[Planner] Document retrieval error, falling back to standard curriculum:', docErr.message);
            groundingNotes = 'Document search unavailable. Schedule is based on standard curriculum recommendations.';
        }

        const datesListString = JSON.stringify(prepWindow.prepDates.map(p => p.dateString));

        const prompt = PLANNER_PROMPT
            .replace('{examName}', cleanExamName)
            .replace('{examDate}', prepWindow.examDateString)
            .replace('{startDate}', prepWindow.startDateString)
            .replace('{endDate}', prepWindow.endDateString)
            .replace('{totalDays}', String(prepWindow.totalPrepDays))
            .replace('{datesList}', datesListString)
            .replace('{subjects}', subjectsArray.join(', '))
            .replace('{dailyTime}', String(studyMinutes))
            .replace('{weakTopics}', weakTopics)
            .replace('{documentContext}', documentContext);

        let response;
        try {
            response = await aiGenerator({
                contents: prompt,
                config: {
                    responseMimeType: "application/json"
                }
            });
        } catch (aiErr) {
            console.error('[Planner Controller] AI plan generation failed:', aiErr);
            const status = aiErr.status || 503;
            return res.status(status).json({
                success: false,
                message: aiErr.message || 'AI service is temporarily unavailable. Please try again.'
            });
        }

        if (!response || !response.text) {
            return res.status(503).json({
                success: false,
                message: 'AI service returned empty response. Plan creation aborted.'
            });
        }
        
        let planData;
        try {
            planData = JSON.parse(response.text);
        } catch (e) {
            const cleaned = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
            planData = JSON.parse(cleaned);
        }

        const rawDays = Array.isArray(planData?.plan) ? planData.plan : (Array.isArray(planData) ? planData : []);
        
        // Strict Schedule Normalization against Calculated Preparation Dates
        let totalPlannedMinutes = 0;

        const sanitizedPlan = prepWindow.prepDates.map((prepDay, dayIdx) => {
            // Find corresponding day from AI output (by dateString, dayNumber, or index)
            const matchedAiDay = rawDays.find(d => {
                if (!d) return false;
                const dDateStr = d.date || (d.day ? formatDateOnly(parseDateOnly(d.day)) : null);
                if (dDateStr === prepDay.dateString) return true;
                if (Number(d.dayNumber) === prepDay.dayNumber) return true;
                return false;
            }) || rawDays[dayIdx];

            let tasks = Array.isArray(matchedAiDay?.tasks) && matchedAiDay.tasks.length > 0 
                ? matchedAiDay.tasks 
                : [];

            // Fallback: If AI returned no tasks for this preparation day, generate balanced fallback tasks up to studyMinutes
            if (tasks.length === 0) {
                const sub = subjectsArray[dayIdx % subjectsArray.length] || 'General';
                tasks = generateBalancedDayTasks(sub, studyMinutes, prepDay.date, prepDay.dayNumber, prepWindow.totalPrepDays);
            }

            // Normalize each task
            let dayTasks = tasks.map((t, tIdx) => {
                const subject = (t.subject || subjectsArray[tIdx % subjectsArray.length] || 'General').trim();
                const topic = (t.topic || 'Important Definitions and Concepts').trim();
                const title = (t.title && typeof t.title === 'string' && t.title.trim())
                    ? t.title.trim()
                    : `${subject}: ${topic}`;
                const rawDur = Number(t.duration);
                const duration = rawDur > 0 ? rawDur : Math.max(15, Math.round(studyMinutes / tasks.length));

                return {
                    title,
                    subject,
                    topic,
                    duration,
                    taskType: normalizeTaskType(t.taskType),
                    priority: normalizePriority(t.priority),
                    isCompleted: Boolean(t.isCompleted),
                    scheduledDate: prepDay.date
                };
            });

            // Enforce Daily Available Study Hours Limit
            const dailyTotal = dayTasks.reduce((acc, task) => acc + task.duration, 0);
            if (dailyTotal > studyMinutes && dailyTotal > 0) {
                const scale = studyMinutes / dailyTotal;
                let allocated = 0;
                dayTasks = dayTasks.map((task, idx) => {
                    if (idx === dayTasks.length - 1) {
                        task.duration = Math.max(15, studyMinutes - allocated);
                    } else {
                        task.duration = Math.max(15, Math.round(task.duration * scale));
                        allocated += task.duration;
                    }
                    return task;
                });
            }

            const dayMinutes = dayTasks.reduce((acc, t) => acc + t.duration, 0);
            totalPlannedMinutes += dayMinutes;

            return {
                day: prepDay.date,
                dayNumber: prepDay.dayNumber,
                dateString: prepDay.dateString,
                tasks: dayTasks
            };
        });

        const studyPlan = await StudyPlan.create({
            userId: req.user._id,
            examName: cleanExamName,
            examDate: prepWindow.examDate,
            examDateString: prepWindow.examDateString,
            startDate: prepWindow.startDate,
            startDateString: prepWindow.startDateString,
            endDate: prepWindow.endDate,
            endDateString: prepWindow.endDateString,
            totalPreparationDays: prepWindow.totalPrepDays,
            totalPlannedMinutes,
            includeExamDay: prepWindow.includeExamDay,
            subjects: subjectsArray,
            selectedDocumentIds: groundedDocIds,
            isDocumentGrounded,
            groundingNotes,
            dailyStudyTime: studyMinutes,
            plan: sanitizedPlan
        });

        res.status(201).json({ success: true, data: studyPlan });
    } catch (error) {
        next(error);
    }
};

export const getStudyPlans = async (req, res, next) => {
    try {
        const rawPlans = await StudyPlan.find({ userId: req.user._id }).sort({ createdAt: -1 });
        const plans = [];
        for (const p of rawPlans) {
            const repaired = await normalizeAndRepairPlan(p);
            plans.push(repaired);
        }
        res.json({ success: true, data: plans });
    } catch (error) {
        next(error);
    }
};

export const getStudyPlanById = async (req, res, next) => {
    try {
        const plan = await StudyPlan.findOne({ _id: req.params.id, userId: req.user._id });
        if (!plan) {
            return res.status(404).json({ success: false, message: 'Study plan not found' });
        }
        const repaired = await normalizeAndRepairPlan(plan);
        res.json({ success: true, data: repaired });
    } catch (error) {
        next(error);
    }
};

export const regenerateStudyPlan = async (req, res, next, services = {}) => {
    try {
        const existingPlan = await StudyPlan.findOne({ _id: req.params.id, userId: req.user._id });
        if (!existingPlan) {
            return res.status(404).json({ success: false, message: 'Study plan not found' });
        }

        const currentDate = req.body.currentDate || formatDateOnly(new Date());
        const prepWindow = calculatePreparationWindow(existingPlan.examDate, currentDate, Boolean(existingPlan.includeExamDay));

        const studyMinutes = Number(existingPlan.dailyStudyTime) > 0 ? Number(existingPlan.dailyStudyTime) : 120;
        const subjectsArray = existingPlan.subjects && existingPlan.subjects.length > 0 ? existingPlan.subjects : ['General'];

        let totalPlannedMinutes = 0;
        const newPlan = prepWindow.prepDates.map((prepDay, dayIdx) => {
            const daySubject = subjectsArray[dayIdx % subjectsArray.length] || 'General';
            const dayTasks = generateBalancedDayTasks(daySubject, studyMinutes, prepDay.date, prepDay.dayNumber, prepWindow.totalPrepDays);
            const dayMinutes = dayTasks.reduce((acc, t) => acc + t.duration, 0);
            totalPlannedMinutes += dayMinutes;

            return {
                day: prepDay.date,
                dayNumber: prepDay.dayNumber,
                dateString: prepDay.dateString,
                tasks: dayTasks
            };
        });

        existingPlan.startDate = prepWindow.startDate;
        existingPlan.startDateString = prepWindow.startDateString;
        existingPlan.endDate = prepWindow.endDate;
        existingPlan.endDateString = prepWindow.endDateString;
        existingPlan.examDateString = prepWindow.examDateString;
        existingPlan.totalPreparationDays = prepWindow.totalPrepDays;
        existingPlan.totalPlannedMinutes = totalPlannedMinutes;
        existingPlan.plan = newPlan;

        await existingPlan.save();
        res.json({ success: true, message: 'Study plan successfully regenerated', data: existingPlan });
    } catch (error) {
        next(error);
    }
};

export const updateStudyPlan = async (req, res, next) => {
    try {
        const { dayIndex, taskIndex, isCompleted } = req.body;
        const plan = await StudyPlan.findOne({ _id: req.params.id, userId: req.user._id });
        
        if (!plan) {
            res.status(404);
            throw new Error('Study plan not found');
        }

        if (plan.plan[dayIndex] && plan.plan[dayIndex].tasks[taskIndex]) {
            const task = plan.plan[dayIndex].tasks[taskIndex];
            task.isCompleted = isCompleted;
            await plan.save();

            if (isCompleted && task.duration > 0) {
                StudySession.create({
                    userId: req.user._id,
                    subject: task.subject || 'General',
                    topic: task.topic || task.title,
                    duration: task.duration,
                    activityType: 'Study Plan',
                    notes: `Completed task: ${task.title || task.topic} (${task.taskType || 'Task'})`
                }).catch(err => console.warn('Could not record planner study session:', err.message));
            }
        }

        res.json({ success: true, data: plan });
    } catch (error) {
        next(error);
    }
};

export const deleteStudyPlan = async (req, res, next) => {
    try {
        const plan = await StudyPlan.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!plan) {
            res.status(404);
            throw new Error('Study plan not found');
        }
        res.json({ success: true, message: 'Plan discarded' });
    } catch (error) {
        next(error);
    }
};

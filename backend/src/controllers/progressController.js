import Progress from '../models/Progress.js';
import QuizAttempt from '../models/QuizAttempt.js';
import Quiz from '../models/Quiz.js';
import Flashcard from '../models/Flashcard.js';
import StudyPlan from '../models/StudyPlan.js';
import Document from '../models/Document.js';
import StudySession from '../models/StudySession.js';

export const getProgress = async (req, res, next) => {
    try {
        const userId = req.user._id;

        // 1. Fetch user data in parallel - strictly user-scoped
        const [
            progressDoc,
            quizAttempts,
            allQuizzes,
            allFlashcards,
            allPlans,
            allDocuments,
            studySessions
        ] = await Promise.all([
            Progress.findOne({ userId }),
            QuizAttempt.find({ userId }).populate('quizId', 'title subject topic').sort({ createdAt: -1 }),
            Quiz.find({ userId }).sort({ createdAt: -1 }),
            Flashcard.find({ userId }).sort({ createdAt: -1 }),
            StudyPlan.find({ userId }).sort({ createdAt: -1 }),
            Document.find({ userId }).sort({ createdAt: -1 }),
            StudySession.find({ userId }).sort({ createdAt: -1 })
        ]);

        // 2. Quiz Analytics (ONLY COMPLETED ATTEMPTS COUNT)
        let totalQuizQuestionsAttempted = 0;
        let totalQuizQuestionsCorrect = 0;
        const subjectStats = {}; // subject -> { attempted, correct, count }

        quizAttempts.forEach(attempt => {
            const attempted = attempt.totalQuestions || 0;
            const correct = attempt.score || 0;
            totalQuizQuestionsAttempted += attempted;
            totalQuizQuestionsCorrect += correct;

            const subject = (attempt.quizId && attempt.quizId.subject) ? attempt.quizId.subject : 'General';
            if (!subjectStats[subject]) {
                subjectStats[subject] = { questionsAttempted: 0, questionsCorrect: 0, attemptCount: 0 };
            }
            subjectStats[subject].questionsAttempted += attempted;
            subjectStats[subject].questionsCorrect += correct;
            subjectStats[subject].attemptCount += 1;
        });

        // Exact formula: (total correctly answered questions / total attempted questions) * 100
        const overallAccuracy = totalQuizQuestionsAttempted > 0
            ? Number(((totalQuizQuestionsCorrect / totalQuizQuestionsAttempted) * 100).toFixed(1))
            : 0;

        // Flashcards analytics
        const flashcardsGenerated = allFlashcards.length;
        const flashcardsReviewed = allFlashcards.filter(f => (f.reviewCount || 0) > 0).length;
        const flashcardsMastered = allFlashcards.filter(f => f.status === 'Known').length;

        // Questions / Flashcards completed strictly from actual user activity
        const questionsCompleted = totalQuizQuestionsAttempted + flashcardsReviewed;

        // 3. Study Time Analytics (STRICTLY FROM RECORDED SESSIONS)
        const totalSessionMinutes = studySessions.reduce((sum, s) => sum + (s.duration || 0), 0);
        const totalStudyTimeHours = Number((totalSessionMinutes / 60).toFixed(1));
        const studySessionCount = studySessions.length;

        // 4. Weekly Study Time (Monday to Sunday of current week)
        const now = new Date();
        const currentDayIndex = (now.getDay() + 6) % 7; // Monday = 0, Sunday = 6
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - currentDayIndex);
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        const daysNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const weeklyDays = daysNames.map((name, i) => {
            const dayDate = new Date(startOfWeek);
            dayDate.setDate(startOfWeek.getDate() + i);
            return {
                day: name,
                date: dayDate,
                minutes: 0,
                hours: 0,
                percentage: 0
            };
        });

        let weeklyTotalMinutes = 0;
        studySessions.forEach(s => {
            const sessionDate = new Date(s.createdAt);
            if (sessionDate >= startOfWeek && sessionDate <= endOfWeek) {
                const dayIdx = (sessionDate.getDay() + 6) % 7;
                if (weeklyDays[dayIdx]) {
                    weeklyDays[dayIdx].minutes += (s.duration || 0);
                    weeklyTotalMinutes += (s.duration || 0);
                }
            }
        });

        // Compute percentages and hours for the chart
        const maxMinutes = Math.max(...weeklyDays.map(d => d.minutes), 300); // 5h reference scale
        weeklyDays.forEach(d => {
            d.hours = Number((d.minutes / 60).toFixed(1));
            d.percentage = d.minutes > 0 ? Math.min(100, Math.round((d.minutes / maxMinutes) * 100)) : 0;
        });

        const weeklyTotalHours = Number((weeklyTotalMinutes / 60).toFixed(1));
        const daysWithSessions = weeklyDays.filter(d => d.minutes > 0).length;
        const dailyAverageHours = daysWithSessions > 0
            ? Number((weeklyTotalHours / daysWithSessions).toFixed(1))
            : 0;

        let peakDay = null;
        if (weeklyTotalMinutes > 0) {
            const sortedByMin = [...weeklyDays].sort((a, b) => b.minutes - a.minutes);
            if (sortedByMin[0] && sortedByMin[0].minutes > 0) {
                peakDay = { day: sortedByMin[0].day, hours: sortedByMin[0].hours };
            }
        }

        // 5. Subject Mastery
        const subjectMastery = [];
        const seenSubjects = new Set();

        Object.keys(subjectStats).forEach(sub => {
            seenSubjects.add(sub);
            const stats = subjectStats[sub];
            const accuracy = stats.questionsAttempted > 0
                ? Math.round((stats.questionsCorrect / stats.questionsAttempted) * 100)
                : 0;
            subjectMastery.push({
                subject: sub,
                accuracy,
                questionsAttempted: stats.questionsAttempted,
                questionsCorrect: stats.questionsCorrect,
                attemptCount: stats.attemptCount,
                hasData: true
            });
        });

        // Include subjects from uploaded documents that do not have quiz attempts yet
        allDocuments.forEach(doc => {
            if (doc.subject && !seenSubjects.has(doc.subject) && doc.subject !== 'General') {
                seenSubjects.add(doc.subject);
                subjectMastery.push({
                    subject: doc.subject,
                    accuracy: null,
                    questionsAttempted: 0,
                    questionsCorrect: 0,
                    attemptCount: 0,
                    hasData: false
                });
            }
        });

        // Sort by accuracy descending
        subjectMastery.sort((a, b) => {
            if (a.hasData && !b.hasData) return -1;
            if (!a.hasData && b.hasData) return 1;
            return (b.accuracy || 0) - (a.accuracy || 0);
        });

        // 6. Recent Activity (Real events from MongoDB)
        const recentActivity = [];

        quizAttempts.slice(0, 4).forEach(a => {
            recentActivity.push({
                type: 'quiz',
                title: `Completed Quiz: ${a.quizId ? a.quizId.title : 'Quiz'}`,
                description: `Score: ${a.score}/${a.totalQuestions} • ${a.accuracy.toFixed(0)}% Accuracy`,
                status: a.accuracy >= 70 ? 'Passed' : 'Needs Review',
                timestamp: a.createdAt
            });
        });

        allDocuments.slice(0, 3).forEach(d => {
            recentActivity.push({
                type: 'document',
                title: `Uploaded Document: ${d.originalName}`,
                description: `Subject: ${d.subject} • Status: ${d.status}`,
                status: d.status,
                timestamp: d.createdAt
            });
        });

        allPlans.slice(0, 2).forEach(p => {
            recentActivity.push({
                type: 'plan',
                title: `Created Study Plan: ${p.examName}`,
                description: `Subjects: ${(p.subjects || []).join(', ')}`,
                status: 'Active Plan',
                timestamp: p.createdAt
            });
        });

        studySessions.slice(0, 3).forEach(s => {
            recentActivity.push({
                type: 'session',
                title: `Study Session: ${s.subject || 'General'}`,
                description: `Duration: ${s.duration} mins • Type: ${s.activityType}`,
                status: 'Completed',
                timestamp: s.createdAt
            });
        });

        recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const trimmedRecentActivity = recentActivity.slice(0, 5);

        // 7. Study Goals (from real StudyPlan tasks)
        const studyGoals = [];
        allPlans.forEach(plan => {
            let totalTasks = 0;
            let completedTasks = 0;
            if (Array.isArray(plan.plan)) {
                plan.plan.forEach(day => {
                    if (Array.isArray(day.tasks)) {
                        day.tasks.forEach(t => {
                            totalTasks += 1;
                            if (t.isCompleted) completedTasks += 1;
                        });
                    }
                });
            }
            const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            studyGoals.push({
                id: plan._id,
                title: `${plan.examName} (${(plan.subjects || []).join(', ')})`,
                completed: completedTasks,
                total: totalTasks,
                percentage,
                dueDate: plan.examDate,
                status: percentage === 100 ? 'Completed' : (percentage > 0 ? 'In Progress' : 'Pending')
            });
        });

        // 8. Upcoming Learning (Scheduled or unattempted quizzes)
        const attemptedQuizIds = new Set(
            quizAttempts.map(a => (a.quizId && a.quizId._id ? a.quizId._id.toString() : a.quizId ? a.quizId.toString() : null)).filter(Boolean)
        );
        const upcoming = [];
        allQuizzes.forEach(q => {
            if (!attemptedQuizIds.has(q._id.toString())) {
                upcoming.push({
                    type: 'quiz',
                    title: q.title,
                    subject: q.subject,
                    questionsCount: q.questions ? q.questions.length : 0,
                    scheduledAt: q.createdAt
                });
            }
        });

        // 9. Learning Insights (Strictly from real performance data)
        const insights = [];
        const subjectsWithData = subjectMastery.filter(s => s.hasData);
        if (subjectsWithData.length > 0) {
            const topSub = subjectsWithData[0];
            insights.push({
                type: 'strong',
                title: 'Strongest Subject',
                highlight: `${topSub.subject} (${topSub.accuracy}%)`,
                body: `Demonstrates highest quiz accuracy across ${topSub.questionsAttempted} question(s) completed.`
            });

            if (subjectsWithData.length > 1) {
                const lowSub = subjectsWithData[subjectsWithData.length - 1];
                insights.push({
                    type: 'focus',
                    title: 'Focus Area',
                    highlight: `${lowSub.subject} (${lowSub.accuracy}%)`,
                    body: `Subject with lower accuracy across ${lowSub.questionsAttempted} question(s). Dedicated review is recommended.`
                });
            } else if (progressDoc && progressDoc.weakTopics && progressDoc.weakTopics.length > 0) {
                insights.push({
                    type: 'focus',
                    title: 'Focus Topics',
                    highlight: progressDoc.weakTopics[0],
                    body: `Identified as a weak topic during your quiz attempts. Review your notes to strengthen recall.`
                });
            }
        }

        if (totalStudyTimeHours > 0) {
            insights.push({
                type: 'velocity',
                title: 'Study Velocity',
                highlight: `${weeklyTotalHours} hrs this week`,
                body: `Recorded across ${studySessionCount} focus session(s). Consistent daily focus builds long-term retention.`
            });
        } else if (allDocuments.length > 0 && subjectsWithData.length === 0) {
            insights.push({
                type: 'info',
                title: 'Document Library',
                highlight: `${allDocuments.length} Document(s) Uploaded`,
                body: `You have ${allDocuments.length} document(s) in your library. Generate a quiz or review flashcards to establish mastery analytics.`
            });
        }

        const studyStreak = progressDoc ? (progressDoc.studyStreak || 0) : 0;

        res.json({
            success: true,
            data: {
                overview: {
                    questionsCompleted,
                    overallAccuracy,
                    studySessions: studySessionCount,
                    totalStudyTime: totalStudyTimeHours,
                    totalStudyMinutes: totalSessionMinutes,
                    studyStreak,
                    totalDocuments: allDocuments.length,
                    documentsUploaded: allDocuments.length,
                    quizzesCompleted: quizAttempts.length,
                    flashcardsGenerated,
                    flashcardsReviewed,
                    flashcardsMastered
                },
                subjectMastery,
                weeklyStudyTime: {
                    days: weeklyDays,
                    totalMinutes: weeklyTotalMinutes,
                    totalHours: weeklyTotalHours,
                    dailyAverageHours,
                    peakDay,
                    hasWeeklyData: weeklyTotalMinutes > 0
                },
                recentActivity: trimmedRecentActivity,
                studyGoals,
                upcoming,
                insights,
                // Backwards-compatibility fields
                questionsAttempted: totalQuizQuestionsAttempted,
                averageAccuracy: overallAccuracy,
                studyStreak,
                documentsUploaded: allDocuments.length,
                quizzesCompleted: quizAttempts.length,
                totalStudyHours: totalStudyTimeHours,
                subjectPerformance: subjectMastery.filter(s => s.hasData).map(s => ({
                    subject: s.subject,
                    accuracy: s.accuracy,
                    questionsAttempted: s.questionsAttempted
                })),
                weakTopics: progressDoc ? progressDoc.weakTopics : []
            }
        });
    } catch (error) {
        next(error);
    }
};

export const getSubjectProgress = async (req, res, next) => {
    try {
        const attempts = await QuizAttempt.find({ userId: req.user._id }).populate('quizId', 'subject');
        const subjectStats = {};
        attempts.forEach(a => {
            const subject = a.quizId?.subject || 'General';
            if (!subjectStats[subject]) subjectStats[subject] = { questionsAttempted: 0, questionsCorrect: 0 };
            subjectStats[subject].questionsAttempted += (a.totalQuestions || 0);
            subjectStats[subject].questionsCorrect += (a.score || 0);
        });
        const result = Object.keys(subjectStats).map(s => ({
            subject: s,
            questionsAttempted: subjectStats[s].questionsAttempted,
            accuracy: subjectStats[s].questionsAttempted > 0
                ? Math.round((subjectStats[s].questionsCorrect / subjectStats[s].questionsAttempted) * 100)
                : 0
        }));
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

export const getTopicProgress = async (req, res, next) => {
    try {
        const progress = await Progress.findOne({ userId: req.user._id });
        res.json({ success: true, data: progress ? progress.topicPerformance : [] });
    } catch (error) {
        next(error);
    }
};

export const logStudySession = async (req, res, next) => {
    try {
        const { duration, subject = 'General', topic, activityType = 'General', notes } = req.body;
        if (!duration || duration <= 0) {
            res.status(400);
            throw new Error('Valid duration in minutes is required');
        }
        const session = await StudySession.create({
            userId: req.user._id,
            duration: Number(duration),
            subject,
            topic,
            activityType,
            notes
        });
        res.status(201).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
};

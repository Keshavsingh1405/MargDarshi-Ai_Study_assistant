import Quiz from '../models/Quiz.js';
import QuizAttempt from '../models/QuizAttempt.js';
import StudySession from '../models/StudySession.js';
import Document from '../models/Document.js';
import { retrieveRelevantChunks } from '../services/rag/retrievalService.js';
import { generateAIContent } from '../services/ai/aiService.js';
import { QUIZ_PROMPT } from '../prompts/quizPrompt.js';
import Progress from '../models/Progress.js';

export const generateQuiz = async (req, res, next, services = {}) => {
    try {
        const { subject, topic, difficulty = 'Medium', count = 5, type = 'MCQ', isTimed, timeLimit } = req.body;
        const retriever = services.retrieveRelevantChunks || retrieveRelevantChunks;
        const aiGenerator = services.generateAIContent || generateAIContent;
        
        const trimmedSubject = (subject || '').trim();
        const trimmedTopic = (topic || '').trim();

        if (!trimmedSubject) {
            return res.status(400).json({
                success: false,
                message: 'Subject is required to generate a quiz.'
            });
        }

        // 1. Trace and verify user documents in MongoDB
        const userDocs = await Document.find({ userId: req.user._id }).lean();
        
        // Distinction 1: Missing documents (User has no uploaded documents at all)
        if (!userDocs || userDocs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No uploaded documents found. Please upload course materials in My Documents before generating a quiz.'
            });
        }

        // Distinction 2: Subject comparison
        // Support exact match, case-insensitive match, and trimmed whitespace
        const isAll = trimmedSubject.toLowerCase() === 'all';
        const matchingDocs = isAll
            ? userDocs
            : userDocs.filter(d => {
                const docSub = (d.subject || 'General').trim();
                return docSub.toLowerCase() === trimmedSubject.toLowerCase();
            });

        if (matchingDocs.length === 0) {
            const availableSubjects = [...new Set(userDocs.map(d => (d.subject || 'General').trim()))].filter(Boolean);
            return res.status(404).json({
                success: false,
                message: `No documents found for subject "${trimmedSubject}". Available subjects in your documents: ${availableSubjects.join(', ')}.`
            });
        }

        // Distinction 3: Document processing status and extracted text
        const indexedDocs = matchingDocs.filter(d => d.status === 'INDEXED' && d.chunkCount > 0);
        if (indexedDocs.length === 0) {
            const processingDocs = matchingDocs.filter(d => d.status === 'PROCESSING');
            if (processingDocs.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Documents for "${trimmedSubject}" are still being processed. Please wait a moment and try again.`
                });
            }
            const failedDocs = matchingDocs.filter(d => d.status === 'FAILED');
            if (failedDocs.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Document processing failed for "${trimmedSubject}". Please re-upload your document.`
                });
            }
            return res.status(400).json({
                success: false,
                message: `No readable extracted content found in documents for "${trimmedSubject}".`
            });
        }

        // 2. Retrieve context from Pinecone using verified document IDs to avoid subject casing filter issues
        const targetDocumentIds = indexedDocs.map(d => d._id.toString());
        const namespace = `user_${req.user._id}`;
        const query = trimmedTopic || trimmedSubject;

        let chunks = [];
        try {
            chunks = await retriever(query, namespace, 10, null, targetDocumentIds);
        } catch (err) {
            console.error('Vector retrieval error in quiz generation:', err);
            return res.status(503).json({
                success: false,
                message: 'Unable to retrieve content from your documents due to a vector retrieval error. Please try again.'
            });
        }

        // Distinction 4 & Requirement 6: Topic coverage verification
        // Relevant chunks for valid topics have similarity score >= 0.50 (typically 0.65-0.80),
        // while unrelated topics score < 0.50.
        const minRelevanceThreshold = 0.50;
        const relevantChunks = trimmedTopic 
            ? chunks.filter(c => typeof c.score !== 'number' || c.score >= minRelevanceThreshold)
            : chunks;

        if (relevantChunks.length === 0) {
            if (trimmedTopic) {
                return res.status(400).json({
                    success: false,
                    message: `The topic "${trimmedTopic}" is not covered in your uploaded study material for "${trimmedSubject}". Please choose a topic covered by your documents.`
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: `No relevant study content could be retrieved from your documents for "${trimmedSubject}".`
                });
            }
        }

        // Grounded context strictly from the retrieved chunks
        const contextString = relevantChunks.map(c => c.text).join('\n\n');

        // Canonical subject name from matching documents
        const canonicalSubject = isAll ? 'General' : (indexedDocs[0].subject || trimmedSubject);

        // 3. Generate questions using AI
        const prompt = QUIZ_PROMPT
            .replace('{topic}', trimmedTopic || canonicalSubject)
            .replace('{difficulty}', difficulty)
            .replace('{count}', count)
            .replace('{type}', type)
            .replace('{context}', contextString);

        let response;
        try {
            response = await aiGenerator({
                contents: prompt,
                config: {
                    responseMimeType: "application/json"
                }
            });
        } catch (aiErr) {
            // Distinction 5: Gemini API errors
            console.error('AI Generation error in quiz generation:', aiErr);
            const status = aiErr.status || 503;
            return res.status(status).json({
                success: false,
                message: aiErr.message || 'AI service is temporarily unavailable. Please try again later.'
            });
        }

        let quizData;
        try {
            quizData = JSON.parse(response.text);
        } catch (e) {
            const cleaned = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
            quizData = JSON.parse(cleaned);
        }

        const questionsList = Array.isArray(quizData) ? quizData : (quizData.questions || []);

        if (!questionsList || questionsList.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'Failed to generate valid quiz questions from the study material.'
            });
        }

        // 4. Save Quiz
        const quiz = await Quiz.create({
            userId: req.user._id,
            title: `${trimmedTopic || canonicalSubject} Quiz - ${difficulty}`,
            subject: canonicalSubject,
            topic: trimmedTopic || undefined,
            difficulty,
            isTimed,
            timeLimit,
            questions: questionsList
        });

        res.status(201).json({ success: true, data: quiz });
    } catch (error) {
        next(error);
    }
};

export const getQuizzes = async (req, res, next) => {
    try {
        const quizzes = await Quiz.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
        const quizIds = quizzes.map(q => q._id);
        const attempts = await QuizAttempt.find({ userId: req.user._id, quizId: { $in: quizIds } })
            .sort({ createdAt: -1 })
            .lean();

        const attemptMap = {};
        attempts.forEach(att => {
            const qId = att.quizId.toString();
            if (!attemptMap[qId]) {
                attemptMap[qId] = att;
            }
        });

        const data = quizzes.map(q => ({
            ...q,
            latestAttempt: attemptMap[q._id.toString()] || null
        }));

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

export const getQuizById = async (req, res, next) => {
    try {
        const quiz = await Quiz.findOne({ _id: req.params.id, userId: req.user._id });
        if (!quiz) {
            res.status(404);
            throw new Error('Quiz not found');
        }
        res.json({ success: true, data: quiz });
    } catch (error) {
        next(error);
    }
};

export const submitQuiz = async (req, res, next) => {
    try {
        const { answers } = req.body;
        if (!answers || !Array.isArray(answers)) {
            return res.status(400).json({
                success: false,
                message: 'An array of answers is required.'
            });
        }

        const quiz = await Quiz.findOne({ _id: req.params.id, userId: req.user._id });
        
        if (!quiz) {
            res.status(404);
            throw new Error('Quiz not found');
        }

        // Prevent rapid duplicate submissions within 4 seconds from creating redundant attempt records
        const recentAttempt = await QuizAttempt.findOne({
            userId: req.user._id,
            quizId: quiz._id,
            createdAt: { $gte: new Date(Date.now() - 4000) }
        });
        if (recentAttempt) {
            return res.json({ success: true, data: recentAttempt });
        }

        let score = 0;
        const evaluatedAnswers = [];
        const weakTopics = [];

        quiz.questions.forEach((q, index) => {
            const userAnswerObj = answers.find(a => a && a.questionId === q._id.toString());
            const isCorrect = Boolean(userAnswerObj && userAnswerObj.userAnswer === q.correctAnswer);
            
            if (isCorrect) score++;
            else {
                if (quiz.topic && !weakTopics.includes(quiz.topic)) {
                    weakTopics.push(quiz.topic);
                }
            }

            evaluatedAnswers.push({
                questionId: q._id,
                userAnswer: userAnswerObj ? userAnswerObj.userAnswer : null,
                isCorrect
            });
        });

        const totalQuestionsCount = Math.max(1, quiz.questions.length);
        const accuracy = (score / totalQuestionsCount) * 100;

        const attempt = await QuizAttempt.create({
            userId: req.user._id,
            quizId: quiz._id,
            score,
            totalQuestions: quiz.questions.length,
            accuracy,
            answers: evaluatedAnswers,
            weakTopics
        });
        
        // Record real study session for completed quiz
        const quizDuration = quiz.timeLimit ? Math.max(1, Math.round(quiz.timeLimit / 60)) : Math.max(2, Math.round(quiz.questions.length * 1.5));
        StudySession.create({
            userId: req.user._id,
            subject: quiz.subject || 'General',
            topic: quiz.topic,
            duration: quizDuration,
            activityType: 'Quiz',
            notes: `Completed quiz: ${quiz.title} (${score}/${quiz.questions.length})`
        }).catch(err => console.warn('Could not record quiz study session:', err.message));

        // Update Progress asynchronously
        updateProgress(req.user._id, quiz.subject, quiz.topic, score, quiz.questions.length, weakTopics).catch(console.error);

        res.json({ success: true, data: attempt });
    } catch (error) {
        next(error);
    }
};

const updateProgress = async (userId, subject, topic, correct, total, weakTopics) => {
    let progress = await Progress.findOne({ userId });
    
    if (!progress) {
        progress = new Progress({ userId });
    }
    
    progress.questionsAttempted += total;
    // Calculate new rolling average approx
    const oldScore = (progress.averageAccuracy / 100) * (progress.questionsAttempted - total);
    progress.averageAccuracy = ((oldScore + correct) / progress.questionsAttempted) * 100;
    
    // Subject progress
    let sub = progress.subjectPerformance.find(s => s.subject === subject);
    if (!sub) {
        progress.subjectPerformance.push({ subject, accuracy: 0, questionsAttempted: 0 });
        sub = progress.subjectPerformance[progress.subjectPerformance.length - 1];
    }
    const subOldScore = (sub.accuracy / 100) * sub.questionsAttempted;
    sub.questionsAttempted += total;
    sub.accuracy = ((subOldScore + correct) / sub.questionsAttempted) * 100;
    
    // Topic progress
    if (topic) {
        let top = progress.topicPerformance.find(t => t.topic === topic);
        if (!top) {
            progress.topicPerformance.push({ topic, subject, accuracy: 0, questionsAttempted: 0 });
            top = progress.topicPerformance[progress.topicPerformance.length - 1];
        }
        const topOldScore = (top.accuracy / 100) * top.questionsAttempted;
        top.questionsAttempted += total;
        top.accuracy = ((topOldScore + correct) / top.questionsAttempted) * 100;
    }
    
    weakTopics.forEach(wt => {
        if (!progress.weakTopics.includes(wt)) {
            progress.weakTopics.push(wt);
        }
    });
    
    progress.markModified('subjectPerformance');
    progress.markModified('topicPerformance');
    
    // Update streak logic
    const today = new Date().setHours(0,0,0,0);
    const lastDate = progress.lastStudyDate ? new Date(progress.lastStudyDate).setHours(0,0,0,0) : null;
    
    if (lastDate !== today) {
        if (lastDate === today - 86400000) {
            progress.studyStreak += 1;
        } else {
            progress.studyStreak = 1;
        }
        progress.lastStudyDate = new Date();
    }
    
    await progress.save();
};

export const deleteQuiz = async (req, res, next) => {
    try {
        const quiz = await Quiz.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!quiz) {
            res.status(404);
            throw new Error('Quiz not found');
        }
        res.json({ success: true, message: 'Quiz discarded' });
    } catch (error) {
        next(error);
    }
};

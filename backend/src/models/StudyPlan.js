import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
    title: { type: String, trim: true },
    subject: { type: String, trim: true, default: 'General' },
    topic: { type: String, trim: true, default: 'Key Concepts' },
    duration: { type: Number, default: 30 }, // in minutes
    taskType: { 
        type: String, 
        enum: ['Revision', 'Practice questions', 'Flashcards', 'Quizzes', 'Mock tests'],
        default: 'Revision'
    },
    priority: {
        type: String,
        enum: ['High', 'Medium', 'Low'],
        default: 'Medium'
    },
    isCompleted: { type: Boolean, default: false },
    scheduledDate: { type: Date }
}, { _id: true });

const dayPlanSchema = new mongoose.Schema({
    day: { type: Date, required: true },
    dayNumber: { type: Number },
    dateString: { type: String }, // 'YYYY-MM-DD'
    tasks: [taskSchema]
}, { _id: false });

const studyPlanSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    examName: { type: String, required: true, trim: true },
    examDate: { type: Date, required: true },
    examDateString: { type: String }, // 'YYYY-MM-DD'
    startDate: { type: Date },
    startDateString: { type: String }, // 'YYYY-MM-DD'
    endDate: { type: Date }, // Preparation end date (day before exam by default)
    endDateString: { type: String }, // 'YYYY-MM-DD'
    totalPreparationDays: { type: Number, default: 1 },
    totalPlannedMinutes: { type: Number, default: 0 },
    includeExamDay: { type: Boolean, default: false },
    subjects: [{ type: String, trim: true }],
    selectedDocumentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
    isDocumentGrounded: { type: Boolean, default: false },
    groundingNotes: { type: String, default: '' },
    dailyStudyTime: { type: Number, default: 120 }, // in minutes
    plan: [dayPlanSchema]
}, { timestamps: true });

const StudyPlan = mongoose.model('StudyPlan', studyPlanSchema);
export default StudyPlan;

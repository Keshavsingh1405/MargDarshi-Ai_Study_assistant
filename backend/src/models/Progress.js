import mongoose from 'mongoose';

const progressSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    totalDocuments: { type: Number, default: 0 },
    questionsAttempted: { type: Number, default: 0 },
    averageAccuracy: { type: Number, default: 0 },
    studyStreak: { type: Number, default: 0 },
    lastStudyDate: { type: Date },
    subjectPerformance: [{
        subject: String,
        accuracy: Number,
        questionsAttempted: Number
    }],
    topicPerformance: [{
        topic: String,
        subject: String,
        accuracy: Number,
        questionsAttempted: Number
    }],
    weakTopics: [String]
}, { timestamps: true });

const Progress = mongoose.model('Progress', progressSchema);
export default Progress;

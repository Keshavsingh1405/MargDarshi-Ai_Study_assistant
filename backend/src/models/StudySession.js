import mongoose from 'mongoose';

const studySessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    subject: { type: String, default: 'General' },
    topic: { type: String },
    duration: { type: Number, required: true }, // in minutes
    activityType: { 
        type: String, 
        enum: ['Quiz', 'Flashcards', 'Reading', 'AI Tutor', 'Study Plan', 'General'], 
        default: 'General' 
    },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    notes: { type: String }
}, { timestamps: true });

const StudySession = mongoose.model('StudySession', studySessionSchema);
export default StudySession;

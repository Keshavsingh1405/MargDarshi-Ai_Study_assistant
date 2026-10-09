import mongoose from 'mongoose';

const quizSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: { type: String, required: true },
    subject: { type: String, required: true },
    topic: { type: String },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' },
    isTimed: { type: Boolean, default: false },
    timeLimit: { type: Number }, // in seconds
    questions: [{
        questionText: { type: String, required: true },
        type: { type: String, enum: ['MCQ', 'True/False', 'Fill in the blank', 'Short answer'], required: true },
        options: [String],
        correctAnswer: { type: String, required: true },
        explanation: { type: String }
    }]
}, { timestamps: true });

const Quiz = mongoose.model('Quiz', quizSchema);
export default Quiz;

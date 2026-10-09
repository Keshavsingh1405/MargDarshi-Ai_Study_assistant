import mongoose from 'mongoose';

const flashcardSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    deckId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FlashcardDeck'
    },
    subject: { type: String, required: true },
    topic: { type: String },
    front: { type: String, required: true },
    back: { type: String, required: true },
    status: { type: String, enum: ['New', 'Learning', 'Known'], default: 'New' },
    reviewCount: { type: Number, default: 0 },
    lastReviewedAt: { type: Date }
}, { timestamps: true });

const Flashcard = mongoose.model('Flashcard', flashcardSchema);
export default Flashcard;

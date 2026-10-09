import mongoose from 'mongoose';

const flashcardItemSchema = new mongoose.Schema({
    front: { 
        type: String, 
        required: true 
    },
    back: { 
        type: String, 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['New', 'Learning', 'Known'], 
        default: 'New' 
    },
    reviewCount: { 
        type: Number, 
        default: 0 
    },
    lastReviewedAt: { 
        type: Date 
    }
}, { timestamps: true });

const flashcardDeckSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: { 
        type: String, 
        required: true 
    },
    subject: { 
        type: String, 
        required: true 
    },
    topic: { 
        type: String, 
        default: '' 
    },
    cardCount: { 
        type: Number, 
        default: 0 
    },
    cards: [flashcardItemSchema]
}, { timestamps: true });

const FlashcardDeck = mongoose.model('FlashcardDeck', flashcardDeckSchema);
export default FlashcardDeck;

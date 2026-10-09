import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chat',
        required: true
    },
    role: { type: String, enum: ['user', 'ai'], required: true },
    content: { type: String, required: true },
    sources: [{
        documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
        documentName: String,
        page: Number,
        excerpt: String
    }]
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);
export default Message;

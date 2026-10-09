import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: { type: String, default: 'New Conversation' },
    documents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Document'
    }]
}, { timestamps: true });

const Chat = mongoose.model('Chat', chatSchema);
export default Chat;

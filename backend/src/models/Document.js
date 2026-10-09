import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    subject: { type: String, default: 'General' },
    chapter: { type: String },
    status: { 
        type: String, 
        enum: ['PROCESSING', 'INDEXED', 'FAILED'], 
        default: 'PROCESSING' 
    },
    pineconeNamespace: { type: String, required: true },
    chunkCount: { type: Number, default: 0 },
    errorMessage: { type: String },
    processedAt: { type: Date }
}, { timestamps: true });

const Document = mongoose.model('Document', documentSchema);
export default Document;

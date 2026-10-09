import Document from '../models/Document.js';
import { processDocumentJob, deleteDocumentVectors } from '../services/rag/ragService.js';
import fs from 'fs';

export const uploadDocument = async (req, res, next) => {
    try {
        if (!req.file) {
            res.status(400);
            throw new Error('No file uploaded');
        }

        const { subject, chapter } = req.body;
        const fileExt = req.file.originalname.split('.').pop().toLowerCase();

        const document = await Document.create({
            userId: req.user._id,
            filename: req.file.filename,
            originalName: req.file.originalname,
            fileType: fileExt,
            fileSize: req.file.size,
            subject: subject || 'General',
            chapter: chapter || '',
            status: 'PROCESSING',
            pineconeNamespace: `user_${req.user._id}`
        });

        // Trigger processing asynchronously
        processDocumentJob(document, req.file.path).catch(err => {
            console.error('Error in background processing', err);
        });

        res.status(201).json({
            success: true,
            data: document,
            message: 'Document uploaded and processing started'
        });
    } catch (error) {
        next(error);
    }
};

export const getDocuments = async (req, res, next) => {
    try {
        const documents = await Document.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json({ success: true, data: documents });
    } catch (error) {
        next(error);
    }
};

export const getDocumentById = async (req, res, next) => {
    try {
        const document = await Document.findOne({ _id: req.params.id, userId: req.user._id });
        if (!document) {
            res.status(404);
            throw new Error('Document not found');
        }
        res.json({ success: true, data: document });
    } catch (error) {
        next(error);
    }
};

export const updateDocument = async (req, res, next) => {
    try {
        const { subject, chapter, filename } = req.body;
        const document = await Document.findOne({ _id: req.params.id, userId: req.user._id });
        
        if (!document) {
            res.status(404);
            throw new Error('Document not found');
        }

        if (subject) document.subject = subject;
        if (chapter) document.chapter = chapter;
        if (filename) document.originalName = filename;

        await document.save();
        res.json({ success: true, data: document });
    } catch (error) {
        next(error);
    }
};

export const deleteDocument = async (req, res, next) => {
    try {
        const document = await Document.findOne({ _id: req.params.id, userId: req.user._id });
        
        if (!document) {
            res.status(404);
            throw new Error('Document not found');
        }

        // Delete from Pinecone
        try {
            await deleteDocumentVectors(document.pineconeNamespace, document._id);
        } catch (vecErr) {
            console.warn('[Documents] Warning deleting Pinecone vectors:', vecErr.message || vecErr);
        }

        // Delete file if exists
        const filePath = `uploads/${document.filename}`;
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await document.deleteOne();
        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        next(error);
    }
};

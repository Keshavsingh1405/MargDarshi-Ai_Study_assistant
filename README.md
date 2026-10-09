# Margdarshi - AI Study Assistant

Margdarshi is a modern, AI-powered personal study companion designed to help students learn effectively from their own study material. Unlike generic chatbots, Margdarshi prioritizes your uploaded notes to provide grounded, accurate answers, generate quizzes, create flashcards, and track your learning progress.

## Features

- **Document Management**: Upload PDF, DOCX, and TXT files.
- **RAG-based AI Chat**: Ask questions based on your uploaded materials using Gemini 2.5 Flash and Pinecone.
- **Source Citations**: Answers include page numbers and excerpts from your notes.
- **Adaptive Quizzes**: Automatically generate quizzes based on your study material to test your knowledge.
- **Smart Flashcards**: Create flashcards for rapid revision.
- **Study Planner**: Automatically generate study schedules leading up to your exams.
- **Progress Tracking**: Monitor your study streak, accuracy, and weak topics.

## Architecture & Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (bundled with Vite)
- **Backend**: Node.js, Express.js
- **Database**: MongoDB (Mongoose)
- **Vector Database**: Pinecone
- **AI Models**: Google Gemini 2.5 Flash, Gemini Embedding 004
- **Email Service**: Resend
- **Authentication**: JWT, bcrypt, HttpOnly Cookies

## Directory Structure

```text
margdarshi/
├── frontend/             # HTML, CSS, Vanilla JS
│   ├── index.html        # Landing page
│   ├── dashboard.html    # User dashboard
│   ├── chat.html         # RAG Chat interface
│   ├── documents.html    # Document upload/management
│   ├── css/              # Modular CSS (variables, global, components)
│   ├── js/               # API helpers, auth logic
│   └── package.json      # Vite configuration
├── backend/              # Node.js + Express
│   ├── src/
│   │   ├── config/       # DB, AI, Vector DB configs
│   │   ├── controllers/  # API logic
│   │   ├── middleware/   # Auth, error, upload (Multer) middlewares
│   │   ├── models/       # Mongoose schemas (User, Document, Chat, etc.)
│   │   ├── prompts/      # AI system prompts
│   │   ├── routes/       # Express routes
│   │   ├── services/     # RAG, Document processing, AI generation
│   │   ├── utils/        # Token utilities
│   │   └── server.js     # Entry point
│   ├── uploads/          # Temporary document storage
│   └── package.json      # Backend dependencies
└── package.json          # Root scripts
```

## Setup & Installation

### 1. Clone & Install
```bash
# In the project root, install all dependencies for both frontend and backend
npm run install-all
```

### 2. Environment Variables
Create `.env` in the `backend` directory using the provided `.env.example`:
```env
PORT=5000
MONGODB_URI=YOUR_MONGODB_ATLAS_URI
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
PINECONE_API_KEY=YOUR_PINECONE_API_KEY
PINECONE_INDEX_NAME=margdarshi
PINECONE_DIMENSION=768
RESEND_API_KEY=YOUR_RESEND_API_KEY
JWT_SECRET=YOUR_LONG_RANDOM_SECRET
FRONTEND_URL=http://localhost:5173
RESEND_FROM_EMAIL=YOUR_VERIFIED_EMAIL
```

Create `.env` in the `frontend` directory using `.env.example`:
```env
VITE_API_URL=http://localhost:5000/api
```

### 3. Run Locally
To run both backend and frontend concurrently:
```bash
npm run dev
```
- Frontend will run at `http://localhost:5173`
- Backend will run at `http://localhost:5000`

## Deployment

**Frontend (Vercel)**:
- Connect the repository to Vercel.
- Set root directory to `frontend`.
- Build command: `npm run build`
- Output directory: `dist`
- Set Environment Variable: `VITE_API_URL=https://your-backend-url.onrender.com/api`

**Backend (Render/Railway)**:
- Connect the repository.
- Root directory: `backend`.
- Build command: `npm install`
- Start command: `npm start`
- Add all environment variables from your local `.env`.

## Security & Data Privacy

- **Per-User Namespaces**: All Pinecone vectors are stored in isolated namespaces (`user_<id>`) ensuring complete data isolation.
- **Document Access**: MongoDB queries enforce user ID filtering to prevent cross-account access.
- **Authentication**: JWTs are secured inside `HttpOnly` cookies to protect against XSS attacks.

## Future Improvements

- Query Rewriting and Reranking for better RAG retrieval.
- OCR support for scanned PDFs and images.
- WebSocket integration for real-time AI streaming responses.
- Advanced visualization of Progress using Chart.js.

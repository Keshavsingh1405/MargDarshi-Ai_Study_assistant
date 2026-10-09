import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        register: resolve(__dirname, 'register.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        chat: resolve(__dirname, 'chat.html'),
        documents: resolve(__dirname, 'documents.html'),
        quizzes: resolve(__dirname, 'quizzes.html'),
        flashcards: resolve(__dirname, 'flashcards.html'),
        planner: resolve(__dirname, 'planner.html'),
        progress: resolve(__dirname, 'progress.html'),
        profile: resolve(__dirname, 'profile.html')
      }
    }
  }
});

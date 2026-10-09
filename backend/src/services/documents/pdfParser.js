import fs from 'fs';
import pdfParse from 'pdf-parse';

export const parsePdf = async (filePath) => {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    
    // pdf-parse doesn't strictly give pages easily in a perfect array, 
    // but we can just return the full text. For page numbers, we'd need a more advanced library.
    // For now, we'll treat it as 1 big chunk and chunk it later without page numbers.
    return [{
        page: 1,
        text: data.text
    }];
};

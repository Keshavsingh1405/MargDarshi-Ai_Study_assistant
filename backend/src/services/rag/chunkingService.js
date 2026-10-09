export const chunkText = (text, maxChunkSize = 1000, overlap = 200) => {
    if (!text) return [];
    
    // Very basic chunking logic based on characters. 
    // In production, use token-based chunking or sentence-aware chunking.
    const chunks = [];
    let startIndex = 0;
    
    while (startIndex < text.length) {
        let endIndex = startIndex + maxChunkSize;
        
        // Try to find a good breaking point (e.g., period or newline) if we are not at the end
        if (endIndex < text.length) {
            const nextPeriod = text.indexOf('.', endIndex - 100);
            const nextNewline = text.indexOf('\n', endIndex - 100);
            
            if (nextNewline !== -1 && nextNewline < endIndex + 100) {
                endIndex = nextNewline + 1;
            } else if (nextPeriod !== -1 && nextPeriod < endIndex + 100) {
                endIndex = nextPeriod + 1;
            }
        }
        
        const chunk = text.slice(startIndex, endIndex).trim();
        if (chunk) {
            chunks.push(chunk);
        }
        
        startIndex = endIndex - overlap;
        if (startIndex < 0) startIndex = 0;
        
        // Prevent infinite loop if something goes wrong
        if (endIndex >= text.length) break;
    }
    
    return chunks;
};

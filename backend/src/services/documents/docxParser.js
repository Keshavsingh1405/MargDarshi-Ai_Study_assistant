import mammoth from 'mammoth';

export const parseDocx = async (filePath) => {
    const result = await mammoth.extractRawText({ path: filePath });
    return [{
        page: 1,
        text: result.value
    }];
};

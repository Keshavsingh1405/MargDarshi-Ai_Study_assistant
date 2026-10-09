import fs from 'fs';

export const parseTxt = async (filePath) => {
    const text = fs.readFileSync(filePath, 'utf-8');
    return [{
        page: 1,
        text
    }];
};

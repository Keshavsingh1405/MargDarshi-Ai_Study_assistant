export const errorMiddleware = (err, req, res, next) => {
    const statusCode = err.status || err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
    
    console.error(`[Error] ${err.message}`);
    if (process.env.NODE_ENV === 'development') {
        console.error(err.stack);
    }

    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error',
        errorCode: err.name || 'SERVER_ERROR'
    });
};

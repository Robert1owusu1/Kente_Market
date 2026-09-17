import { captureError } from '../utils/sentry.js';

const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

const errorHandeler = (err, req, res, next) => {
    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    console.error(`[${req.method}] ${req.originalUrl} -> ${statusCode}: ${err.message}`);
    if (err.stack) {
        console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    }
    // Send to Sentry when configured (fire-and-forget; never blocks the response).
    captureError(err, req);
    res.status(statusCode).json({ message: 'An error occurred' });
};

export { notFound, errorHandeler };
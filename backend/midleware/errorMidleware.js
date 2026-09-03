const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

// Express requires a 4-arg signature to recognize this as an error handler.
// eslint-disable-next-line no-unused-vars
const errorHandeler = (err, req, res, next) => {
    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    // Never leak internal error messages in production
    const message = process.env.NODE_ENV === 'production'
        ? 'An error occurred'
        : err.message;

    res.status(statusCode).json({
        message,
    });
};

export { notFound, errorHandeler };
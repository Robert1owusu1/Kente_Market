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
    // Controllers signal deliberate client errors by setting res.status(4xx)
    // and then throwing with a user-facing message ("Invalid email or
    // password", "Please provide email and password", ...) — pass those
    // through verbatim so the UI can show something actionable. Anything that
    // falls through as 5xx (unflagged throws: DB failures, bugs) stays
    // generic so internal details never reach the client.
    const message =
        statusCode >= 400 && statusCode < 500 && err && err.message
            ? err.message
            : 'An error occurred';
    res.status(statusCode).json({ message });
};

export { notFound, errorHandeler };
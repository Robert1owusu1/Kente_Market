const notFound = (req,res,next) => {
    const error = new Error(`Note Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

const errorHandeler = (err, req, next) =>{
    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;

    let message= err.message;

    //check for bad objectId

    if(err.name === 'castError' && err.kind ===ObjectID){
        message = `Resource not found`
        statusCode = 404;
    }
    res.status(statusCode).json({
        message,
        stack: process.env.NODE_ENV === 'production' ? '✅' : err.stack,
    });
};

export {notFound, errorHandeler};
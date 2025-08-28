import winston from 'winston';

// Custom format for better readability
const customFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS'
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const stackString = stack ? `\n${stack}` : '';
        return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaString}${stackString}`;
    })
);

// Create logger instance
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: customFormat,
    transports: [
        // Console transport for development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                customFormat
            )
        }),
        // File transport for persistent logging
        new winston.transports.File({
            filename: 'webrtc.log',
            maxsize: 5242880, // 5MB
            maxFiles: 3,
            tailable: true
        }),
        // Error-only file for critical issues
        new winston.transports.File({
            filename: 'webrtc-errors.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 3,
            tailable: true
        })
    ],
    // Handle uncaught exceptions and rejections
    exceptionHandlers: [
        new winston.transports.File({ filename: 'exceptions.log' })
    ],
    rejectionHandlers: [
        new winston.transports.File({ filename: 'rejections.log' })
    ]
});

// Export convenience methods
export const log = {
    debug: (message: string, meta?: any) => logger.debug(message, meta),
    info: (message: string, meta?: any) => logger.info(message, meta),
    warn: (message: string, meta?: any) => logger.warn(message, meta),
    error: (message: string, meta?: any) => logger.error(message, meta),
    verbose: (message: string, meta?: any) => logger.verbose(message, meta)
};

export default logger;

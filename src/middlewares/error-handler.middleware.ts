import { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger.js';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';

export const ErrorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  try {
    if (err instanceof AppError) {
      logger.warn(`${err.constructor.name}: ${err.message}`, {
        url: req.originalUrl,
        method: req.method,
      });

      const body: Record<string, unknown> = {
        success: false,
        message: err.message,
      };
      if ("code" in err && err.code) {
        body.code = err.code;
      }

      res.status(err.statusCode || 400).json(body);
      return;
    }

    if(err instanceof ConflictError){
      logger.warn(`${err.constructor.name}: ${err.message}`, {
        url: req.originalUrl,
        method: req.method,
      });

      res.status(err.statusCode || 409).json({
        success: false,
        message: err.message,
      });
      return;
    }

    if(err instanceof NotFoundError){
      logger.warn(`${err.constructor.name}: ${err.message}`, {
        url: req.originalUrl,
        method: req.method,
      });

      res.status(err.statusCode || 404).json({
        success: false,
        message: err.message,
      });
      return;
    }
    if(err instanceof ForbiddenError){
      logger.warn(`${err.constructor.name}: ${err.message}`, {
        url: req.originalUrl,
        method: req.method,
      });

      res.status(err.statusCode || 403).json({
        success: false,
        message: err.message,
      });
      return;
    }
    if(err instanceof BadRequestError){
      logger.warn(`${err.constructor.name}: ${err.message}`, {
        url: req.originalUrl,
        method: req.method,
      });

      res.status(err.statusCode || 400).json({
        success: false,
        message: err.message,
      });
      return;
    }



    logger.error("Unexpected Error", {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      timestamp: new Date(),
    });

    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });

  } catch (criticalError) {
    console.error("Critical failure in ErrorHandler:", criticalError);
    
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Fatal Error" });
    }
  }
};
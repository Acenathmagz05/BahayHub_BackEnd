import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ErrorCode } from '../enums/error-code.enum';
import { ValidationErrorDetail } from '../pipes/validation.pipe';

interface ErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  details: ValidationErrorDetail[];
  path: string;
  timestamp: string;
}

interface HttpExceptionBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

const STATUS_TO_ERROR_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(@Optional() private readonly configService?: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const path = request.originalUrl || request.url;
    const timestamp = new Date().toISOString();
    const nodeEnv =
      this.configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    const isProduction = nodeEnv === 'production';

    let errorPayload: ErrorPayload;

    if (exception instanceof HttpException) {
      errorPayload = this.buildHttpExceptionPayload(
        exception,
        path,
        timestamp,
        request.method,
        isProduction,
      );
    } else {
      this.logInternalError(request.method, path, exception);
      errorPayload = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        details: [],
        path,
        timestamp,
      };
    }

    response.status(errorPayload.statusCode).json({
      success: false,
      error: errorPayload,
    });
  }

  private buildHttpExceptionPayload(
    exception: HttpException,
    path: string,
    timestamp: string,
    method: string,
    isProduction: boolean,
  ): ErrorPayload {
    const statusCode = exception.getStatus();

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logInternalError(method, path, exception);
      return {
        statusCode,
        code: ErrorCode.INTERNAL_ERROR,
        message: isProduction
          ? 'Internal server error'
          : exception.message || 'Internal server error',
        details: [],
        path,
        timestamp,
      };
    }

    if (
      exception instanceof ThrottlerException ||
      statusCode === HttpStatus.TOO_MANY_REQUESTS
    ) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.TOO_MANY_REQUESTS,
        message: 'Too many requests',
        details: [],
        path,
        timestamp,
      };
    }

    const rawResponse = exception.getResponse();
    let code =
      STATUS_TO_ERROR_CODE[statusCode] ??
      (statusCode >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR);
    let message = exception.message || 'Request failed';
    let details: ValidationErrorDetail[] = [];

    if (typeof rawResponse === 'string') {
      message = rawResponse;
    } else if (rawResponse && typeof rawResponse === 'object') {
      const body = rawResponse as HttpExceptionBody;

      if (typeof body.code === 'string' && body.code.length > 0) {
        code = body.code as ErrorCode;
      }

      if (this.isValidationDetailArray(body.details)) {
        details = body.details;
      }

      if (Array.isArray(body.message)) {
        if (details.length === 0) {
          details = body.message
            .filter((item): item is string => typeof item === 'string')
            .map((msg) => ({ field: '', message: msg }));
        }
        message = 'Validation failed';
      } else if (typeof body.message === 'string' && body.message.length > 0) {
        message = body.message;
      }
    }

    return {
      statusCode,
      code,
      message,
      details,
      path,
      timestamp,
    };
  }

  private isValidationDetailArray(
    value: unknown,
  ): value is ValidationErrorDetail[] {
    return (
      Array.isArray(value) &&
      value.every(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof (item as ValidationErrorDetail).field === 'string' &&
          typeof (item as ValidationErrorDetail).message === 'string',
      )
    );
  }

  private logInternalError(
    method: string,
    path: string,
    exception: unknown,
  ): void {
    const trace =
      exception instanceof Error ? exception.stack : String(exception);
    this.logger.error(`${method} ${path} failed`, trace);
  }
}

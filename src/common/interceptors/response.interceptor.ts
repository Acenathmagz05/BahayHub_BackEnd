import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { map, Observable } from 'rxjs';

export interface PaginatedResult<T> {
  data: T;
  meta: Record<string, unknown>;
}

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.includes('data') &&
    keys.includes('meta') &&
    keys.every((key) => key === 'data' || key === 'meta')
  );
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T> | undefined>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T> | undefined> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((value) => {
        if (response.statusCode === HttpStatus.NO_CONTENT) {
          return undefined;
        }

        if (isPaginatedResult(value)) {
          return {
            success: true as const,
            data: (value.data ?? null) as T,
            meta: value.meta,
          };
        }

        return {
          success: true as const,
          data: (value ?? null) as T,
        };
      }),
    );
  }
}

import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { EntityNotFoundError } from 'typeorm';

/** findOneOrFail con un id que no existe: 404 "No encontrado" en vez de un 500. */
@Catch(EntityNotFoundError)
export class EntityNotFoundFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(_err: EntityNotFoundError, host: ArgumentsHost) {
    super.catch(new NotFoundException('No encontrado'), host);
  }
}

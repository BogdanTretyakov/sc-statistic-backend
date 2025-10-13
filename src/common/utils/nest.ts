import { HttpException, HttpStatus } from '@nestjs/common';

export class NotModifiedException extends HttpException {
  constructor() {
    super('Not Modified', HttpStatus.NOT_MODIFIED);
  }
}

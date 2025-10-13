import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly username = process.env.ADMIN_LOGIN;
  private readonly password = process.env.ADMIN_PASSWORD;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
      throw new UnauthorizedException();
    }

    // декодируем Base64
    const base64 = authHeader.split(' ')[1];
    const [user, pass] = Buffer.from(base64, 'base64').toString().split(':');

    if (user === this.username && pass === this.password) {
      return true;
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    throw new UnauthorizedException();
  }
}

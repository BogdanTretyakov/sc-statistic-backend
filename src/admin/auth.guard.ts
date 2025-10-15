import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly username = process.env.ADMIN_LOGIN;
  private readonly password = process.env.ADMIN_PASSWORD;
  private readonly realm = 'Admin Area';
  private nonces: Record<string, number> = {};
  private currentNonce?: string;

  private readonly nonceTimeout = 30 * 60 * 1000;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const authHeader = req.headers.authorization;

    if (
      !this.currentNonce ||
      Date.now() - this.nonces[this.currentNonce] > this.nonceTimeout
    ) {
      const nonce = crypto.randomBytes(16).toString('hex');
      this.nonces[nonce] = Date.now();
      setTimeout(() => delete this.nonces[nonce], this.nonceTimeout);
      this.currentNonce = nonce;
    }

    const nonce = this.currentNonce;

    if (!authHeader || !authHeader.startsWith('Digest ')) {
      res.setHeader(
        'WWW-Authenticate',
        `Digest realm="${this.realm}", qop="auth", nonce="${nonce}"`,
      );
      throw new UnauthorizedException();
    }

    const params = this.parseDigestHeader(authHeader.substring(7));

    if (!params.nonce || !this.nonces[params.nonce]) {
      res.setHeader(
        'WWW-Authenticate',
        `Digest realm="${this.realm}", qop="auth", nonce="${nonce}"`,
      );
      throw new UnauthorizedException();
    }

    if (params.username !== this.username) {
      throw new UnauthorizedException();
    }

    const ha1 = crypto
      .createHash('md5')
      .update(`${params.username}:${this.realm}:${this.password}`)
      .digest('hex');

    const ha2 = crypto
      .createHash('md5')
      .update(`${req.method}:${params.uri}`)
      .digest('hex');

    const expectedResponse = crypto
      .createHash('md5')
      .update(
        `${ha1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`,
      )
      .digest('hex');

    if (params.response !== expectedResponse) {
      res.setHeader(
        'WWW-Authenticate',
        `Digest realm="${this.realm}", qop="auth", nonce="${nonce}"`,
      );
      throw new UnauthorizedException();
    }

    return true;
  }

  private parseDigestHeader(header: string) {
    const regex = /(\w+)=["]?([^",]+)["]?/g;
    const result: Record<string, string> = {};
    let match;
    while ((match = regex.exec(header))) {
      result[match[1]] = match[2];
    }
    return result;
  }
}

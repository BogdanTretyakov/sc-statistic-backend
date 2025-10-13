import { Module } from '@nestjs/common';
import axios from 'axios';
import rateLimit from 'axios-rate-limit';
import { W3CReplayRequestService } from './w3cReplayRequest.service';

export const W3CRequest = Symbol('W3CRequest');

@Module({
  providers: [
    {
      provide: W3CRequest,
      useFactory: () =>
        rateLimit(
          axios.create({
            baseURL: 'https://website-backend.w3champions.com',
            headers: {
              'User-Agent': 'SC Stats Fetch Service',
            },
          }),
          { maxRequests: 1, perMilliseconds: 5000 },
        ),
    },
    W3CReplayRequestService,
  ],
  exports: [W3CRequest, W3CReplayRequestService],
})
export class RequestsModule {}

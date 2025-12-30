import { Injectable } from '@nestjs/common';
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import dayjs from 'dayjs';
import rateLimit from 'axios-rate-limit';

@Injectable()
export class W3CReplayRequestService {
  private requestGotExceededDate: null | dayjs.Dayjs = null;

  private axios = rateLimit(
    axios.create({
      baseURL: 'https://website-backend.w3champions.com',
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'SC Stats Fetch Service',
        'X-API-Token': process.env.W3C_REPLAYS_API_KEY!,
      },
    }),
    {
      maxRequests: 1,
      maxRPS: 1,
    },
  );

  async get<T = any>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.axios.get<T>(url, config).catch((e) => {
      if (axios.isAxiosError(e) && e.response?.status === 429) {
        this.requestGotExceededDate = dayjs();
      }
      throw e;
    });
  }

  public checkAvailable() {
    return this.requestGotExceededDate?.endOf('hour').isBefore(dayjs()) ?? true;
  }
}

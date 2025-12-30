import { Injectable } from '@nestjs/common';
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import Bottleneck from 'bottleneck';
import { isNotNil } from '../lib/guards';

const limitConfig = {
  perDay: 5000,
  perHour: 300,
};

@Injectable()
export class W3CReplayRequestService {
  public limiter: Bottleneck;
  private axios = axios.create({
    baseURL: 'https://website-backend.w3champions.com',
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'SC Stats Fetch Service',
      'X-API-Token': process.env.W3C_REPLAYS_API_KEY!,
    },
  });

  public dayLimiter = new Bottleneck({
    maxConcurrent: 1,
    reservoir: limitConfig.perDay - 1,
    reservoirRefreshAmount: limitConfig.perDay - 1,
    reservoirRefreshInterval: 24 * 60 * 60 * 1000,
    minTime: 0,
  });

  public hourLimiter = new Bottleneck({
    reservoir: limitConfig.perHour - 1,
    reservoirRefreshAmount: limitConfig.perHour - 1,
    reservoirRefreshInterval: 60 * 60 * 1000,
  });

  constructor() {
    this.limiter = this.hourLimiter.chain(this.dayLimiter);
  }

  async get<T = any>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.limiter.schedule(() => this.axios.get<T>(url, config));
  }

  async getLimit() {
    return Promise.all(
      [this.dayLimiter, this.hourLimiter].map((limiter) =>
        limiter.currentReservoir(),
      ),
    ).then((reservoirs) => {
      const values = reservoirs.filter(isNotNil);
      return values.length ? Math.min(...values) : 0;
    });
  }
}

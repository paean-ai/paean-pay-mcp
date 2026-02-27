import type { ChainId } from './chains/types.js';
import { randomBytes } from 'crypto';

export type PaymentStatus = 'pending' | 'confirmed' | 'expired';

export interface PaymentRequest {
  id: string;
  chain: ChainId;
  recipientAddress: string;
  amount: string;
  memo: string;
  status: PaymentStatus;
  createdAt: number;
  expiresAt: number;
  confirmedTxHash?: string;
  confirmedAt?: number;
}

function generateId(): string {
  return randomBytes(8).toString('hex');
}

class PaymentStore {
  private requests = new Map<string, PaymentRequest>();

  create(params: {
    chain: ChainId;
    recipientAddress: string;
    amount: string;
    memo?: string;
    expiresInMinutes?: number;
  }): PaymentRequest {
    const id = generateId();
    const now = Date.now();
    const expiresInMs = (params.expiresInMinutes ?? 30) * 60 * 1000;

    const request: PaymentRequest = {
      id,
      chain: params.chain,
      recipientAddress: params.recipientAddress,
      amount: params.amount,
      memo: params.memo || `pay-${id}`,
      status: 'pending',
      createdAt: now,
      expiresAt: now + expiresInMs,
    };

    this.requests.set(id, request);
    return request;
  }

  get(id: string): PaymentRequest | undefined {
    const req = this.requests.get(id);
    if (req && req.status === 'pending' && Date.now() > req.expiresAt) {
      req.status = 'expired';
    }
    return req;
  }

  confirm(id: string, txHash: string): PaymentRequest | undefined {
    const req = this.requests.get(id);
    if (!req) return undefined;
    req.status = 'confirmed';
    req.confirmedTxHash = txHash;
    req.confirmedAt = Date.now();
    return req;
  }

  list(filter?: { status?: PaymentStatus; chain?: ChainId }): PaymentRequest[] {
    const now = Date.now();
    const results: PaymentRequest[] = [];
    for (const req of this.requests.values()) {
      if (req.status === 'pending' && now > req.expiresAt) {
        req.status = 'expired';
      }
      if (filter?.status && req.status !== filter.status) continue;
      if (filter?.chain && req.chain !== filter.chain) continue;
      results.push(req);
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }
}

export const paymentStore = new PaymentStore();

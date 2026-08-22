import { PrismaClient, Suppression } from '@prisma/client';
import { getPrismaClient } from '../client.js';
import {
  SuppressionTargetType,
  SuppressionReason,
} from '../../types/index.js';
import { extractDomain } from '../../utils/url-utils.js';
import { logger } from '../../utils/logger.js';

export class SuppressionRepository {
  private db: PrismaClient;
  private log = logger.child('SuppressionRepository');

  constructor(client: PrismaClient = getPrismaClient()) {
    this.db = client;
  }

  public async addSuppression(params: {
    targetValue: string;
    targetType: SuppressionTargetType;
    reason: SuppressionReason;
    businessId?: string | null;
    notes?: string | null;
    createdBy?: string;
  }): Promise<Suppression> {
    let normalizedValue = params.targetValue.trim().toLowerCase();
    if (params.targetType === 'DOMAIN') {
      const dom = extractDomain(normalizedValue);
      if (dom) normalizedValue = dom;
    }

    return this.db.suppression.upsert({
      where: {
        unique_suppression_target: {
          targetType: params.targetType,
          targetValue: normalizedValue,
        },
      },
      create: {
        targetValue: normalizedValue,
        targetType: params.targetType,
        reason: params.reason,
        businessId: params.businessId || null,
        notes: params.notes || null,
        createdBy: params.createdBy || 'HUMAN_OPERATOR',
      },
      update: {
        reason: params.reason,
        businessId: params.businessId || null,
        notes: params.notes || null,
        createdBy: params.createdBy || 'HUMAN_OPERATOR',
      },
    });
  }

  public async isSuppressed(targetValue: string, targetType?: SuppressionTargetType): Promise<boolean> {
    const normalized = targetValue.trim().toLowerCase();
    const where: any = { targetValue: normalized };
    if (targetType) {
      where.targetType = targetType;
    }

    const count = await this.db.suppression.count({ where });
    return count > 0;
  }

  public async checkEntitySuppression(params: {
    email?: string | null;
    websiteUrl?: string | null;
    phone?: string | null;
    businessName?: string | null;
    businessId?: string | null;
  }): Promise<{ suppressed: boolean; reason?: string; match?: string }> {
    const targets: { value: string; type: SuppressionTargetType }[] = [];

    if (params.email) {
      const normalizedEmail = params.email.trim().toLowerCase();
      targets.push({ value: normalizedEmail, type: 'EMAIL' });

      // Also check email domain suppression
      if (normalizedEmail.includes('@')) {
        const domain = normalizedEmail.split('@')[1];
        targets.push({ value: domain, type: 'DOMAIN' });
      }
    }

    if (params.websiteUrl) {
      const domain = extractDomain(params.websiteUrl);
      if (domain) {
        targets.push({ value: domain.toLowerCase(), type: 'DOMAIN' });
      }
    }

    if (params.phone) {
      const digitsOnly = params.phone.replace(/\D/g, '');
      if (digitsOnly.length >= 7) {
        targets.push({ value: params.phone.trim().toLowerCase(), type: 'PHONE' });
      }
    }

    if (params.businessName) {
      targets.push({ value: params.businessName.trim().toLowerCase(), type: 'BUSINESS' });
    }

    for (const target of targets) {
      const match = await this.db.suppression.findFirst({
        where: {
          targetType: target.type,
          targetValue: target.value,
        },
      });

      if (match) {
        return {
          suppressed: true,
          reason: match.reason,
          match: `${target.type}:${target.value}`,
        };
      }
    }

    if (params.businessId) {
      const match = await this.db.suppression.findFirst({
        where: { businessId: params.businessId },
      });
      if (match) {
        return {
          suppressed: true,
          reason: match.reason,
          match: `BUSINESS_ID:${params.businessId}`,
        };
      }
    }

    return { suppressed: false };
  }

  public async getAllSuppressions(limit: number = 50): Promise<Suppression[]> {
    return this.db.suppression.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  public async removeSuppression(id: string): Promise<boolean> {
    try {
      await this.db.suppression.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

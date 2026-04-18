import { createLogger } from '@wobox/core';

export interface CampaignReportOptions {
  campaignId?: string;
}

export async function run(_opts: CampaignReportOptions): Promise<void> {
  const log = createLogger('campaign-report');
  log.warn('stub: conversion por approach/channel/buyer_persona, tasa de respuesta, ROI');
}

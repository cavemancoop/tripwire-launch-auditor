import type { OutcomeKey } from '@launch-auditor/scoring';
import type { Hex } from 'viem';

export interface BlockPin {
  number: number;
  hash: string;
  /** ISO 8601 UTC */
  timestamp: string;
}

/** the object that gets canonicalized + hashed + signed */
export interface ReportContent {
  version: 'report/v0';
  chainId: number;
  tokenAddress: string;
  launchId: string | null;
  reportTime: string; // ISO 8601 UTC
  trigger: string;
  blockPin: BlockPin;
  forecaster: string;
  forecasterVersion: string;
  outcomeRuleVersion: string;
  probabilities: Partial<Record<OutcomeKey, number>>;
  /** feature names that were null when this report was produced (§8.2) */
  coverage: string[];
}

export interface ReportDraft {
  content: ReportContent;
  canonicalJson: string;
  reportHash: Hex;
  signature: Hex | null;
  signer: Hex | null;
  validatorPassed: boolean;
  validatorFailures: string[];
}

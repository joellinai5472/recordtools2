
export enum Level {
  LV1 = '關1',
  LV2 = '關2',
}

export const LevelLabels: Record<Level, string> = {
  [Level.LV1]: '【Level 1】PREP 筆記',
  [Level.LV2]: '【Level 2】錄音與 AI 回饋',
};

export enum MicStatus {
  UNAUTHORIZED = '未授權',
  AVAILABLE = '可用',
  UNAVAILABLE = '不可用',
  RECORDING = '錄音中',
  PAUSED = '暫停中'
}

export interface AppSettings {
  userId: string;
  rememberMe: boolean;
  level: Level;
  targetDuration: number;
}

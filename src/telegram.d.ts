interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: { id: number; first_name: string; last_name?: string; username?: string; language_code?: string };
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams?: Record<string, string>;
  isExpanded?: boolean;
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  isFullscreen?: boolean;
  close(): void;
  isVersionAtLeast?(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  disableVerticalSwipes?(): void;
  openTelegramLink?(url: string): void;
  openLink?(url: string): void;
  showScanQrPopup?(params: { text?: string }, callback?: (text: string) => boolean | void): void;
  closeScanQrPopup?(): void;
  onEvent?(event: string, handler: (...args: unknown[]) => void): void;
  offEvent?(event: string, handler: (...args: unknown[]) => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  /** Bot API 8.0: bosh ekranga yorliq. */
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(callback: (status: "unsupported" | "unknown" | "added" | "missed") => void): void;
  /** Bot API 6.9: foydalanuvchi qurilmalari orasida sinxron xotira. */
  CloudStorage?: {
    setItem(key: string, value: string, callback?: (error: string | null, ok?: boolean) => void): void;
    getItem(key: string, callback: (error: string | null, value?: string) => void): void;
  };
  /** Bot API 8.0: Telegram’ning o‘z joylashuv xizmati. */
  LocationManager?: {
    isInited: boolean;
    isLocationAvailable: boolean;
    isAccessRequested: boolean;
    isAccessGranted: boolean;
    init(callback?: () => void): void;
    getLocation(callback: (data: { latitude: number; longitude: number; horizontal_accuracy?: number | null } | null) => void): void;
    openSettings(): void;
  };
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged?(): void;
  };
}
interface Window {
  Telegram?: { WebApp: TelegramWebApp };
  BarcodeDetector?: new (options: { formats: string[] }) => {
    detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
  };
}

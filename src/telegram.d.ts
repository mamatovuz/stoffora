type TelegramBottomButton = {
  text: string;
  color?: string;
  textColor?: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  /** SecondaryButton: asosiy tugmaga nisbatan joylashuvi. */
  position?: "left" | "right" | "top" | "bottom";
  setText(text: string): TelegramBottomButton;
  onClick(handler: () => void): TelegramBottomButton;
  offClick(handler: () => void): TelegramBottomButton;
  show(): TelegramBottomButton;
  hide(): TelegramBottomButton;
  enable(): TelegramBottomButton;
  disable(): TelegramBottomButton;
  showProgress(leaveActive?: boolean): TelegramBottomButton;
  hideProgress(): TelegramBottomButton;
  setParams(params: {
    text?: string;
    color?: string;
    text_color?: string;
    has_shine_effect?: boolean;
    position?: "left" | "right" | "top" | "bottom";
    is_active?: boolean;
    is_visible?: boolean;
  }): TelegramBottomButton;
};

type TelegramPopupButton = { id?: string; type?: "default" | "ok" | "close" | "cancel" | "destructive"; text?: string };
type TelegramSafeArea = { top: number; bottom: number; left: number; right: number };
type TelegramKeyStorage = {
  setItem(key: string, value: string, callback?: (error: string | null, ok?: boolean) => void): void;
  getItem(key: string, callback: (error: string | null, value?: string | null, canRestore?: boolean) => void): void;
  removeItem(key: string, callback?: (error: string | null, ok?: boolean) => void): void;
};
type TelegramSensor = {
  isStarted: boolean;
  x: number;
  y: number;
  z: number;
  start(params: { refresh_rate?: number }, callback?: (started: boolean) => void): void;
  stop(callback?: (stopped: boolean) => void): void;
};

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: { id: number; first_name: string; last_name?: string; username?: string; language_code?: string; is_premium?: boolean };
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
  setBottomBarColor?(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  disableVerticalSwipes?(): void;
  openTelegramLink?(url: string): void;
  openLink?(url: string, options?: { try_instant_view?: boolean }): void;
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
  /** Bot API 7.0: «⋯» menyusidagi «Sozlamalar». */
  SettingsButton?: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  MainButton?: TelegramBottomButton;
  /** Bot API 7.10 */
  SecondaryButton?: TelegramBottomButton;
  showPopup?(params: { title?: string; message: string; buttons?: TelegramPopupButton[] }, callback?: (id: string) => void): void;
  showAlert?(message: string, callback?: () => void): void;
  showConfirm?(message: string, callback?: (ok: boolean) => void): void;
  /** Bot API 8.0: bosh ekranga yorliq. */
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(callback: (status: "unsupported" | "unknown" | "added" | "missed") => void): void;
  /** Bot API 8.0: faylni telefonga yuklab olish. */
  downloadFile?(params: { url: string; file_name: string }, callback?: (accepted: boolean) => void): void;
  /** Bot API 8.0: tayyorlangan xabarni ulashish. */
  shareMessage?(messageId: string, callback?: (sent: boolean) => void): void;
  /** Bot API 8.0: emoji-status (Premium). */
  setEmojiStatus?(customEmojiId: string, params?: { duration?: number }, callback?: (set: boolean) => void): void;
  requestEmojiStatusAccess?(callback?: (allowed: boolean) => void): void;
  /** Bot API 6.9: bot xabar yozishi uchun ruxsat. */
  requestWriteAccess?(callback?: (allowed: boolean) => void): void;
  /** Bot API 8.0 */
  safeAreaInset?: TelegramSafeArea;
  contentSafeAreaInset?: TelegramSafeArea;
  /** Bot API 6.9: foydalanuvchi qurilmalari orasida sinxron xotira. */
  CloudStorage?: TelegramKeyStorage;
  /** Bot API 9.0: qurilmadagi doimiy xotira. */
  DeviceStorage?: TelegramKeyStorage & { clear?(callback?: (error: string | null) => void): void };
  /** Bot API 9.0: shifrlangan xotira (Keychain / Keystore). */
  SecureStorage?: TelegramKeyStorage & { clear?(callback?: (error: string | null) => void): void };
  /** Bot API 7.2: telefon biometriyasi. */
  BiometricManager?: {
    isInited: boolean;
    isBiometricAvailable: boolean;
    biometricType: "finger" | "face" | "unknown";
    isAccessRequested: boolean;
    isAccessGranted: boolean;
    isBiometricTokenSaved: boolean;
    deviceId: string;
    init(callback?: () => void): void;
    requestAccess(params: { reason?: string }, callback?: (granted: boolean) => void): void;
    authenticate(params: { reason?: string }, callback?: (ok: boolean, token?: string) => void): void;
    updateBiometricToken(token: string, callback?: (updated: boolean) => void): void;
    openSettings(): void;
  };
  /** Bot API 8.0: harakat sensorlari. */
  Accelerometer?: TelegramSensor;
  Gyroscope?: TelegramSensor;
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

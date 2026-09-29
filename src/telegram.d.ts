interface TelegramWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
}
interface Window {
  Telegram?: { WebApp: TelegramWebApp };
  BarcodeDetector?: new (options: { formats: string[] }) => {
    detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
  };
}

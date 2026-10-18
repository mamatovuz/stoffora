import { forwardRef, type ReactNode } from "react";
import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from "react-native";
import { translate, useLang, type Lang } from "@/lib/i18n";

/*
 * Tarjima qilinadigan Text va TextInput (react-native o‘rniga butun ilovada shular ishlatiladi).
 * O‘zbekchada — o‘zgarishsiz; ruschada matn lug‘at/andozalar bo‘yicha almashtiriladi.
 * Faqat matn va raqamdan iborat bolalar bitta satr qilib tarjima qilinadi («{n} ta so‘rov» andozasi ishlashi uchun).
 */

function translateChildren(children: ReactNode, lang: Lang): ReactNode {
  if (lang === "uz" || children === null || children === undefined) return children;
  if (typeof children === "string") return translate(children, lang);
  if (Array.isArray(children)) {
    const plain = children.every((c) => typeof c === "string" || typeof c === "number" || c === null || c === undefined || typeof c === "boolean");
    if (plain) {
      // Avval butun satr (andozalar uchun), bo‘lmasa — har bir matn bo‘lagi alohida («12/20» + « ish kuni»).
      const whole = children.filter((c) => typeof c === "string" || typeof c === "number").join("");
      const done = translate(whole, lang);
      if (done !== whole) return done;
    }
    return children.map((c) => (typeof c === "string" ? translate(c, lang) : c));
  }
  return children;
}

export const Text = forwardRef<RNText, TextProps>(function Text({ children, ...rest }, ref) {
  const lang = useLang();
  return (
    <RNText ref={ref} {...rest}>
      {translateChildren(children, lang)}
    </RNText>
  );
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ placeholder, ...rest }, ref) {
  const lang = useLang();
  return <RNTextInput ref={ref} {...rest} placeholder={placeholder && lang !== "uz" ? translate(placeholder, lang) : placeholder} />;
});
// useRef<TextInput>(null) kabi tur sifatida ham ishlatiladi (qiymat + tur bir nomda — TS’da ruxsat).
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Text = RNText;
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type TextInput = RNTextInput;

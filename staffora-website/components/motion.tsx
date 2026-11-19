"use client";

import React, { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  type TargetAndTransition,
  type Variants,
} from "framer-motion";

export const easeOut = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ */
/*  useReducedMotionSafe — SSR bilan mos (hydration xatosiz)           */
/*  Server va birinchi client render: false, keyin haqiqiy qiymat.     */
/* ------------------------------------------------------------------ */

const reducedQuery = "(prefers-reduced-motion: reduce)";

function subscribeReduced(callback: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const media = window.matchMedia(reducedQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function useReducedMotionSafe() {
  return useSyncExternalStore(
    subscribeReduced,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(reducedQuery).matches,
    () => false,
  );
}

/* ------------------------------------------------------------------ */
/*  Scroll reveal engine                                               */
/*                                                                     */
/*  IntersectionObserver (whileInView) tez scroll yoki telefon         */
/*  inersiyasida elementni "sakrab o‘tib" ketadi: element ekran ostidan */
/*  to‘g‘ridan-to‘g‘ri ekran ustiga o‘tsa, kesishuv hodisasi umuman     */
/*  chiqmaydi va blok abadiy ko‘rinmay qoladi. Shu sabab bitta umumiy  */
/*  scroll tinglovchi: elementning tepasi ekranning 90% chizig‘idan     */
/*  o‘tganda (yoki allaqachon o‘tib ketgan bo‘lsa) u ochiladi.         */
/*  Bir kadrda birga ochilganlar (masalan, bitta qatordagi kartalar)   */
/*  navbat bilan, telefonda esa har biri o‘z navbatida alohida chiqadi. */
/* ------------------------------------------------------------------ */

type RevealEntry = { el: Element; group: object | null; stagger: number; delay: number; reveal: (delay: number) => void };

const pending = new Set<RevealEntry>();
let frame = 0;
let listening = false;
const REVEAL_LINE = 0.9;
const MAX_STAGGER_STEPS = 6;

function flushReveals() {
  frame = 0;
  if (!pending.size) return;
  const line = window.innerHeight * REVEAL_LINE;
  const ready: { entry: RevealEntry; passed: boolean }[] = [];
  for (const entry of pending) {
    if (!entry.el.isConnected) {
      pending.delete(entry);
      continue;
    }
    const box = entry.el.getBoundingClientRect();
    // display:none (masalan, faqat mobil yoki faqat desktop bloki) — ko‘ringanida tekshiriladi.
    if (!box.width && !box.height) continue;
    if (box.top < line) ready.push({ entry, passed: box.bottom <= 0 });
  }
  if (!ready.length) return;
  ready.sort((a, b) => (a.entry.el.compareDocumentPosition(b.entry.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const order = new Map<object, number>();
  for (const { entry, passed } of ready) {
    pending.delete(entry);
    const key = entry.group || entry;
    const index = order.get(key) || 0;
    order.set(key, index + 1);
    // Ekran ustida qolib ketganlar kutmasdan ochiladi — foydalanuvchi qaytib chiqsa, bo‘sh joy ko‘rmaydi.
    entry.reveal(passed ? 0 : entry.delay + Math.min(index, MAX_STAGGER_STEPS) * entry.stagger);
  }
}

function scheduleReveals() {
  if (!frame) frame = window.requestAnimationFrame(flushReveals);
}

function registerReveal(entry: RevealEntry) {
  pending.add(entry);
  if (!listening) {
    listening = true;
    window.addEventListener("scroll", scheduleReveals, { passive: true });
    window.addEventListener("resize", scheduleReveals);
    window.addEventListener("load", scheduleReveals);
  }
  scheduleReveals();
  return () => {
    pending.delete(entry);
  };
}

type RevealGroupValue = { key: object; stagger: number; delay: number };
const RevealGroup = createContext<RevealGroupValue | null>(null);

/** Element ko‘rinish chizig‘idan o‘tganini bildiradi (bir marta). `delay` — ochilish kechikishi (soniya). */
export function useScrollReveal<T extends Element>(delay = 0) {
  const ref = useRef<T>(null);
  const group = useContext(RevealGroup);
  const reduced = useReducedMotionSafe();
  const [state, setState] = useState({ shown: false, delay: 0 });
  const shown = state.shown;
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    return registerReveal({
      el,
      group: group?.key ?? null,
      stagger: group?.stagger ?? 0,
      delay: (group?.delay ?? 0) + delay,
      reveal: (at) => setState({ shown: true, delay: at }),
    });
  }, [group, delay, shown]);
  return { ref, shown: reduced || shown, delay: reduced ? 0 : state.delay, reduced };
}

const visible = { opacity: 1, x: 0, y: 0 };

/* ------------------------------------------------------------------ */
/*  Reveal                                                              */
/* ------------------------------------------------------------------ */

export function Reveal({
  children,
  className = "",
  delay = 0,
  direction = "up",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
}) {
  const { ref, shown, delay: at, reduced } = useScrollReveal<HTMLDivElement>(delay);
  const offset = { up: { y: 28 }, down: { y: -28 }, left: { x: 40 }, right: { x: -40 }, none: {} }[direction];
  const hidden = { opacity: 0, ...offset };
  return (
    <motion.div
      ref={ref}
      className={`motion-reveal ${className}`}
      initial={hidden}
      animate={shown ? visible : hidden}
      transition={reduced ? { duration: 0 } : { duration: 0.7, delay: at, ease: easeOut }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  SlideIn — yo‘nalishli kirish                                       */
/* ------------------------------------------------------------------ */

const slideOffsets = {
  left: { x: -60, y: 0 },
  right: { x: 60, y: 0 },
  up: { x: 0, y: 50 },
  down: { x: 0, y: -50 },
};

export function SlideIn({
  children,
  className = "",
  direction = "up",
  delay = 0,
  duration = 0.7,
}: {
  children: React.ReactNode;
  className?: string;
  direction: "left" | "right" | "up" | "down";
  delay?: number;
  duration?: number;
}) {
  const { ref, shown, delay: at, reduced } = useScrollReveal<HTMLDivElement>(delay);
  const hidden = { opacity: 0, ...slideOffsets[direction] };
  return (
    <motion.div
      ref={ref}
      className={`motion-reveal ${className}`}
      initial={hidden}
      animate={shown ? visible : hidden}
      transition={reduced ? { duration: 0 } : { duration, delay: at, ease: easeOut }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  StaggerReveal + StaggerItem                                         */
/*  Har bir StaggerItem o‘zi kuzatiladi: desktopda bitta qatordagilar  */
/*  navbat bilan, telefonda (bitta ustun) har biri scroll bilan        */
/*  alohida ochiladi.                                                   */
/* ------------------------------------------------------------------ */

export function StaggerReveal({
  children,
  className = "",
  stagger = 0.08,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const key = useRef({}).current;
  // Skill qoidasi: navbat oralig‘i 0.05–0.10 s — sekinroq bo‘lsa "sudraladi".
  const value = useMemo(() => ({ key, stagger: Math.min(0.1, Math.max(0.05, stagger)), delay }), [key, stagger, delay]);
  return (
    <RevealGroup.Provider value={value}>
      <div className={className}>{children}</div>
    </RevealGroup.Provider>
  );
}

const enter = (hidden: TargetAndTransition, duration: number): Variants => ({
  hidden,
  visible: (delay: number = 0) => ({ opacity: 1, x: 0, y: 0, scale: 1, transition: { duration, delay, ease: easeOut } }),
});

// Kirish uslublari: rise — oddiy, pop — kattalashib, lift — balandroqdan, right/left — yondan
const itemVariants = {
  rise: enter({ opacity: 0, y: 24 }, 0.55),
  pop: enter({ opacity: 0, y: 30, scale: 0.95 }, 0.6),
  lift: enter({ opacity: 0, y: 56, scale: 0.97 }, 0.75),
  right: enter({ opacity: 0, x: 44 }, 0.6),
  left: enter({ opacity: 0, x: -44 }, 0.6),
} satisfies Record<string, Variants>;

const staggerItemReduced: Variants = {
  hidden: { opacity: 0, x: 0, y: 0, scale: 1 },
  visible: { opacity: 1, x: 0, y: 0, scale: 1, transition: { duration: 0 } },
};

export function StaggerItem({ children, className = "", variant = "rise" }: { children: React.ReactNode; className?: string; variant?: keyof typeof itemVariants }) {
  const { ref, shown, delay, reduced } = useScrollReveal<HTMLDivElement>();
  return (
    <motion.div
      ref={ref}
      className={`motion-reveal ${className}`}
      variants={reduced ? staggerItemReduced : itemVariants[variant]}
      initial="hidden"
      animate={shown ? "visible" : "hidden"}
      custom={delay}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  ScrollScale — bo‘limga kirishda scroll bilan kattalashish          */
/* ------------------------------------------------------------------ */

export function ScrollScale({
  children,
  className = "",
  innerClassName = "",
  from = 0.94,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  from?: number;
}) {
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 30%"] });
  const scale = useTransform(scrollYProgress, [0, 1], [from, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [48, 0]);
  return (
    <div ref={ref} className={className}>
      <motion.div className={innerClassName} style={{ scale: reduced ? 1 : scale, y: reduced ? 0 : y }}>
        {children}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ParallaxLayer                                                       */
/* ------------------------------------------------------------------ */

export function ParallaxLayer({
  children,
  className = "",
  speed = 0.3,
}: {
  children: React.ReactNode;
  className?: string;
  speed?: number;
}) {
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const rawY = useTransform(scrollYProgress, [0, 1], [speed * 100, speed * -100]);
  const y = useSpring(rawY, { stiffness: 100, damping: 30, mass: 0.5 });
  return (
    <motion.div ref={ref} className={className} style={{ y: reduced ? 0 : y }}>
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  ScrollProgress                                                      */
/* ------------------------------------------------------------------ */

export function ScrollProgress() {
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 180, damping: 34, mass: 0.25 });
  if (reduced) return null;
  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/*  CountUp — ko‘rinishga kirganda son sanaladi                        */
/* ------------------------------------------------------------------ */

export function CountUp({
  value,
  suffix = "",
  prefix = "",
  duration = 2,
  className = "",
  locale,
  format,
  delay = 0,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
  locale?: string;
  format?: (value: number) => string;
  delay?: number;
}) {
  const { ref, shown, reduced } = useScrollReveal<HTMLSpanElement>();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!shown || reduced) return;
    const startTime = performance.now() + delay * 1000;
    const durationMs = duration * 1000;
    let raf = 0;
    function tick(now: number) {
      const progress = Math.max(0, Math.min((now - startTime) / durationMs, 1));
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shown, value, duration, delay, reduced]);

  const current = reduced ? value : display;
  return (
    <span ref={ref} className={className}>
      {prefix}
      {format ? format(current) : current.toLocaleString(locale)}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  TextReveal — so‘zma-so‘z ochilish                                  */
/* ------------------------------------------------------------------ */

export function TextReveal({
  text,
  className = "",
  mode = "word",
  stagger = 0.04,
  delay = 0,
}: {
  text: string;
  className?: string;
  mode?: "word" | "letter";
  stagger?: number;
  delay?: number;
}) {
  const { ref, shown, delay: at, reduced } = useScrollReveal<HTMLSpanElement>(delay);
  const pieces = mode === "word" ? text.split(" ") : text.split("");
  const separator = mode === "word" ? " " : "";
  const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: reduced ? 0 : stagger, delayChildren: reduced ? 0 : at } },
  };
  const child: Variants = {
    hidden: { opacity: 0, y: reduced ? 0 : 16 },
    visible: { opacity: 1, y: 0, transition: reduced ? { duration: 0 } : { duration: 0.4, ease: easeOut } },
  };
  return (
    <motion.span ref={ref} className={`text-reveal ${className}`} variants={container} initial="hidden" animate={shown ? "visible" : "hidden"}>
      {/* Bo‘shliq so‘z ichida emas, so‘zlar orasida: inline-block oxiridagi probel yo‘qoladi
          va telefonda qatorga sig‘gan so‘zlar qo‘shilib ketardi ("Biznesboshqaruvini"). */}
      {pieces.map((piece, i) => (
        <Fragment key={`${piece}-${i}`}>
          <motion.span className="motion-reveal" variants={child}>
            {piece}
          </motion.span>
          {i < pieces.length - 1 ? separator : null}
        </Fragment>
      ))}
    </motion.span>
  );
}

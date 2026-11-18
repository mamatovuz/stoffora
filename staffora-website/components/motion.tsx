"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  motion,
  useInView,
  useScroll,
  useTransform,
  useSpring,
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

const shown = { opacity: 1, x: 0, y: 0 };

/* ------------------------------------------------------------------ */
/*  Reveal                                                              */
/* ------------------------------------------------------------------ */

export function Reveal({
  children,
  className = "",
  delay = 0,
  direction = "up",
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  once?: boolean;
}) {
  const reduced = useReducedMotionSafe();
  const offset = { up: { y: 28 }, down: { y: -28 }, left: { x: 40 }, right: { x: -40 }, none: {} }[direction];
  return (
    <motion.div
      className={`motion-reveal ${className}`}
      initial={{ opacity: 0, ...offset }}
      whileInView={shown}
      animate={reduced ? shown : undefined}
      viewport={{ once, margin: "-60px" }}
      transition={reduced ? { duration: 0 } : { duration: 0.7, delay, ease: easeOut }}
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
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  direction: "left" | "right" | "up" | "down";
  delay?: number;
  duration?: number;
  once?: boolean;
}) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.div
      className={`motion-reveal ${className}`}
      initial={{ opacity: 0, ...slideOffsets[direction] }}
      whileInView={shown}
      animate={reduced ? shown : undefined}
      viewport={{ once, margin: "-50px" }}
      transition={reduced ? { duration: 0 } : { duration, delay, ease: easeOut }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  StaggerReveal + StaggerItem                                         */
/* ------------------------------------------------------------------ */

export function StaggerReveal({
  children,
  className = "",
  stagger = 0.08,
  delay = 0,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  once?: boolean;
}) {
  const reduced = useReducedMotionSafe();
  const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: reduced ? 0 : stagger, delayChildren: reduced ? 0 : delay } },
  };
  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      whileInView="visible"
      animate={reduced ? "visible" : undefined}
      viewport={{ once, margin: "-50px" }}
    >
      {children}
    </motion.div>
  );
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: easeOut } },
};

// Kirish uslublari: rise — oddiy, pop — kattalashib, lift — balandroqdan, right/left — yondan
const itemVariants: Record<"rise" | "pop" | "lift" | "right" | "left", Variants> = {
  rise: staggerItem,
  pop: { hidden: { opacity: 0, y: 30, scale: 0.95 }, visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: easeOut } } },
  lift: { hidden: { opacity: 0, y: 56, scale: 0.97 }, visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.75, ease: easeOut } } },
  right: { hidden: { opacity: 0, x: 44 }, visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easeOut } } },
  left: { hidden: { opacity: 0, x: -44 }, visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easeOut } } },
};

const staggerItemReduced: Variants = {
  hidden: { opacity: 0, x: 0, y: 0, scale: 1 },
  visible: { opacity: 1, x: 0, y: 0, scale: 1, transition: { duration: 0 } },
};

export function StaggerItem({ children, className = "", variant = "rise" }: { children: React.ReactNode; className?: string; variant?: keyof typeof itemVariants }) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.div className={`motion-reveal ${className}`} variants={reduced ? staggerItemReduced : itemVariants[variant]}>
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
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!isInView || reduced) return;
    const startTime = performance.now() + delay * 1000;
    const durationMs = duration * 1000;
    let frame = 0;
    function tick(now: number) {
      const progress = Math.max(0, Math.min((now - startTime) / durationMs, 1));
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isInView, value, duration, delay, reduced]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {format ? format(reduced ? value : display) : (reduced ? value : display).toLocaleString(locale)}
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
  const reduced = useReducedMotionSafe();
  const pieces = mode === "word" ? text.split(" ") : text.split("");
  const separator = mode === "word" ? " " : "";
  const container: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: reduced ? 0 : stagger, delayChildren: reduced ? 0 : delay } },
  };
  const child: Variants = {
    hidden: { opacity: 0, y: reduced ? 0 : 16 },
    visible: { opacity: 1, y: 0, transition: reduced ? { duration: 0 } : { duration: 0.4, ease: easeOut } },
  };
  return (
    <motion.span
      className={`text-reveal ${className}`}
      variants={container}
      initial="hidden"
      whileInView="visible"
      animate={reduced ? "visible" : undefined}
      viewport={{ once: true, margin: "-40px" }}
    >
      {pieces.map((piece, i) => (
        <motion.span key={`${piece}-${i}`} className="motion-reveal" variants={child}>
          {piece}
          {i < pieces.length - 1 ? separator : ""}
        </motion.span>
      ))}
    </motion.span>
  );
}

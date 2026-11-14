"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  motion,
  useReducedMotion,
  useInView,
  useScroll,
  useTransform,
  useSpring,
  type Variant,
  type Variants,
} from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Reveal — improved existing component                              */
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
  const reduced = useReducedMotion();
  const offset = { up: { y: 28 }, down: { y: -28 }, left: { x: 40 }, right: { x: -40 }, none: {} }[direction];
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, ...offset }}
      whileInView={reduced ? {} : { opacity: 1, x: 0, y: 0 }}
      viewport={{ once, margin: "-60px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  SlideIn — directional slide with fade                             */
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
  const reduced = useReducedMotion();
  const offset = slideOffsets[direction];
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, ...offset }}
      whileInView={reduced ? {} : { opacity: 1, x: 0, y: 0 }}
      viewport={{ once, margin: "-50px" }}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  StaggerReveal — staggers children animations                       */
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
  const reduced = useReducedMotion();
  const container = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: reduced ? 0 : stagger,
        delayChildren: reduced ? 0 : delay,
      },
    },
  };
  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: "-50px" }}
    >
      {children}
    </motion.div>
  );
}

/* Matching child variant to use inside StaggerReveal */
export const staggerItem = {
  hidden: { opacity: 0, y: 24 } as Variant,
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  } as Variant,
};

export function StaggerItem({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={
        reduced
          ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
          : staggerItem
      }
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  ParallaxLayer — parallax scrolling effect                          */
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
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const rawY = useTransform(scrollYProgress, [0, 1], [speed * 100, speed * -100]);
  const y = useSpring(rawY, { stiffness: 100, damping: 30, mass: 0.5 });

  return (
    <motion.div
      ref={ref}
      className={className}
      style={reduced ? {} : { y }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  CountUp — animates a number counting when in view                  */
/* ------------------------------------------------------------------ */

export function CountUp({
  value,
  suffix = "",
  prefix = "",
  duration = 2,
  className = "",
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const [display, setDisplay] = useState(reduced ? value : 0);

  useEffect(() => {
    if (!isInView || reduced) {
      if (reduced) setDisplay(value);
      return;
    }
    let start = 0;
    const end = value;
    const startTime = performance.now();
    const durationMs = duration * 1000;

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * eased);
      setDisplay(current);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [isInView, value, duration, reduced]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display.toLocaleString()}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  TextReveal — reveals text word-by-word or letter-by-letter         */
/* ------------------------------------------------------------------ */

export function TextReveal({
  text,
  className = "",
  mode = "word",
  stagger = 0.04,
  delay = 0,
  as: Tag = "p",
}: {
  text: string;
  className?: string;
  mode?: "word" | "letter";
  stagger?: number;
  delay?: number;
  as?: "p" | "h1" | "h2" | "h3" | "span" | "div";
}) {
  const reduced = useReducedMotion();
  const pieces = mode === "word" ? text.split(" ") : text.split("");
  const separator = mode === "word" ? "\u00A0" : "";

  const container = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: reduced ? 0 : stagger,
        delayChildren: reduced ? 0 : delay,
      },
    },
  };

  const child: Variants = {
    hidden: reduced ? { opacity: 1 } : { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
    },
  };

  return (
    <motion.span
      className={className}
      style={{ display: "inline-flex", flexWrap: "wrap" }}
      variants={container}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
    >
      {pieces.map((piece, i) => (
        <motion.span key={i} variants={child} style={{ display: "inline-block" }}>
          {piece}
          {i < pieces.length - 1 ? separator : ""}
        </motion.span>
      ))}
    </motion.span>
  );
}

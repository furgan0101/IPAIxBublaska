"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger offset (seconds) applied as transition-delay once revealed. */
  delay?: number;
}

/**
 * Fades + lifts its children into view the first time they cross the viewport.
 * Pairs with the `.cl-reveal` / `.is-visible` CSS; reduced-motion shows content
 * immediately. Observes the landing's inner scroll container, not the document.
 */
export default function Reveal({
  children,
  className = "",
  delay = 0,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No observer support — never leave content hidden.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );

    observer.observe(node);

    // Safety net: if the observer never delivers (e.g. a tab that is opened in
    // the background and never focused), reveal anyway so nothing stays at
    // opacity:0 once the section is on screen.
    const fallback = window.setTimeout(() => setVisible(true), 2500);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`cl-reveal ${visible ? "is-visible" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}

'use client';

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useV2Theme } from '../providers/v2-theme-context';

/*
 * Performant Canvas-based Snow Effect
 * Best Practice: useAnimationFrame loop + Offscreen drawing if needed (simple canvas is fast enough for < 500 particles)
 *
 * Note: The mounted state workaround was removed because the theme is now passed
 * from the server via cookies, ensuring SSR/CSR consistency.
 */

interface Snowflake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  wind: number;

  angle: number;
}

export const SnowEffect: React.FC = () => {
  const { theme } = useV2Theme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(undefined);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (theme !== 'santa' || reducedMotion || !canvasRef.current) return;
    // During hydration the hook still reports false, so check the query directly too.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const particles: Snowflake[] = [];
    const particleCount = width < 768 ? 80 : 150; // Increased mobile count for visibility

    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 3 + 1,
        speed: Math.random() * 1 + 0.5,
        wind: Math.random() * 0.5 - 0.25,
        angle: Math.random() * Math.PI * 2,
      });
    }

    const update = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw gradient overlay for festive feel (optional, can be CSS)
      // Keeping it simple in canvas to just draw snow

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();

      for (let i = 0; i < particleCount; i++) {
        const p = particles[i];

        // Move
        p.y += p.speed;
        p.x += p.wind + Math.sin(p.angle) * 0.5;
        p.angle += 0.01;

        // Reset if out of bounds
        if (p.y > height) {
          p.y = -10;
          p.x = Math.random() * width;
        }
        if (p.x > width + 5) {
          p.x = -5;
        } else if (p.x < -5) {
          p.x = width + 5;
        }

        // Draw
        ctx.moveTo(p.x + p.radius, p.y);
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      }

      ctx.fill();
      requestRef.current = requestAnimationFrame(update);
    };

    update();

    let resizeTimer: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;

        // Clamp existing particles to new viewport
        // (Optional: implementation choice, but good practice per review)
      }, 150);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(resizeTimer);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [theme, reducedMotion]);

  if (theme !== 'santa' || reducedMotion) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-100 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
      {/* Festive Lights Decoration - CSS Overlay */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-red-500/20 via-green-500/20 to-red-500/20 blur-xs" />
    </div>
  );
};

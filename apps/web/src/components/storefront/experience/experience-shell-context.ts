'use client';
import { createContext } from 'react';
import type { ExperienceShellController } from './experience-shell-controller';
export const ExperienceShellContext =
  createContext<ExperienceShellController | null>(null);

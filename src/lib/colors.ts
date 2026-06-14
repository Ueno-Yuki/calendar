import type { FamilyRole } from '@/types';

export interface FamilyColor {
  main: string;
  light: string;
  label: string;
}

export const FAMILY_COLORS: Record<FamilyRole, FamilyColor> = {
  mother:  { main: '#EC4899', light: '#FCE7F3', label: '母' },
  father:  { main: '#3B82F6', light: '#DBEAFE', label: '父' },
  me:      { main: '#22C55E', light: '#DCFCE7', label: '裕' },
  brother: { main: '#F97316', light: '#FFEDD5', label: '雅' },
};

export const DISPLAY_ORDER: FamilyRole[] = ['mother', 'father', 'me', 'brother'];

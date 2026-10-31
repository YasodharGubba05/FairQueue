import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names and let later Tailwind classes win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Prices are stored in cents so money is never a float. */
export function formatPrice(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

/** mm:ss, for hold and pass countdowns. */
export function formatCountdown(msRemaining: number) {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * A stable gradient per event, so cards have their own artwork without us
 * shipping any real artist images or brand logos.
 */
export function gradientFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  const from = hash;
  const to = (hash + 58) % 360;
  return `linear-gradient(135deg, hsl(${from} 85% 58%), hsl(${to} 85% 46%))`;
}

/**
 * Tidy a shouted event name for display.
 *
 * Providers hand back whatever the promoter typed, so one page of events
 * arrives as ALL CAPS, Title Case and everything between. Left alone it reads
 * as broken data — "LOL TOLHURST in CONVERSATION" looks like a bug rather than
 * a real person (Lol Tolhurst, of The Cure).
 *
 * The hard part is that bands style their own names on purpose. TOOTH, KoRn
 * and SOPHIE are not mistakes, and flattening them would be worse than the
 * shouting. So the rule is deliberately conservative: a name is only treated
 * as shouted when at least two separate words are in caps. One capitalised
 * word is a styling choice and is left exactly as it came.
 *
 * This is display only. The stored name stays as the provider gave it, which
 * matters because we link to their page for the same event.
 */
const PRESERVED_TOKENS = new Set([
  'DJ', 'MC', 'EP', 'LP', 'VIP', 'UK', 'US', 'USA', 'NYE', 'RNB', 'R&B',
  'PC', 'O2', 'TV', 'XL', 'II', 'III', 'IV', 'FT', 'AKA', 'NYC', 'LDN',
]);

/** Small words stay lowercase unless they open the title. */
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or',
  'the', 'to', 'vs', 'with',
]);

export function formatEventName(name: string): string {
  const words = name.split(/\s+/);
  const shouted = words.filter((w) => {
    const letters = w.replace(/[^A-Za-z]/g, '');
    return letters.length >= 3 && letters === letters.toUpperCase();
  });

  // One capitalised word is a band styling itself. Leave it alone.
  if (shouted.length < 2) return name;

  return words
    .map((word, index) => {
      const bare = word.replace(/[^A-Za-z0-9&]/g, '');
      if (PRESERVED_TOKENS.has(bare.toUpperCase())) return word;

      // Only reshape words that are actually shouting; anything already in
      // mixed case was typed deliberately.
      const letters = word.replace(/[^A-Za-z]/g, '');
      if (letters.length === 0 || letters !== letters.toUpperCase()) return word;
      // One or two capital letters is an initialism far more often than it is
      // shouting — DJ EZ, MF DOOM, SBTRKT. Leave them.
      if (letters.length <= 2) return word;

      const lower = word.toLowerCase();
      if (index > 0 && MINOR_WORDS.has(lower.replace(/[^a-z]/g, ''))) return lower;

      // Capitalise after any separator, so "LIZZIE/THE" becomes "Lizzie/The".
      return lower.replace(/(^|[\s\-/&(])([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());
    })
    .join(' ');
}

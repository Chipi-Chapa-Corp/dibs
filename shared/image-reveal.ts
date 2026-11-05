import type {Current} from './model';

export const IMAGE_REVEAL_MS=5000;

export function imageRevealElapsed(current:Pick<Current,'openedAt'|'imageRevealPausedAt'|'imageRevealPausedMs'>,now:number):number{
  return Math.max(0,(current.imageRevealPausedAt??now)-(current.openedAt??now)-(current.imageRevealPausedMs||0));
}

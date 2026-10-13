import { useEffect, useRef } from "react";
import type { TimerEvent } from "../lib/timers";

/** Don't announce warnings that came due longer ago than this (e.g. after starting mid-match). */
const STALE_SECS = 3;

/**
 * Speaks a warning `lead` seconds before each timer, e.g. "Mid Boss in 20
 * seconds". Voice works while the game is fullscreen, unlike a pop-up.
 */
export function useTimerAlerts(clock: number | null, timers: TimerEvent[], lead: number, voice: boolean) {
  const announced = useRef(new Set<string>());
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const prev = previous.current;
    previous.current = clock;
    if (clock === null) {
      announced.current.clear();
      return;
    }
    if (prev === null || !voice) return;
    for (const t of timers) {
      const due = t.at - lead;
      if (due > prev && due <= clock && clock - due < STALE_SECS && !announced.current.has(t.key)) {
        announced.current.add(t.key);
        speak(`${t.label} ${t.approx ? "in about" : "in"} ${lead} seconds`);
      }
    }
  }, [clock, timers, lead, voice]);
}

function speak(text: string) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.1;
  synth.speak(utterance);
}

export function testVoice() {
  speak("Timers on");
}

import tl from "./data/timeline.json";

// Single source of truth shared with scripts/build_audio.py: every visual beat
// below is also a sound-design cue, and phrase/word frames come from the
// voiceover (placed at frame `voOffset`).
export const FPS = tl.fps;
export const DURATION = tl.durationInFrames;
export const VO_OFFSET = tl.voOffset;
export const CUE = tl.cues;

export type Word = { text: string; at: number };
export type Phrase = { id: string; words: Word[] };

export const PHRASES: Record<string, Phrase> = Object.fromEntries(
  tl.phrases.map((p) => [
    p.id,
    { id: p.id, words: p.words.map(([text, at]) => ({ text: String(text), at: Number(at) })) },
  ]),
);

/** Live demo data changes on these frames (kept consistent across every card). */
export const LIVE = {
  bekzodIn: CUE.statusChange, // Bekzod checks in by QR → his row and the activity feed
  bekzodKpi: CUE.statusChange + 14, // …and the summary tiles once the connector reaches them
  kamolaIn: CUE.arrive, // Kamola's phone check-in reaches the panel
};
